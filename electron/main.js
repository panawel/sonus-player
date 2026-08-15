import { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme, clipboard, nativeImage, protocol, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import crypto from 'crypto';
import * as mm from 'music-metadata';
import NodeID3 from 'node-id3';
import windowStateKeeper from 'electron-window-state';
import { normalizePicture, pictureToDataUrl } from './artwork.mjs';
import { createIndexStore, diffPaths } from './indexStore.mjs';
import { sortByFileName } from './launchFiles.mjs';
import { installFinderServices } from './finderServices.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Smoke-test mode (used by scripts/smoke.mjs): isolated userData so automated
// runs never touch the real library/index, and the built renderer is loaded
// instead of the dev server.
const SMOKE = process.argv.includes('--smoke');
if (SMOKE) {
  app.setPath('userData', path.join(app.getPath('temp'), `sonus-smoke-${process.pid}`));
}

const libraryStatePath = () => path.join(app.getPath('userData'), 'library.json');
const thumbsDir = () => path.join(app.getPath('userData'), 'thumbs');

// Metadata index (parsed tags per file, keyed by path+mtime) + play stats.
// Created lazily so app.getPath('userData') reflects any smoke-mode override.
let store = null;
let storeLoadPromise = null;
function getStore() {
  if (!store) {
    store = createIndexStore({
      indexPath: path.join(app.getPath('userData'), 'library-index.json'),
      statsPath: path.join(app.getPath('userData'), 'play-stats.json'),
    });
  }
  return store;
}

// The index load is kicked off at startup but deliberately *not* awaited before
// the window is created — nothing on screen depends on it, so reading and
// parsing library-index.json overlaps with window creation and renderer load
// instead of delaying them.
//
// Every code path that actually reads the store must await this first. Skipping
// one is not a subtle bug: an unloaded store reports every path as unknown, so
// library:load would serve placeholders for the entire library and kick off a
// full background reindex of files that were already indexed.
function ensureStoreLoaded() {
  if (!storeLoadPromise) storeLoadPromise = getStore().load();
  return storeLoadPromise;
}

let mainWindow = null;
let forceQuit = false;
let storeFlushed = false;

// ── File-open batching ───────────────────────────────────────────────────────
// macOS fires a separate 'open-file' event per file for a multi-file Finder
// selection (both at cold launch and while already running). A "batch" opens on
// the first event and settles OPEN_FILE_SETTLE_MS after the last one, so both
// consumers - library:load on a cold launch, flushOpenFiles on a warm one -
// always see the whole selection instead of a partial one.
const OPEN_FILE_SETTLE_MS = 100;
let pendingOpenFilePaths = [];
let openFileFlushTimer = null;
let batchSettled = null;         // resolves once the current batch stops growing
let resolveBatchSettled = null;
let batchActionPromise = null;   // Services flag, read (and deleted) once per batch
// A pending batch belongs to library:load until the renderer has been served
// its starting library - a file-open launch replaces that library wholesale, so
// flushing it first would mean rendering a session we're about to discard.
// Without this the did-finish-load flush below steals the batch while
// library:load is still waiting for it to settle.
let libraryLoadServed = false;
// mainWindow exists as soon as createWindow() runs, well before the page
// (and the renderer's IPC listener) has actually loaded - webContents.send()
// does not queue/retry, so sending before did-finish-load silently drops the
// message. Gate flushing on the page truly being ready, not just the window
// object existing.
let rendererReady = false;

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
    mainWindow.webContents.send(channel, payload);
  }
}

// The Finder Services (see ensureFinderServicesInstalled below) write this flag
// file immediately before calling `open -a Sonus`, naming the action they want.
// It exists because `open -a` can only carry file paths through the open-file
// Apple Event — there's no channel for "and queue these rather than replacing
// the library". Consumed (deleted) on every check so a stale flag can never
// leak into a later, unrelated double-click/Open With, and age-limited for the
// same reason.
const SERVICE_ACTION_FLAG = 'service-action.flag';
// Written by the pre-2.0 "Add to Queue" bundle. Still honoured because the
// installer can only update that bundle at launch: a user who triggers the old
// Service *before* ever launching the new build would otherwise fall through to
// the file-open path and have their library replaced. Safe to delete once every
// install has launched at least once.
const LEGACY_ADD_TO_QUEUE_FLAG = 'service-add-to-queue.flag';
const SERVICE_ACTIONS = new Set(['add-to-queue', 'play-next']);
const SERVICE_FLAG_MAX_AGE_MS = 5000; // generous for launch/wake, tight enough to not leak

async function readServiceActionFlag(fileName, forcedAction = null) {
  const flagPath = path.join(app.getPath('userData'), fileName);
  try {
    const [stat, raw] = await Promise.all([fs.stat(flagPath), fs.readFile(flagPath, 'utf-8')]);
    await fs.unlink(flagPath);
    if (Date.now() - stat.mtimeMs >= SERVICE_FLAG_MAX_AGE_MS) return null;
    const action = forcedAction ?? raw.trim();
    return SERVICE_ACTIONS.has(action) ? action : null;
  } catch {
    return null;
  }
}

// Both flags are always consumed, so a stale legacy file can't survive to fire
// on some later open; the modern one wins if somehow both are present.
async function consumeServiceAction() {
  const [modern, legacy] = await Promise.all([
    readServiceActionFlag(SERVICE_ACTION_FLAG),
    readServiceActionFlag(LEGACY_ADD_TO_QUEUE_FLAG, 'add-to-queue'),
  ]);
  return modern ?? legacy;
}

// Opened lazily on first await rather than when the batch opens: 'open-file'
// can fire before app.whenReady(), and this touches app.getPath('userData').
function getBatchAction() {
  if (!batchActionPromise) batchActionPromise = consumeServiceAction();
  return batchActionPromise;
}

function beginOpenFileBatch() {
  if (pendingOpenFilePaths.length > 0) return; // a batch is already collecting
  batchActionPromise = null;                   // fresh flag read for this batch
  batchSettled = new Promise(resolve => { resolveBatchSettled = resolve; });
}

function queueOpenFilePath(filePath) {
  beginOpenFileBatch();
  pendingOpenFilePaths.push(filePath);
  clearTimeout(openFileFlushTimer);
  openFileFlushTimer = setTimeout(() => {
    resolveBatchSettled?.();
    flushOpenFiles();
  }, OPEN_FILE_SETTLE_MS);
}

// Capped, because a batch that somehow never settles must not hang the launch.
async function waitForBatchSettle() {
  if (!batchSettled) return;
  await Promise.race([batchSettled, new Promise(resolve => setTimeout(resolve, 500))]);
}

// Bring the window back for an OS-initiated open. `activate` covers the
// dock-click case but is not guaranteed to fire here, and a file opened into a
// hidden window with nothing shown would look like nothing happened.
function revealWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

// Diagnostics only: --smoke asserts a cold launch never reaches the flush,
// i.e. that library:load really does win the batch before the renderer is ready.
let openFileFlushCount = 0;

function flushOpenFiles() {
  if (!mainWindow || !rendererReady || pendingOpenFilePaths.length === 0) return;
  if (!libraryLoadServed) return; // library:load gets first claim - see above
  openFileFlushCount++;
  const paths = sortByFileName(pendingOpenFilePaths);
  pendingOpenFilePaths = [];
  Promise.all([parseFilePaths(paths), getBatchAction()]).then(([tracks, action]) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    revealWindow();
    if (action) {
      // Services queue silently — the renderer never changes what's playing.
      mainWindow.webContents.send('service-action', { action, tracks });
    } else {
      // Double-click / Open With: the renderer replaces its whole library with
      // this. failedCount lets it tell "nothing to do" apart from "every file
      // we were handed was unreadable" (which must not wipe the library).
      mainWindow.webContents.send('open-external-file', {
        tracks,
        failedCount: tracks.length > 0 ? 0 : paths.length,
      });
    }
  });
}

// Consume the pending batch when this launch was triggered by a file open.
// Returns the settled, sorted paths, or null when this isn't a file-open launch
// — a Services invocation deliberately falls through to the saved session and
// leaves its batch for flushOpenFiles.
async function takeFileOpenLaunch() {
  if (pendingOpenFilePaths.length === 0) return null;
  await waitForBatchSettle();
  if (pendingOpenFilePaths.length === 0) return null; // flushed while we waited
  if (await getBatchAction()) return null;
  const paths = sortByFileName(pendingOpenFilePaths);
  pendingOpenFilePaths = [];
  clearTimeout(openFileFlushTimer);
  return paths;
}

// Test seam: seeds a batch exactly as a pre-ready cold launch would - already
// settled, and with no flush scheduled (a real cold launch's flush no-ops
// because the renderer isn't ready yet). Force-restarts the batch rather than
// joining an open one, so a case that deliberately leaves its batch unconsumed
// (a Services launch) can't leak into the next. Only reachable from --smoke.
function seedOpenFileBatch(paths) {
  clearTimeout(openFileFlushTimer);
  pendingOpenFilePaths = [];
  batchActionPromise = null;
  batchSettled = new Promise(resolve => { resolveBatchSettled = resolve; });
  pendingOpenFilePaths.push(...paths);
  resolveBatchSettled();
}

app.setName('Sonus');
nativeTheme.themeSource = 'dark';

// The sonus-thumb:// scheme serves cached album-art thumbnails from userData.
// Must be registered before app ready.
protocol.registerSchemesAsPrivileged([
  // corsEnabled puts the scheme in Chromium's fetchable set — without it,
  // renderer fetch()/XHR of thumbnails is refused outright ("Cross origin
  // requests are only supported for protocol schemes: …") regardless of the
  // ACAO header the handler sends. <img> would work either way, but
  // fast-average-color and cache priming go through fetch.
  { scheme: 'sonus-thumb', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

app.on('before-quit', (event) => {
  forceQuit = true;
  // Flush any debounced index/stats writes before the process dies.
  if (!storeFlushed && store) {
    event.preventDefault();
    storeFlushed = true;
    store.flush().finally(() => app.quit());
  }
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueOpenFilePath(filePath);
});

function createWindow() {
  rendererReady = false;
  libraryLoadServed = false;
  let mainWindowState = windowStateKeeper({
    defaultWidth: 1000,
    defaultHeight: 700
  });

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 700,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // allow file:// access for audio tags
    },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    titleBarStyle: 'hiddenInset',
    transparent: true,
    backgroundColor: '#00000000'
  });

  if (app.isPackaged || SMOKE) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), SMOKE ? { query: { test: '1' } } : undefined);
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true;
    // No longer clears the settle timer: that timer is what resolves the batch
    // for library:load, and flushOpenFiles is idempotent on an empty batch.
    flushOpenFiles();
    // Safety net - if the renderer never asks for its library (broken preload,
    // load failure), a pending batch must not be stranded forever.
    setTimeout(() => { libraryLoadServed = true; flushOpenFiles(); }, 3000);
    if (SMOKE) {
      import('./smokeTest.mjs')
        .then(m => m.runSmoke({
          mainWindow, parseFilePaths, getStore, loadLibraryState, seedOpenFileBatch,
          getOpenFileFlushCount: () => openFileFlushCount,
          openTagEditor: createTagEditorWindow,
          getTagEditorWindow: () => tagEditorWindow,
        }))
        .catch(err => { console.log('SMOKE_RESULT:' + JSON.stringify({ ok: false, failures: [String(err)] })); app.exit(1); });
    }
  });

  mainWindowState.manage(mainWindow);

  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !forceQuit) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// Tag Editor: a singleton, independent window (not tied to mainWindow's
// hide/show lifecycle, and not intercepted on close — closing it just
// discards any unsaved edits, matching the old inline behavior). Reusing the
// same Vite bundle via a ?editor=1 query flag (see main.jsx), same pattern as
// the ?test=1 smoke-test gate above.
let tagEditorWindow = null;
let tagEditorReady = false;
let pendingTagEditorTrack = null;

function sendToTagEditor(track) {
  if (tagEditorWindow && !tagEditorWindow.isDestroyed() && tagEditorReady) {
    tagEditorWindow.webContents.send('tag-editor:load', track);
  } else {
    pendingTagEditorTrack = track;
  }
}

function createTagEditorWindow(track) {
  if (tagEditorWindow && !tagEditorWindow.isDestroyed()) {
    tagEditorWindow.focus();
    sendToTagEditor(track);
    return;
  }

  tagEditorReady = false;
  tagEditorWindow = new BrowserWindow({
    width: 960,
    height: 720, // fallback only, until the renderer's first resizeTagEditor message fits it to content
    resizable: false,
    show: false, // stays hidden until sized to content, so it never flashes at the fallback height
    title: 'Edit Tags',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // Search Online does cross-origin fetch(), same rationale as mainWindow
    },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    titleBarStyle: 'hiddenInset',
    transparent: true,
    backgroundColor: '#00000000'
  });

  pendingTagEditorTrack = track;

  // `|| SMOKE` mirrors mainWindow's branch above. Without it, smoke mode would
  // point this window at a dev server that isn't running and load nothing.
  if (app.isPackaged || SMOKE) {
    // `test: '1'` exposes window.__sonusTagEditorTest so the smoke suite can
    // drive the Search Online popup without calling iTunes/MusicBrainz.
    tagEditorWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      query: SMOKE ? { editor: '1', test: '1' } : { editor: '1' },
    });
  } else {
    tagEditorWindow.loadURL('http://localhost:5173?editor=1');
  }

  tagEditorWindow.webContents.on('did-finish-load', () => {
    tagEditorReady = true;
    if (pendingTagEditorTrack) {
      sendToTagEditor(pendingTagEditorTrack);
      pendingTagEditorTrack = null;
    }
    // Safety net: if resizeTagEditor never arrives (shouldn't happen), don't
    // leave the window hidden forever.
    setTimeout(() => {
      if (tagEditorWindow && !tagEditorWindow.isDestroyed() && !tagEditorWindow.isVisible()) {
        tagEditorWindow.show();
      }
    }, 1500);
  });

  tagEditorWindow.on('closed', () => {
    tagEditorWindow = null;
    tagEditorReady = false;
    // Next open is a fresh window and must centre again.
    tagEditorCenteredHeight = null;
  });
}

const TAG_EDITOR_WIDTH = 960;
const TAG_EDITOR_STRIP_HEIGHT = 42; // must match the drag strip in TagEditorWindow.jsx's root
// Re-centre only when the fitted height moves by more than this, so a window
// the user has deliberately dragged somewhere isn't yanked back to the middle
// every time another track is loaded into it.
const TAG_EDITOR_RECENTER_DELTA = 100;
// Height at which the window was last centred (null = not centred yet).
let tagEditorCenteredHeight = null;

// Deliberately NOT BrowserWindow.center(): measured against a 1728x1020 work
// area it placed a 857px-tall window at y=74 rather than the work-area centre
// of y=114, i.e. ~40px high. Centring on the work area explicitly is
// deterministic and is what the smoke suite asserts.
function centerInWorkArea(win) {
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  win.setPosition(
    Math.round(wa.x + (wa.width - b.width) / 2),
    Math.round(wa.y + (wa.height - b.height) / 2)
  );
}

// A resize pins the top-left corner, so growth can push the bottom off-screen.
// Nudge the window back inside its display's work area without re-centring it.
function keepWindowOnScreen(win) {
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - b.width));
  const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - b.height));
  if (x !== b.x || y !== b.y) win.setPosition(Math.round(x), Math.round(y));
}

ipcMain.on('tag-editor:resize', (event, contentHeight) => {
  if (!tagEditorWindow || tagEditorWindow.isDestroyed() || event.sender !== tagEditorWindow.webContents) return;
  const display = screen.getDisplayMatching(tagEditorWindow.getBounds());
  const maxHeight = display.workAreaSize.height - 80; // leave room for menu bar/dock
  const targetHeight = Math.max(500, Math.min(Math.round(contentHeight) + TAG_EDITOR_STRIP_HEIGHT, maxHeight));

  // setContentSize keeps the top-left corner fixed, so the window only ever
  // grows downward (or shrinks upward) - its centre drifts by half the height
  // change. Left alone, a tall form lands visibly low and a short one high.
  const firstShow = !tagEditorWindow.isVisible();
  const recenter = firstShow
    || tagEditorCenteredHeight === null
    || Math.abs(targetHeight - tagEditorCenteredHeight) > TAG_EDITOR_RECENTER_DELTA;

  // Don't animate a resize we're about to reposition - the two would fight.
  tagEditorWindow.setContentSize(TAG_EDITOR_WIDTH, targetHeight, !recenter);

  if (recenter) {
    centerInWorkArea(tagEditorWindow);
    tagEditorCenteredHeight = targetHeight;
  } else {
    keepWindowOnScreen(tagEditorWindow);
  }
  if (!tagEditorWindow.isVisible()) tagEditorWindow.show();
});

function buildAppMenu() {
  const template = [
    {
      label: app.name,
      role: 'appMenu'
    },
    {
      label: 'File',
      role: 'fileMenu'
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        {
          label: 'Select All',
          accelerator: 'CommandOrControl+A',
          click: (menuItem, window) => {
            window?.webContents.send('menu-select-all');
          }
        },
        { type: 'separator' },
        {
          label: 'Substitutions',
          submenu: [
            { role: 'showSubstitutions' },
            { type: 'separator' },
            { role: 'toggleSmartQuotes' },
            { role: 'toggleSmartDashes' },
            { role: 'toggleTextReplacement' }
          ]
        },
        {
          label: 'Speech',
          submenu: [
            { role: 'startSpeaking' },
            { role: 'stopSpeaking' }
          ]
        }
      ]
    },
    {
      label: 'View',
      role: 'viewMenu'
    },
    {
      label: 'Window',
      role: 'windowMenu'
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Installs the Finder Service bundles (Automator .workflow packages, not native
// code) into ~/Library/Services/. Dev mode has no installed .app for their
// `open -a Sonus` to target, so this only ever runs when app.isPackaged. The
// install/skip policy - including never resurrecting a bundle the user deleted,
// and updating one whose shipped contents changed - lives in finderServices.mjs.
async function ensureFinderServicesInstalled() {
  if (!app.isPackaged) return;
  await installFinderServices({
    srcDir: path.join(process.resourcesPath, 'services'),
    destDir: path.join(app.getPath('home'), 'Library', 'Services'),
    markerPath: path.join(app.getPath('userData'), 'services-installed.json'),
  });
}

app.whenReady().then(async () => {
  if (!app.isPackaged && process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, '../build/icon.png'));
  }

  // Thumbnail protocol: sonus-thumb://art/<sha1(filePath)>.<ext>?v=<contentHash>
  // The ?v= query busts the renderer's HTTP cache when artwork changes; the
  // handler itself only looks at the file name.
  protocol.handle('sonus-thumb', async (request) => {
    try {
      const name = new URL(request.url).pathname.replace(/^\//, '');
      if (!/^[0-9a-f]{40}\.(jpg|png|gif|webp)$/.test(name)) {
        return new Response('bad request', { status: 400 });
      }
      const data = await fs.readFile(path.join(thumbsDir(), name.slice(0, 2), name));
      const mime = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[name.split('.').pop()];
      return new Response(data, {
        headers: {
          'content-type': mime,
          'cache-control': 'public, max-age=31536000, immutable',
          'access-control-allow-origin': '*'
        }
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  // Kicked off, not awaited — see ensureStoreLoaded. The window starts creating
  // and loading its renderer while the index is still being read from disk.
  ensureStoreLoaded();

  buildAppMenu();

  // Dev seam: macOS only delivers 'open-file' to an app it has registered, so
  // double-click behaviour is otherwise impossible to exercise under
  // `npm run dev`. `electron . --open-file=/path/a.mp3 [--open-file=…]` seeds
  // the same batch the real Apple Event would. Never honoured when packaged.
  if (!app.isPackaged) {
    for (const arg of process.argv) {
      if (arg.startsWith('--open-file=')) {
        const p = arg.slice('--open-file='.length);
        if (p) queueOpenFilePath(p);
      }
    }
  }

  createWindow();

  // Nothing on this launch depends on it — an install only affects the Finder
  // menu from the *next* launch onward — so it must not sit in front of the
  // window. On a first run it copies whole bundles into ~/Library/Services.
  ensureFinderServicesInstalled().catch(err => console.error('Finder services install failed:', err));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const SUPPORTED_EXTS = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac'];
const THUMB_SIZE = 300;

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Thumbnails ────────────────────────────────────────────────────────────────

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

// Writes a ≤300px JPEG thumbnail for the given normalized picture and returns
// its sonus-thumb:// URL (or null). If Chromium can't decode the buffer
// (e.g. WebP/GIF embeds — nativeImage only decodes JPEG/PNG), the original
// bytes are stored untouched so the renderer can still display them without
// any base64 living in the JS heap.
async function writeThumb(filePath, norm) {
  if (!norm) return null;
  const id = sha1(filePath);
  let buf, ext;
  try {
    const img = nativeImage.createFromBuffer(norm.buffer);
    if (!img.isEmpty()) {
      const { width } = img.getSize();
      buf = (width > THUMB_SIZE ? img.resize({ width: THUMB_SIZE }) : img).toJPEG(70);
      ext = 'jpg';
    } else {
      buf = norm.buffer;
      ext = { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[norm.mime] || 'jpg';
    }
  } catch {
    buf = norm.buffer;
    ext = 'jpg';
  }
  const dir = path.join(thumbsDir(), id.slice(0, 2));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.${ext}`), buf);
  const v = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
  return `sonus-thumb://art/${id}.${ext}?v=${v}`;
}

// ── Parsing + index ───────────────────────────────────────────────────────────

// Merge an index entry + play stats into the track shape the renderer uses.
function buildTrack(filePath, entry) {
  const s = getStore().getStats(filePath);
  // eslint-disable-next-line no-unused-vars
  const { mtimeMs, ...meta } = entry;
  return { ...meta, filePath, playCount: s.playCount, lastPlayed: s.lastPlayed };
}

// Minimal renderable track for a path whose metadata isn't indexed yet —
// lets library:load return instantly during a first-run migration while the
// real parse happens in the background.
function buildPlaceholder(filePath) {
  return {
    title: path.basename(filePath, path.extname(filePath)),
    artist: '', album: '', albumArtist: '', year: '',
    duration: null, genre: '', thumb: null, lyrics: null,
    trackNumber: '', trackTotal: '', discNumber: '', discTotal: '',
    composer: '', comment: '', bpm: '', bitrate: null, codecProfile: null,
    dateAdded: null, playCount: 0, lastPlayed: null,
    filePath, pending: true,
  };
}

// Parse audio files into track objects. Index-aware: files whose mtime matches
// the cached entry are served from the index without touching music-metadata.
// dateAddedMode: 'now' (user-initiated adds) | 'birthtime' (migration/reindex).
async function parseFilePaths(files, { useIndex = true, dateAddedMode = 'now' } = {}) {
  await ensureStoreLoaded();
  const supportedFiles = files.filter(file => SUPPORTED_EXTS.includes(path.extname(file).toLowerCase()));
  const st8 = getStore();

  const results = await mapWithConcurrency(supportedFiles, 8, async (file) => {
    try {
      const stat = await fs.stat(file);
      const existing = st8.getEntry(file);
      if (useIndex && existing && existing.mtimeMs === stat.mtimeMs) {
        return buildTrack(file, existing);
      }

      const metadata = await mm.parseFile(file, { duration: true });
      const norm = metadata.common.picture?.length ? normalizePicture(metadata.common.picture[0]) : null;
      const thumb = norm ? await writeThumb(file, norm) : null;

      const trackInfo = metadata.common.track ?? {};
      const diskInfo  = metadata.common.disk  ?? {};
      const commentRaw = metadata.common.comment?.[0];
      const bitrateRaw = metadata.format.bitrate;

      const entry = {
        title: metadata.common.title || path.basename(file, path.extname(file)),
        artist: metadata.common.artist || '',
        album: metadata.common.album || '',
        albumArtist: metadata.common.albumartist || '',
        year: metadata.common.year || '',
        duration: metadata.format.duration || null,
        genre: metadata.common.genre ? metadata.common.genre.join(', ') : '',
        thumb,
        lyrics: ['.mp3', '.flac', '.wav'].includes(path.extname(file).toLowerCase()) ? (metadata.common.lyrics?.[0]?.text || null) : null,
        trackNumber: trackInfo.no != null ? String(trackInfo.no) : '',
        trackTotal:  trackInfo.of != null ? String(trackInfo.of) : '',
        discNumber:  diskInfo.no  != null ? String(diskInfo.no)  : '',
        discTotal:   diskInfo.of  != null ? String(diskInfo.of)  : '',
        composer: metadata.common.composer?.[0] || '',
        comment: (typeof commentRaw === 'string' ? commentRaw : (commentRaw?.text ?? '')) || '',
        bpm: metadata.common.bpm ? String(Math.round(metadata.common.bpm)) : '',
        bitrate: bitrateRaw ? Math.round(bitrateRaw / 1000) : null,
        codecProfile: metadata.format.codecProfile || null,
        mtimeMs: stat.mtimeMs,
        // Preserve the original dateAdded across re-parses (tag edits etc.);
        // birthtime approximates "added" for pre-existing files on migration.
        dateAdded: existing?.dateAdded
          ?? (dateAddedMode === 'birthtime' ? Math.round(stat.birthtimeMs || stat.mtimeMs) : Date.now()),
      };
      st8.setEntry(file, entry);
      return buildTrack(file, entry);
    } catch (err) {
      console.error(`Error parsing ${file}:`, err);
      return null;
    }
  });

  return results.filter(Boolean);
}

// ── Background library verification (after instant cached load) ──────────────

const chunked = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function verifyLibraryInBackground(trackPaths) {
  await ensureStoreLoaded();
  const st8 = getStore();
  const statResults = new Map();
  await mapWithConcurrency(trackPaths, 16, async (p) => {
    try {
      const st = await fs.stat(p);
      statResults.set(p, { mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs });
    } catch {
      statResults.set(p, null);
    }
  });

  const { missing, toParse } = diffPaths(trackPaths, statResults, st8.entriesMap());

  if (missing.length > 0) {
    st8.removeEntries(missing);
    sendToRenderer('library:updated', { updated: [], removed: missing });
  }
  if (toParse.length === 0) return;

  const total = toParse.length;
  const showProgress = total > 20; // only surface a toast for real (re)index work
  if (showProgress) sendToRenderer('reindex:progress', { done: 0, total });

  let done = 0;
  for (const chunk of chunked(toParse, 24)) {
    const parsed = await parseFilePaths(chunk, { useIndex: false, dateAddedMode: 'birthtime' });
    done += chunk.length;
    if (parsed.length > 0) sendToRenderer('library:updated', { updated: parsed, removed: [] });
    if (showProgress) sendToRenderer('reindex:progress', { done, total });
  }
}

// ── IPC surface ───────────────────────────────────────────────────────────────

ipcMain.handle('fs:readFiles', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'Audio Files', extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'] }]
    });

    if (result.canceled) return [];

    const allFiles = [];
    for (const p of result.filePaths) {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) {
        const files = await fs.readdir(p);
        allFiles.push(...files.map(f => path.join(p, f)));
      } else {
        allFiles.push(p);
      }
    }

    const audioFiles = allFiles.filter(f => SUPPORTED_EXTS.includes(path.extname(f).toLowerCase()));
    return await parseFilePaths(audioFiles);
  } catch (err) {
    console.error('Error reading files:', err);
    return [];
  }
});

ipcMain.handle('fs:parseFiles', async (event, filePaths) => {
  try {
    return await parseFilePaths(filePaths);
  } catch (err) {
    console.error('Error parsing dragged files:', err);
    return [];
  }
});

ipcMain.handle('fs:revealInFolder', (event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('fs:checkPaths', async (event, paths) => {
  return Promise.all(paths.map(async p => {
    try { await fs.access(p); return true; } catch { return false; }
  }));
});

// The caller (mainWindow) already has the full track object in its own
// `library` state, so it's passed through as-is — main.js never needs to
// look it up itself.
ipcMain.handle('open-tag-editor', (event, track) => {
  createTagEditorWindow(track);
});

// Full-resolution artwork, on demand (Now Playing + Tag Editor only — the
// library index deliberately carries no base64). Tiny LRU keyed path+mtime.
const artworkCache = new Map(); // key -> dataUrl|null
const ARTWORK_CACHE_MAX = 6;

ipcMain.handle('fs:readArtwork', async (event, filePath) => {
  try {
    const stat = await fs.stat(filePath);
    const key = `${filePath}::${stat.mtimeMs}`;
    if (artworkCache.has(key)) {
      const val = artworkCache.get(key);
      artworkCache.delete(key);
      artworkCache.set(key, val); // refresh LRU position
      return val;
    }
    const metadata = await mm.parseFile(filePath, { duration: false });
    const dataUrl = metadata.common.picture?.length ? pictureToDataUrl(metadata.common.picture[0]) : null;
    artworkCache.set(key, dataUrl);
    while (artworkCache.size > ARTWORK_CACHE_MAX) {
      artworkCache.delete(artworkCache.keys().next().value);
    }
    return dataUrl;
  } catch {
    return null;
  }
});

ipcMain.handle('stats:recordPlay', async (event, filePath) => {
  await ensureStoreLoaded();
  return getStore().recordPlay(filePath);
});

// Single arbitration point for "what library does the renderer start with".
// A file-open launch is resolved *here* rather than by letting the renderer
// restore the saved session and then having an open-external-file push wipe it:
// that raced (the instant index-backed restore always won), flashed the old
// library on screen, and kicked off a background verify over every path it was
// about to discard.
async function loadLibraryState() {
  try {
    return await resolveInitialLibrary();
  } finally {
    // Hand the claim back: a Services batch (or a file-open that arrived too
    // late to be claimed) still needs delivering, now that the renderer has a
    // library to apply it to.
    libraryLoadServed = true;
    queueMicrotask(flushOpenFiles);
  }
}

async function resolveInitialLibrary() {
  await ensureStoreLoaded();
  let failedOpenCount = 0;

  const openedPaths = await takeFileOpenLaunch();
  if (openedPaths) {
    const opened = await parseFilePaths(openedPaths);
    if (opened.length > 0) {
      // autoPlay distinguishes this from a restored session, which deliberately
      // comes back paused at its saved position.
      return { tracks: opened, currentTrackPath: opened[0].filePath, currentTime: 0, autoPlay: true, failedOpenCount: 0 };
    }
    // Every opened file was unreadable. Fall through to the saved session:
    // replacing a working library with nothing is never the right answer.
    failedOpenCount = openedPaths.length;
  }

  try {
    const raw = await fs.readFile(libraryStatePath(), 'utf-8');
    const saved = JSON.parse(raw);
    const trackPaths = Array.isArray(saved?.trackPaths) ? saved.trackPaths : [];
    const st8 = getStore();

    // Instant load: serve every path from the index (placeholders for unknown
    // ones), then reconcile against disk in the background — stale entries are
    // re-parsed, missing files removed, and the renderer patched via
    // 'library:updated' / 'reindex:progress' pushes.
    const tracks = trackPaths.map(p => {
      const entry = st8.getEntry(p);
      return entry ? buildTrack(p, entry) : buildPlaceholder(p);
    });

    if (trackPaths.length > 0) {
      setTimeout(() => {
        verifyLibraryInBackground(trackPaths).catch(err => console.error('Library verify failed:', err));
      }, 250);
    }

    return {
      tracks,
      currentTrackPath: saved?.currentTrackPath ?? null,
      currentTime: typeof saved?.currentTime === 'number' ? saved.currentTime : 0,
      autoPlay: false,
      failedOpenCount
    };
  } catch {
    return { tracks: [], currentTrackPath: null, currentTime: 0, autoPlay: false, failedOpenCount };
  }
}

ipcMain.handle('library:load', loadLibraryState);

ipcMain.on('library:save', (event, state) => {
  fs.writeFile(libraryStatePath(), JSON.stringify(state)).catch(err => {
    console.error('Failed to save library state:', err);
  });
});


ipcMain.on('open-external-url', (event, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://www.youtube.com/')) return;
  shell.openExternal(url);
});

// ── FLAC pure-JS tag writer ───────────────────────────────────────────────────
// Rewrites the VORBIS_COMMENT (type 4) and PICTURE (type 6) metadata blocks
// while leaving STREAMINFO and audio frames completely untouched.

function flacBlockHeader(blockType, isLast, dataLen) {
  const h = Buffer.alloc(4);
  h[0] = (isLast ? 0x80 : 0x00) | (blockType & 0x7F);
  h.writeUIntBE(dataLen, 1, 3);
  return h;
}

function buildVorbisCommentData(fields) {
  // fields: array of [NAME, value] pairs where value is a non-empty string
  const vendor = Buffer.from('Sonus', 'utf8');
  const vendorLen = Buffer.alloc(4);
  vendorLen.writeUInt32LE(vendor.length, 0);
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(fields.length, 0);
  const entryBufs = fields.flatMap(([name, val]) => {
    const entry = Buffer.from(`${name}=${val}`, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(entry.length, 0);
    return [lenBuf, entry];
  });
  return Buffer.concat([vendorLen, vendor, countBuf, ...entryBufs]);
}

function buildFlacPictureData(imageBuffer, mimeType) {
  const mime = Buffer.from(mimeType, 'ascii');
  const buf = Buffer.alloc(4 + 4 + mime.length + 4 + 0 + 4 * 4 + 4 + imageBuffer.length);
  let o = 0;
  buf.writeUInt32BE(3, o); o += 4;          // front cover
  buf.writeUInt32BE(mime.length, o); o += 4;
  mime.copy(buf, o); o += mime.length;
  buf.writeUInt32BE(0, o); o += 4;          // description length = 0
  buf.writeUInt32BE(0, o); o += 4;          // width (unknown)
  buf.writeUInt32BE(0, o); o += 4;          // height
  buf.writeUInt32BE(0, o); o += 4;          // color depth
  buf.writeUInt32BE(0, o); o += 4;          // color count
  buf.writeUInt32BE(imageBuffer.length, o); o += 4;
  imageBuffer.copy(buf, o);
  return buf;
}

async function writeFlacTags(filePath, tags) {
  const file = await fs.readFile(filePath);

  // Some encoders (Picard, iTunes, etc.) prepend a non-standard ID3v2 header before
  // the fLaC marker. Skip it — Vorbis Comment is the correct FLAC metadata container.
  let flacStart = 0;
  if (file.length >= 10 && file[0] === 0x49 && file[1] === 0x44 && file[2] === 0x33) {
    const flags = file[5];
    const id3Size =
      ((file[6] & 0x7f) << 21) | ((file[7] & 0x7f) << 14) |
      ((file[8] & 0x7f) << 7)  |  (file[9] & 0x7f);
    flacStart = 10 + id3Size + (flags & 0x10 ? 10 : 0);
  }
  if (flacStart + 4 > file.length || file.slice(flacStart, flacStart + 4).toString('ascii') !== 'fLaC') {
    throw new Error('Not a FLAC file');
  }

  // Parse all metadata blocks
  const blocks = [];
  let pos = flacStart + 4;
  let last = false;
  while (!last && pos < file.length) {
    if (pos + 4 > file.length) break;
    const b0 = file[pos];
    last = !!(b0 & 0x80);
    const type = b0 & 0x7F;
    const len = file.readUIntBE(pos + 1, 3);
    blocks.push({ type, data: file.slice(pos + 4, pos + 4 + len) });
    pos += 4 + len;
  }
  const audioStart = pos; // everything from here on is audio — we never touch it
  const audioData = file.slice(audioStart);

  // Build Vorbis Comment fields from tags
  const vcFields = [];
  const add = (name, val) => { if (val != null && String(val).trim() !== '') vcFields.push([name, String(val)]); };
  add('TITLE',       tags.title);
  add('ARTIST',      tags.artist);
  add('ALBUM',       tags.album);
  add('DATE',        tags.year);
  add('GENRE',       tags.genre);
  add('ALBUMARTIST', tags.albumArtist);
  add('COMPOSER',    tags.composer);
  add('COMMENT',     tags.comment);
  add('BPM',         tags.bpm);
  if (tags.lyrics != null && tags.lyrics !== '') vcFields.push(['LYRICS', tags.lyrics]);
  // Track / disc numbers
  if (tags.trackNumber || tags.trackTotal) {
    const num = (tags.trackNumber || '').trim();
    const tot = (tags.trackTotal  || '').trim();
    add('TRACKNUMBER', num && tot ? `${num}/${tot}` : (num || tot));
  }
  if (tags.discNumber || tags.discTotal) {
    const num = (tags.discNumber || '').trim();
    const tot = (tags.discTotal  || '').trim();
    add('DISCNUMBER', num && tot ? `${num}/${tot}` : (num || tot));
  }

  // Resolve artwork
  let pictureData = null;
  const removePicture = 'picture' in tags && tags.picture === null;
  if (tags.picture) {
    const m = tags.picture.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (m) pictureData = buildFlacPictureData(Buffer.from(m[2], 'base64'), m[1]);
  }

  // Reconstruct block list: keep STREAMINFO + other non-VC/PICTURE blocks + new VC + new PICTURE
  const outBlocks = [];
  for (const blk of blocks) {
    if (blk.type === 4) continue; // drop old VORBIS_COMMENT
    if (blk.type === 6) continue; // drop old PICTURE blocks
    if (blk.type === 1) continue; // drop old PADDING (we'll add fresh padding at end)
    outBlocks.push(blk);
  }
  outBlocks.push({ type: 4, data: buildVorbisCommentData(vcFields) });
  if (!removePicture && pictureData) outBlocks.push({ type: 6, data: pictureData });
  else if (!removePicture && !pictureData) {
    // No artwork change — restore whatever PICTURE blocks were in the original
    for (const blk of blocks) {
      if (blk.type === 6) outBlocks.push(blk);
    }
  }

  // Append 8KB padding block to avoid full rewrites on future edits
  const PADDING_SIZE = 8192;
  outBlocks.push({ type: 1, data: Buffer.alloc(PADDING_SIZE) });

  // Serialize
  const parts = [Buffer.from('fLaC', 'ascii')];
  for (let i = 0; i < outBlocks.length; i++) {
    const isLast = i === outBlocks.length - 1;
    parts.push(flacBlockHeader(outBlocks[i].type, isLast, outBlocks[i].data.length));
    parts.push(outBlocks[i].data);
  }
  parts.push(audioData);

  await fs.writeFile(filePath, Buffer.concat(parts));
  return true;
}

// ── WAV RIFF id3 chunk tag writer ─────────────────────────────────────────────
// Embeds ID3v2 tags in a RIFF 'id3 ' chunk (correct WAV convention).
// Uses NodeID3.create() to produce the ID3 payload, then splices/replaces
// the id3 chunk within the RIFF structure without touching audio chunks.

async function writeWavTags(filePath, tags) {
  // Build the ID3 payload (re-use the same mapping as MP3 save)
  const id3Tags = {};
  if (tags.title)       id3Tags.title = tags.title;
  if (tags.artist)      id3Tags.artist = tags.artist;
  if (tags.album)       id3Tags.album = tags.album;
  if (tags.year)        id3Tags.year = String(tags.year);
  if (tags.genre)       id3Tags.genre = tags.genre;
  if (tags.composer)    id3Tags.composer = tags.composer;
  if (tags.bpm)         id3Tags.bpm = String(tags.bpm);
  if (tags.albumArtist) id3Tags.performerInfo = tags.albumArtist;
  if (tags.comment)     id3Tags.comment = { language: 'eng', text: tags.comment };
  if (tags.lyrics)      id3Tags.unsynchronisedLyrics = { language: 'eng', text: tags.lyrics };
  if (tags.picture) {
    const m = tags.picture.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (m) id3Tags.image = { mime: m[1], type: { id: 3, name: 'front cover' }, description: 'Cover', imageBuffer: Buffer.from(m[2], 'base64') };
  }
  // trackNumber / discNumber
  const tnum = (tags.trackNumber || '').trim(), ttot = (tags.trackTotal || '').trim();
  if (tnum || ttot) id3Tags.trackNumber = tnum && ttot ? `${tnum}/${ttot}` : (tnum || ttot);
  const dnum = (tags.discNumber || '').trim(), dtot = (tags.discTotal || '').trim();
  if (dnum || dtot) id3Tags.partOfSet = dnum && dtot ? `${dnum}/${dtot}` : (dnum || dtot);

  const id3Payload = NodeID3.create(id3Tags); // returns Buffer, no file I/O

  const file = await fs.readFile(filePath);
  if (file.slice(0, 4).toString('ascii') !== 'RIFF') throw new Error('Not a WAV file');

  // Parse RIFF chunks
  const chunks = []; // { fourcc, offset, size } — offset points at fourcc
  let p = 12; // skip RIFF header (4) + file size (4) + 'WAVE' (4)
  while (p + 8 <= file.length) {
    const fourcc = file.slice(p, p + 4).toString('ascii');
    const sz = file.readUInt32LE(p + 4);
    chunks.push({ fourcc, offset: p, size: sz });
    p += 8 + sz + (sz % 2); // RIFF chunks are word-aligned
    if (p > file.length) break;
  }

  // Build output without existing id3 chunk, then append new one
  const parts = [];
  for (const ch of chunks) {
    if (ch.fourcc === 'id3 ' || ch.fourcc === 'ID3 ') continue;
    const padded = ch.size + (ch.size % 2);
    parts.push(file.slice(ch.offset, ch.offset + 8 + padded));
  }
  // Append new id3 chunk
  const id3Chunk = Buffer.alloc(8 + id3Payload.length + (id3Payload.length % 2));
  id3Chunk.write('id3 ', 0, 'ascii');
  id3Chunk.writeUInt32LE(id3Payload.length, 4);
  id3Payload.copy(id3Chunk, 8);
  parts.push(id3Chunk);

  const chunkData = Buffer.concat(parts);
  const riffHeader = Buffer.alloc(12);
  riffHeader.write('RIFF', 0, 'ascii');
  riffHeader.writeUInt32LE(chunkData.length + 4, 4); // +4 for 'WAVE'
  riffHeader.write('WAVE', 8, 'ascii');

  await fs.writeFile(filePath, Buffer.concat([riffHeader, chunkData]));
  return true;
}

// After a successful tag write: keep the index entry in sync (so the next
// launch serves the new values without a re-parse) and regenerate/remove the
// thumbnail if artwork changed. Returns the track's new thumb URL.
async function syncIndexAfterTagWrite(filePath, tags) {
  await ensureStoreLoaded();
  const st8 = getStore();
  const entry = st8.getEntry(filePath);
  if (!entry) return null;

  let thumb = entry.thumb ?? null;
  const removePicture = 'picture' in tags && tags.picture === null;
  if (typeof tags.picture === 'string' && tags.picture.startsWith('data:')) {
    const m = tags.picture.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (m) thumb = await writeThumb(filePath, { mime: m[1], buffer: Buffer.from(m[2], 'base64') });
  } else if (removePicture) {
    thumb = null;
  }

  let mtimeMs = entry.mtimeMs;
  try { mtimeMs = (await fs.stat(filePath)).mtimeMs; } catch { /* keep old */ }

  const TEXT_FIELDS = ['title', 'artist', 'album', 'albumArtist', 'year', 'genre',
    'trackNumber', 'trackTotal', 'discNumber', 'discTotal', 'composer', 'comment', 'bpm', 'lyrics'];
  const updated = { ...entry, thumb, mtimeMs };
  for (const f of TEXT_FIELDS) {
    if (f in tags) updated[f] = tags[f] ?? (f === 'lyrics' ? null : '');
  }
  st8.setEntry(filePath, updated);

  // The file changed on disk — any cached full-res artwork for it is stale.
  for (const key of [...artworkCache.keys()]) {
    if (key.startsWith(`${filePath}::`)) artworkCache.delete(key);
  }

  return thumb;
}

ipcMain.handle('fs:writeTag', async (event, filePath, tags) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    let ok = false;

    if (ext === '.flac') {
      ok = await writeFlacTags(filePath, tags);
    } else if (ext === '.wav') {
      ok = await writeWavTags(filePath, tags);
    } else {
      const id3Tags = { ...tags };
      const removePicture = 'picture' in tags && tags.picture === null;

      if (tags.picture) {
        const matches = tags.picture.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          id3Tags.image = {
            mime: matches[1],
            type: { id: 3, name: 'front cover' },
            description: 'Cover',
            imageBuffer: Buffer.from(matches[2], 'base64')
          };
        }
      }
      delete id3Tags.picture;

      if ('lyrics' in id3Tags) {
        if (id3Tags.lyrics) {
          id3Tags.unsynchronisedLyrics = { language: 'eng', text: id3Tags.lyrics };
        } else {
          id3Tags.unsynchronisedLyrics = null;
        }
        delete id3Tags.lyrics;
      }

      // albumArtist → performerInfo (TPE2)
      if ('albumArtist' in id3Tags) {
        id3Tags.performerInfo = id3Tags.albumArtist || null;
        delete id3Tags.albumArtist;
      }

      // trackNumber + trackTotal → combined TRCK frame ("4" or "4/12")
      if ('trackNumber' in id3Tags || 'trackTotal' in id3Tags) {
        const num = (id3Tags.trackNumber || '').trim();
        const tot = (id3Tags.trackTotal  || '').trim();
        id3Tags.trackNumber = num && tot ? `${num}/${tot}` : (num || tot || null);
        delete id3Tags.trackTotal;
      }

      // discNumber + discTotal → partOfSet (TPOS, "1" or "1/2")
      if ('discNumber' in id3Tags || 'discTotal' in id3Tags) {
        const num = (id3Tags.discNumber || '').trim();
        const tot = (id3Tags.discTotal  || '').trim();
        id3Tags.partOfSet = num && tot ? `${num}/${tot}` : (num || tot || null);
        delete id3Tags.discNumber;
        delete id3Tags.discTotal;
      }

      // comment string → COMM object
      if ('comment' in id3Tags) {
        id3Tags.comment = id3Tags.comment
          ? { language: 'eng', text: id3Tags.comment }
          : null;
      }

      // bpm stays as-is (node-id3 accepts string); strip read-only fields
      delete id3Tags.bitrate;
      delete id3Tags.codecProfile;
      delete id3Tags.thumb;
      delete id3Tags.dateAdded;
      delete id3Tags.playCount;
      delete id3Tags.lastPlayed;

      if (removePicture) {
        // node-id3 0.2.x update() cannot remove tags — read all, delete image, write back
        const existingTags = NodeID3.read(filePath);
        if (typeof existingTags === 'object' && existingTags !== null) {
          delete existingTags.image;
          ok = !!NodeID3.write({ ...existingTags, ...id3Tags }, filePath);
        }
      } else {
        ok = !!NodeID3.update(id3Tags, filePath);
      }
    }

    if (!ok) return { success: false, thumb: null };
    const thumb = await syncIndexAfterTagWrite(filePath, tags);
    // Tell mainWindow a save happened, regardless of which window called
    // writeTag — after the Tag Editor moved to its own window, this is the
    // only place mainWindow's library/currentTrack learn about the change.
    // eslint-disable-next-line no-unused-vars
    const { picture, ...savedFields } = tags;
    sendToRenderer('tag-editor:saved', { filePath, ...savedFields, thumb });
    return { success: true, thumb };
  } catch (err) {
    console.error('Error writing tags:', err.message, err.stack);
    event.sender.executeJavaScript(`console.error('[writeTag]', ${JSON.stringify(err.message)})`).catch(() => {});
    return { success: false, thumb: null };
  }
});

ipcMain.handle('clipboard:readImage', () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  return img.toDataURL();
});

ipcMain.handle('clipboard:writeImage', (event, dataUrl) => {
  try {
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
    return true;
  } catch {
    return false;
  }
});
