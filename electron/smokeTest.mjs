// Automated smoke test, driven by `electron . --smoke` (see scripts/smoke.mjs).
// Runs inside the main process against an isolated temp userData dir, exercises
// the real parse → thumbnail → protocol pipeline plus renderer assertions via
// executeJavaScript, prints one JSON line prefixed SMOKE_RESULT:, then exits.

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { app, screen, Menu, dialog } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runSmoke({ mainWindow, parseFilePaths, getStore, loadLibraryState, seedOpenFileBatch, getOpenFileFlushCount, openTagEditor, getTagEditorWindow }) {
  const failures = [];
  const consoleErrors = [];
  // Numbers the suite measures but deliberately does not turn into pass/fail.
  // Hardware this app must run on spans an M-series Mac and a 2017 Intel iMac;
  // a threshold strict enough to be meaningful on one is a false failure on the
  // other, and a red build that everyone learns to ignore hides real
  // regressions. These are reported for a human to judge.
  const metrics = {};
  const check = (cond, label) => { if (!cond) failures.push(label); };

  // Fixed-duration sleeps are the suite's synchronisation primitive, and they
  // encode the speed of the machine they were written on (Apple Silicon).
  // Running the x86_64 slice under Rosetta (~1.8x slower) made four different
  // assertions fail across four runs - never the same two twice, which is the
  // signature of a harness race rather than a real defect. A 2017 Intel iMac,
  // which is the whole point of the universal build, is slower again.
  //
  // Two mitigations, in order of preference:
  //   1. waitFor() below - poll for the state an assertion depends on, so
  //      machine speed stops mattering entirely. Used at every point where a
  //      sleep gates a check().
  //   2. SLOW - a blunt multiplier for the remaining "let things settle"
  //      sleeps. Auto-detects Rosetta; override with SONUS_SMOKE_SLOW=<n>
  //      on genuinely slow native hardware.
  let SLOW = Number(process.env.SONUS_SMOKE_SLOW) || 0;
  if (!SLOW) {
    try {
      SLOW = execSync('sysctl -in sysctl.proc_translated 2>/dev/null').toString().trim() === '1' ? 2.5 : 1;
    } catch { SLOW = 1; }
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, Math.round(ms * SLOW)));

  // Run just some sections while developing: `npx electron . --smoke --only=menus,mini`
  // (or SONUS_SMOKE_ONLY=menus,mini). Every check inside a chosen section runs
  // exactly as in the full suite - nothing is weakened - the others are simply
  // not run, so a filtered pass proves nothing about them. The result is marked
  // `partial: true` and a notice is printed: only a run with no filter is the
  // gate before a build or release. A mistyped name is a failure, never a silent
  // skip (a filter that matches nothing would otherwise report success).
  const SECTIONS = ['tracklist', 'header', 'mini', 'menus', 'adddialog', 'listrows', 'tagwrite', 'folder', 'writers', 'reindex',
    'fileopen', 'save-playing', 'reopen', 'tageditor', 'bench', 'frames', 'mix'];
  const only = (process.argv.find(a => a.startsWith('--only='))?.slice('--only='.length) ?? process.env.SONUS_SMOKE_ONLY ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  for (const name of only.filter(s => !SECTIONS.includes(s))) {
    failures.push(`unknown smoke section "${name}" (known: ${SECTIONS.join(', ')})`);
  }
  const wants = (name) => only.length === 0 || only.includes(name);

  // Poll a renderer-side expression until it satisfies `predicate`, or give up.
  // Returns the last value either way, so the caller's check() still runs and
  // still fails on timeout - this changes WHEN an assertion is evaluated, never
  // WHAT it asserts.
  // Stamped onto every SMOKE_RESULT line. A universal build produces one binary
  // that can execute as either architecture, so a bare pass/fail cannot tell you
  // WHICH slice was exercised - and the same JSON coming back from another Mac
  // is unattributable without this. `translated` distinguishes a real Intel Mac
  // from the x86_64 slice running under Rosetta on Apple Silicon.
  const envInfo = () => {
    let translated = false;
    try {
      translated = execSync('sysctl -in sysctl.proc_translated 2>/dev/null').toString().trim() === '1';
    } catch { /* not macOS, or sysctl unavailable */ }
    return {
      arch: process.arch,
      platform: process.platform,
      osRelease: os.release(),
      translated,
      slowFactor: SLOW,
      electron: process.versions.electron,
    };
  };

  const waitFor = async (expression, predicate, { timeout = 10000, interval = 100 } = {}) => {
    const deadline = Date.now() + timeout * SLOW;
    let last;
    for (;;) {
      try {
        last = await mainWindow.webContents.executeJavaScript(expression, true);
        if (predicate(last)) return last;
      } catch (err) {
        last = { __error: String(err) };
      }
      if (Date.now() >= deadline) return last;
      await new Promise(r => setTimeout(r, interval));
    }
  };

  mainWindow.webContents.on('console-message', (event) => {
    if (event.level === 'error') consoleErrors.push(event.message);
  });

  // ── Cold-launch ordering (npx electron . --smoke --open-file=<path> …) ────
  // The seeded arbitration cases further down inject an already-settled batch,
  // which deliberately sidesteps the one timing assumption this refactor rests
  // on: that a real cold launch calls library:load *before* the renderer is
  // ready, so the batch is consumed there rather than flushed. This mode
  // exercises that real sequence end to end - open-file queued before the
  // window exists, real settle timer, real renderer mount - and then exits.
  const cliOpened = process.argv.filter(a => a.startsWith('--open-file=')).map(a => a.slice('--open-file='.length));
  if (cliOpened.length > 0) {
    try {
      await sleep(800); // let the launch settle: parse + first paint
      const expected = [...cliOpened].sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
      const state = await mainWindow.webContents.executeJavaScript(`
        (() => {
          if (!window.__sonusTest) return { noHook: true };
          return {
            lib: window.__sonusTest.getLibrary().map(t => t.filePath),
            view: window.__sonusTest.getView(),
            hasActiveRow: !!document.querySelector('.track-row.active'),
          };
        })()
      `, true);
      if (state.noHook) {
        failures.push('test hook (?test=1) not present in renderer');
      } else {
        check(state.lib.join('|') === expected.join('|'), `cold launch library is the opened batch (${state.lib.map(p => p.split('/').pop()).join(',')})`);
        check(state.view === 'library', `cold launch lands on Library (${state.view})`);
        check(state.hasActiveRow, 'cold launch marks a current track');
        // The whole point: the batch was resolved inside library:load, so the
        // renderer never rendered a session it was about to throw away.
        check(getOpenFileFlushCount() === 0, `cold launch consumed the batch in library:load, not the flush (flushes: ${getOpenFileFlushCount()})`);
      }
    } catch (err) {
      failures.push(`cold-launch ordering error: ${err.stack || err}`);
    }
    const realErrors = consoleErrors.filter(m => !/Autoplay|play\(\) failed|user didn't interact/i.test(m));
    if (realErrors.length > 0) failures.push(`renderer console errors: ${realErrors.join(' | ')}`);
    console.log('SMOKE_RESULT:' + JSON.stringify({ ok: failures.length === 0, failures, ...envInfo() }));
    app.exit(failures.length === 0 ? 0 : 1);
    return;
  }

  try {
    // 1. Parse the repo's fixture file through the real pipeline.
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const tracks = await parseFilePaths([fixture]);
    check(tracks.length === 1, `fixture parsed (got ${tracks.length} tracks)`);
    const track = tracks[0];

    if (track) {
      check(typeof track.title === 'string' && track.title.length > 0, 'track has title');
      check(typeof track.duration === 'number' && track.duration > 0, 'track has duration');
      check(!('picture' in track), 'track carries no picture field');
      check(JSON.stringify(track).indexOf('data:image') === -1, 'no base64 image in track object');
      check(/^sonus-thumb:\/\/art\/[0-9a-f]{40}\.(jpg|png|gif|webp)\?v=[0-9a-f]{8}$/.test(track.thumb || ''), `thumb URL well-formed (${track.thumb})`);
      check(typeof track.dateAdded === 'number' && track.dateAdded > 0, 'dateAdded populated');
      check(track.playCount === 0 && track.lastPlayed === null, 'fresh play stats');

      // 2. Thumbnail file exists on disk and is a real JPEG under the size cap.
      if (track.thumb) {
        const name = new URL(track.thumb).pathname.replace(/^\//, '');
        const thumbFile = path.join(app.getPath('userData'), 'thumbs', name.slice(0, 2), name);
        try {
          const buf = await fs.readFile(thumbFile);
          check(buf[0] === 0xFF && buf[1] === 0xD8, 'thumb file is JPEG');
          check(buf.length < 200 * 1024, `thumb file small enough (${buf.length}B)`);
        } catch {
          failures.push('thumb file exists on disk');
        }
      }

      // 3. Index entry recorded; second parse served from cache (identical mtime path).
      const entry = getStore().getEntry(fixture);
      check(!!entry && entry.mtimeMs > 0, 'index entry recorded with mtime');
      const again = await parseFilePaths([fixture]);
      check(again[0]?.thumb === track.thumb, 'second parse served from index');

      // 4. Play stats round-trip.
      const s1 = getStore().recordPlay(fixture, 123456);
      check(s1.playCount === 1 && s1.lastPlayed === 123456, 'recordPlay increments');

      // 5. Renderer-side: protocol resolves, mounted DOM stays sane.
      const rendererResult = await mainWindow.webContents.executeJavaScript(`
        (async () => {
          const out = {};
          try {
            const res = await fetch(${JSON.stringify(track.thumb)});
            out.thumbStatus = res.status;
            out.thumbType = res.headers.get('content-type');
            const blob = await res.blob();
            out.thumbSize = blob.size;
          } catch (e) { out.thumbError = String(e); }
          out.hasRoot = !!document.getElementById('root');
          out.appMounted = document.querySelectorAll('.glass-panel').length > 0;
          return out;
        })()
      `, true);
      check(rendererResult.thumbStatus === 200, `renderer fetched thumb over sonus-thumb:// (status ${rendererResult.thumbStatus}, err ${rendererResult.thumbError || 'none'})`);
      check(rendererResult.thumbType === 'image/jpeg', `thumb content-type (${rendererResult.thumbType})`);
      check(rendererResult.thumbSize > 500, 'thumb has real bytes');
      check(rendererResult.appMounted, 'renderer app mounted');
    }
  } catch (err) {
    failures.push(`unexpected error: ${err.stack || err}`);
  }

  // ── Tracklist UI: inject a synthetic library and drive the DOM ────────────
  if (wants('tracklist')) try {
    const uiResult = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const out = {};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        if (!window.__sonusTest) { out.noHook = true; return out; }

        // 2,000 synthetic tracks injected in REVERSE title order, so manual
        // order and title-ascending order are distinguishable.
        const tracks = [];
        for (let i = 1999; i >= 0; i--) {
          tracks.push({
            title: 'Song ' + String(i).padStart(4, '0'),
            artist: 'Artist ' + (i % 40), album: 'Album ' + (i % 120), albumArtist: '',
            year: 1980 + (i % 45), duration: 120 + (i % 300), genre: '',
            thumb: null, lyrics: i % 3 === 0 ? 'la la' : null,
            trackNumber: '', trackTotal: '', discNumber: '', discTotal: '',
            composer: '', comment: '', bpm: '', bitrate: 320, codecProfile: null,
            dateAdded: 1700000000000 + i * 1000, playCount: i % 7, lastPlayed: i % 2 ? 1700000000000 : null,
            filePath: '/fake/song-' + i + '.mp3',
          });
        }
        window.__sonusTest.setLibrary(tracks);
        await sleep(400);

        out.rowCount = document.querySelectorAll('.track-row').length;
        out.hasHeader = !!document.querySelector('.track-list-header');
        // 2k tracks, manual order → drag is allowed → grip handles visible.
        // (Also validates the selector the 20k bench uses to assert their absence.)
        out.hasGripAt2k = !!document.querySelector('.track-row svg.lucide-grip-vertical');
        const firstTitle = () => document.querySelector('.track-row')?.children[2]?.children[0]?.textContent;
        out.manualFirst = firstTitle();

        // The Title column cycles title↑ → title↓ → artist↑ → artist↓ → manual.
        const clickTitle = async () => {
          document.querySelectorAll('.track-header-label')[0]?.click();
          await sleep(320);
        };
        await clickTitle(); out.ascFirst = firstTitle();
        await clickTitle(); out.descFirst = firstTitle();
        await clickTitle(); await clickTitle();   // through the two artist steps
        await clickTitle(); out.backToManualFirst = firstTitle();

        // Keyboard: focus list, ArrowDown selects row 0
        const list = document.querySelector('.track-list');
        list?.focus();
        list?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        await sleep(150);
        out.selectedCount = document.querySelectorAll('.track-row.selected').length;

        // Details view runs on the same engine (no drag, per-open sort).
        // Poll for the view swap instead of assuming a fixed delay: 400ms was
        // enough on Apple Silicon and not under Rosetta, which read 0 rows and
        // failed an assertion that had nothing wrong with it.
        //
        // The condition must be FALSE before the transition. Waiting on
        // '.track-row' alone is not: the Library's own rows are still mounted,
        // so the loop exits on the first iteration and samples the DOM before
        // HomeDetailView has rendered. '.detail-play-button' (the hero's white
        // Play pill, see HomeDetailView.jsx) exists only in the detail view,
        // so it is the honest marker for "the swap actually happened" — a
        // class selector, not text, since HomeView has its own unrelated
        // "Play"/"Shuffle" buttons that plain text-matching would collide with.
        window.__sonusTest.openDetail({ type: 'artist', key: 'Artist 1' });
        const detailReady = () =>
          !!document.querySelector('.detail-play-button')
          && document.querySelectorAll('.track-row').length > 0;
        for (let i = 0; i < 120 && !detailReady(); i++) await sleep(50);
        out.detailRows = document.querySelectorAll('.track-row').length;
        out.detailHeader = !!document.querySelector('.track-list-header');
        out.detailHasPlayAll = !!document.querySelector('.detail-play-button');
        window.__sonusTest.closeDetail();
        window.__sonusTest.setView('library');
        await sleep(150);

        window.__sonusTest.setLibrary([]);
        await sleep(100);
        return out;
      })()
    `, true);

    if (uiResult.noHook) {
      failures.push('test hook (?test=1) not present in renderer');
    } else {
      check(uiResult.hasHeader, 'tracklist header rendered');
      check(uiResult.hasGripAt2k, 'drag handles present at 2k manual order (selector sanity)');
      check(uiResult.rowCount > 0 && uiResult.rowCount < 80, `mounted rows bounded under virtualization (${uiResult.rowCount} of 2000)`);
      check(uiResult.manualFirst === 'Song 1999', `manual order preserved (first: ${uiResult.manualFirst})`);
      check(uiResult.ascFirst === 'Song 0000', `title sort ascending (first: ${uiResult.ascFirst})`);
      check(uiResult.descFirst === 'Song 1999', `title sort descending (first: ${uiResult.descFirst})`);
      check(uiResult.backToManualFirst === 'Song 1999', `fifth click returns to manual (first: ${uiResult.backToManualFirst})`);
      check(uiResult.selectedCount === 1, `ArrowDown selects one row (${uiResult.selectedCount})`);
      check(uiResult.detailRows > 0 && uiResult.detailRows <= 60, `detail view renders bounded rows (${uiResult.detailRows})`);
      check(uiResult.detailHeader, 'detail view has sortable header');
      check(uiResult.detailHasPlayAll, 'detail view hero intact (Play button present)');
    }
  } catch (err) {
    failures.push(`tracklist UI test error: ${err.stack || err}`);
  }

  // ── Library column header: geometry, alignment, and isolation from scroll ──
  // Asserted numerically rather than by eye. The design rests on three
  // measurable claims: it reclaims vertical space, its labels stay over the
  // columns they sort, and — the whole point of moving it out of the scroll
  // container — no row can ever overlap it and it does not move when the list
  // scrolls. If a row can reach it, the header needs an opaque fill again and
  // the darkening problem is back.
  if (wants('header')) try {
    const barResult = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const out = {};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        if (!window.__sonusTest) { out.noHook = true; return out; }
        window.__sonusTest.setView('library');

        const tracks = [];
        for (let i = 0; i < 300; i++) {
          tracks.push({
            title: 'Bar Song ' + String(i).padStart(3, '0'), artist: 'Artist ' + (i % 10),
            album: 'Album ' + (i % 20), albumArtist: '', year: 1990 + (i % 30),
            duration: 200 + (i % 100), genre: '', thumb: null, lyrics: null,
            trackNumber: '', trackTotal: '', discNumber: '', discTotal: '',
            composer: '', comment: '', bpm: '', bitrate: 320, codecProfile: null,
            dateAdded: 1700000000000 + i, playCount: 0, lastPlayed: null,
            filePath: '/bar/t' + i + '.mp3',
          });
        }
        window.__sonusTest.setLibrary(tracks);
        await sleep(500);

        const scroller = () => document.querySelector('.scrollable');
        const bar = () => document.querySelector('.track-list-header');
        const rows = () => [...document.querySelectorAll('.track-row')];

        scroller().scrollTop = 0;
        await sleep(300);

        out.barHeightRest = bar().offsetHeight;
        // The Library screen carries no title, song count or total duration
        // anywhere — guards against the identity line creeping back in and
        // against its CSS being left behind as dead rules.
        out.identityGone = !document.querySelector('.library-identity, .library-identity-title, .library-identity-meta');

        // Reclaimed space, measured from the panel's top edge — the header is no
        // longer inside the scroller, so a scroller-relative number is meaningless.
        const panel = document.querySelector('.glass-panel');
        const firstRow = rows()[0];
        out.panelTopToFirstRow = Math.round(
          firstRow.getBoundingClientRect().top - panel.getBoundingClientRect().top
        );
        out.panelTopToBar = Math.round(bar().getBoundingClientRect().top - panel.getBoundingClientRect().top);

        // Column alignment — the whole point of the two-tier structure.
        const labels = () => [...document.querySelectorAll('.track-header-label')];
        out.titleLabelX = Math.round(labels()[0].getBoundingClientRect().left);
        out.rowTitleX   = Math.round(firstRow.children[2].getBoundingClientRect().left);
        // Selected by label/class rather than position: Library's Duration
        // column no longer sits last now that ⋮ is a standalone trailing
        // slot and Album/Bitrate/Year/Genre can follow it.
        const timeLabel = labels().find(l => l.textContent.trim() === 'Time');
        out.timeLabelRight = Math.round(timeLabel.getBoundingClientRect().right);
        out.rowTimeRight   = Math.round(
          firstRow.querySelector('.track-row-duration').getBoundingClientRect().right
        );

        // Rows must be evenly pitched — a constant-offset scrollMargin error
        // would not show up here, but a broken virtualizer would.
        const tops = rows().slice(0, 6).map(r => Math.round(r.getBoundingClientRect().top));
        out.rowPitches = tops.slice(1).map((t, i) => t - tops[i]);

        // The Title column's five-step cycle, label text included — the label is
        // the only thing telling the user which state they're in.
        const titleLabel = () => labels()[0];
        out.cycle = [];
        for (let i = 0; i < 6; i++) {
          titleLabel().click();
          await sleep(320);
          // primary is the row's bold line. StackedCell promotes whichever of
          // title/artist is being sorted, so reading it also proves the flip.
          out.cycle.push({
            label: titleLabel().textContent.trim(),
            active: titleLabel().classList.contains('active'),
            primary: rows()[0].children[2].children[0].textContent,
            secondary: rows()[0].children[2].children[1]?.textContent ?? null,
          });
        }
        // Land back on manual for the remaining checks.
        titleLabel().click();
        await sleep(320);
        titleLabel().click();
        await sleep(320);
        titleLabel().click();
        await sleep(320);
        titleLabel().click();
        await sleep(350);
        out.settledManual = !titleLabel().classList.contains('active');

        // The header must be visually inert — no fill at ANY scroll position, so
        // it can never "turn dark" the way the sticky version did.
        const backdrop = (el) => {
          const s = getComputedStyle(el);
          const plain = s.getPropertyValue('backdrop-filter');
          const webkit = s.getPropertyValue('-webkit-backdrop-filter');
          return (plain && plain !== 'none' ? plain : webkit) || 'none';
        };
        out.bgAtRest = getComputedStyle(bar()).backgroundColor;
        out.barTopAtRest = Math.round(bar().getBoundingClientRect().top);

        scroller().scrollTop = 1500;
        await sleep(400);
        out.bgAfter = getComputedStyle(bar()).backgroundColor;
        out.blurAfter = backdrop(bar());
        out.barTopAfter = Math.round(bar().getBoundingClientRect().top);
        // Glassmorphism regression guard, and the reason it lives in the smoke
        // suite rather than a unit test: the bug only exists in the BUILT css.
        // Writing -webkit-backdrop-filter alongside the plain property makes
        // Vite's minifier keep only the -webkit- one, which Electron's Chromium
        // no longer supports — so every glass surface silently loses its blur in
        // the packaged app while still looking correct under the dev server.
        out.glassBlur = getComputedStyle(document.querySelector('.glass-panel')).getPropertyValue('backdrop-filter');
        out.barHeightScrolled = bar().offsetHeight;

        // Inter is bundled rather than fetched from Google. Same class of
        // silent failure as the blur above: if the woff2 assets don't resolve
        // under file:// in the packaged app, nothing errors — the UI just
        // quietly renders in -apple-system and looks subtly wrong. Load the
        // faces explicitly, then confirm they are genuinely usable.
        // NOT document.fonts.check(): it returns true for a family that does not
        // exist at all, because the text is still renderable via the fallback
        // chain. Verified — it answered true for '__SonusNoSuchFont__', which
        // would have made a "font loaded" assertion pass unconditionally.
        //
        // FontFace.status is the honest signal: it is 'loaded' only once the
        // woff2 actually resolved and parsed, and goes to 'error' when the URL
        // does not resolve, which is precisely the packaged-app failure mode
        // this guards against.
        await document.fonts.ready;
        await document.fonts.load('400 16px Inter');
        await document.fonts.load('700 16px Inter');
        const interFaces = [...document.fonts].filter(f => f.family === 'Inter');
        out.interFaces = interFaces.length;                                    // CSS shipped
        out.interLoadedFaces = interFaces.filter(f => f.status === 'loaded').length; // bytes resolved
        out.interErrorFaces = interFaces.filter(f => f.status === 'error').length;
        // Control: an absent family must enumerate to zero faces. If this ever
        // becomes non-zero the enumeration is not discriminating and the
        // assertions above are meaningless.
        out.bogusFaces = [...document.fonts].filter(f => f.family === '__SonusNoSuchFont__').length;
        out.bodyFont = getComputedStyle(document.body).fontFamily.split(',')[0].replace(/['"]/g, '').trim();
        // THE assertion for this design: nothing may be PAINTED over the header.
        // Deliberately a hit-test, not a rect comparison — getBoundingClientRect
        // still reports geometry for rows scrolled out of view and clipped by the
        // scroller, so a rect test flags invisible rows and proves nothing.
        const hitNames = () => {
          const br = bar().getBoundingClientRect();
          const y = br.top + br.height / 2;
          return [br.left + 40, br.left + br.width / 2, br.right - 40].map(x => {
            const el = document.elementFromPoint(x, y);
            if (!el) return 'null';
            if (el.closest('.track-row')) return 'ROW';
            return el.closest('.track-list-header') ? 'header' : 'other';
          });
        };
        out.headerHitTest = hitNames();
        // The scroll container itself must begin at or below the header's bottom.
        out.scrollerStartsBelowBar =
          scroller().getBoundingClientRect().top >= bar().getBoundingClientRect().bottom - 1;

        scroller().scrollTop = 0;
        await sleep(300);

        // Density's only entry point. Alignment must survive the switch, since
        // artSize 30 → 40 changes the leading spacer the labels are placed from.
        out.hasDensityToggle = !!document.querySelector('.track-header-density');
        document.querySelector('.track-header-density')?.click();
        await sleep(450);
        const cRow = rows()[0];
        out.comfortableBarHeight = bar().offsetHeight;
        out.comfortableTitleLabelX = Math.round(labels()[0].getBoundingClientRect().left);
        out.comfortableRowTitleX = Math.round(cRow.children[2].getBoundingClientRect().left);
        out.comfortableRowHeight = Math.round(cRow.getBoundingClientRect().height);
        document.querySelector('.track-header-density')?.click(); // restore compact
        await sleep(400);
        out.restoredRowHeight = Math.round(rows()[0].getBoundingClientRect().height);

        // The Sort dropdown is gone for good.
        out.sortChipGone = !document.querySelector('.track-header-sort-chip');

        // A search matching nothing must KEEP the bar (count + sort controls).
        // The search panel only mounts once opened — click the title bar's
        // search button first. (On Library its text also filters the list live,
        // which is what these assertions are about.)
        document.querySelector('.nav-search-btn')?.click();
        await sleep(300);
        const input = document.querySelector('.search-panel-input');
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSet.call(input, 'zzz-no-such-track-zzz');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(400);
        out.barSurvivesEmptySearch = !!bar();
        out.emptySearchMessage = document.body.textContent.includes('No tracks match');
        out.emptySearchRowCount = rows().length;
        nativeSet.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(400);

        // Detail views render the same hairline header, above their own scroller.
        window.__sonusTest.openDetail({ type: 'artist', key: 'Artist 1' });
        await sleep(500);
        out.detailBarHeight = document.querySelector('.track-list-header')?.offsetHeight ?? null;
        // Details has its own inner scroller, so it has its own scrollbar-gutter
        // question — measure it rather than assume Library's answer carries over.
        const dRow = document.querySelector('.track-row');
        const dLabels = [...document.querySelectorAll('.track-header-label')];
        if (dRow && dLabels.length) {
          out.detailTitleLabelX = Math.round(dLabels[0].getBoundingClientRect().left);
          out.detailRowTitleX = Math.round(dRow.children[2].getBoundingClientRect().left);
          // Selected by label/class rather than position: an artist detail
          // page now gets the same extra columns as Library, so Duration is
          // no longer necessarily the last header label or row child.
          const dTimeLabel = dLabels.find(l => l.textContent.trim() === 'Time');
          const dDurationCell = dRow.querySelector('.track-row-duration');
          out.detailTimeLabelRight = dTimeLabel ? Math.round(dTimeLabel.getBoundingClientRect().right) : null;
          out.detailRowTimeRight = dDurationCell ? Math.round(dDurationCell.getBoundingClientRect().right) : null;
        }
        window.__sonusTest.closeDetail();
        window.__sonusTest.setView('library');
        await sleep(300);

        // Empty library: no bar at all.
        window.__sonusTest.setLibrary([]);
        await sleep(350);
        out.emptyLibraryHasBar = !!document.querySelector('.track-list-header');
        out.emptyLibraryPrompt = document.body.textContent.includes('Drag and drop files here');
        return out;
      })()
    `, true);

    if (barResult.noHook) {
      failures.push('test hook (?test=1) not present in renderer');
    } else {
      const alpha = (rgb) => { const m = /rgba?\([^)]*?,\s*([\d.]+)\)$/.exec(rgb || ''); return m ? parseFloat(m[1]) : 1; };

      check(barResult.barHeightRest === 26, `header is a 26px hairline (${barResult.barHeightRest})`);
      check(barResult.identityGone, 'no Library title / song count / duration anywhere on the screen');

      // 16 top padding + 26 header + 6 gap = 48.
      check(Math.abs(barResult.panelTopToFirstRow - 48) <= 3,
        `panel top → first row is ~48px, was 135px (${barResult.panelTopToFirstRow})`);

      // The five-step Title cycle, verified by what the user actually sees.
      const cyc = barResult.cycle || [];
      const step = (i) => cyc[i] || {};
      check(step(0).label === 'Title' && step(0).primary === 'Bar Song 000' && step(0).active,
        `click 1 → Title a–z (${step(0).label} / ${step(0).primary})`);
      check(step(1).label === 'Title' && step(1).primary === 'Bar Song 299' && step(1).active,
        `click 2 → Title z–a (${step(1).label} / ${step(1).primary})`);
      // Sorting by artist also promotes artist to the row's bold line.
      check(step(2).label === 'Artist' && step(2).primary === 'Artist 0' && step(2).active,
        `click 3 → label renames to Artist, a–z, row flips (${step(2).label} / ${step(2).primary})`);
      check(step(3).label === 'Artist' && step(3).primary === 'Artist 9' && step(3).active,
        `click 4 → Artist z–a (${step(3).label} / ${step(3).primary})`);
      check(step(4).label === 'Title' && step(4).primary === 'Bar Song 000' && !step(4).active,
        `click 5 → manual, label reverts with no arrow (${step(4).label}, active ${step(4).active})`);
      check(step(5).label === 'Title' && step(5).primary === 'Bar Song 000' && step(5).active,
        `click 6 → cycle loops back to Title a–z (${step(5).label})`);
      check(barResult.settledManual === true, 'cycle settles back on manual');

      check(barResult.titleLabelX === barResult.rowTitleX,
        `TITLE label sits over the row title column (label ${barResult.titleLabelX} vs row ${barResult.rowTitleX})`);
      check(barResult.timeLabelRight === barResult.rowTimeRight,
        `TIME label sits over the row duration column (label ${barResult.timeLabelRight} vs row ${barResult.rowTimeRight})`);
      check(barResult.rowPitches.every(p => p === 44),
        `compact rows evenly pitched at 44px (${barResult.rowPitches.join(',')})`);

      // The three that define this design: nothing behind it, it never moves,
      // and it never paints a fill (so it can never visibly darken).
      check(!(barResult.headerHitTest || []).includes('ROW'),
        `no row is painted over the header while scrolled (${(barResult.headerHitTest || []).join(',')})`);
      check(barResult.scrollerStartsBelowBar, 'the scroll container begins below the header');
      check(barResult.barTopAtRest === barResult.barTopAfter,
        `header does not move when the list scrolls (${barResult.barTopAtRest} → ${barResult.barTopAfter})`);
      check(alpha(barResult.bgAtRest) === 0 && alpha(barResult.bgAfter) === 0,
        `header stays fully transparent at every scroll position (${barResult.bgAtRest} → ${barResult.bgAfter})`);
      check(barResult.blurAfter === 'none',
        `header needs no backdrop blur, having nothing behind it (${barResult.blurAfter})`);
      check(/^blur\(/.test(barResult.glassBlur || ''),
        `.glass-panel has a real blur in the BUILT css — glassmorphism intact (${barResult.glassBlur})`);
      check(barResult.interFaces > 0,
        `Inter @font-face rules present in the built CSS (${barResult.interFaces} faces)`);
      check(barResult.interLoadedFaces > 0,
        `bundled Inter woff2 actually resolved under file:// — not silently falling back to a system font (${barResult.interLoadedFaces} loaded, ${barResult.interErrorFaces} errored)`);
      check(barResult.interErrorFaces === 0,
        `no Inter face failed to load (${barResult.interErrorFaces} errored)`);
      check(barResult.bogusFaces === 0,
        `font enumeration is discriminating — an absent family yields no faces (${barResult.bogusFaces})`);
      check(barResult.bodyFont === 'Inter', `body renders in Inter (${barResult.bodyFont})`);
      check(barResult.barHeightRest === barResult.barHeightScrolled,
        `header height constant while scrolling (${barResult.barHeightRest} → ${barResult.barHeightScrolled})`);

      check(barResult.sortChipGone, 'the Sort chip and its dropdown are gone');
      check(barResult.hasDensityToggle, 'density has an entry point in the header');
      check(barResult.comfortableRowHeight === 56, `density toggle took effect (row ${barResult.comfortableRowHeight}px)`);
      check(barResult.restoredRowHeight === 44, `density toggle switches back (row ${barResult.restoredRowHeight}px)`);
      check(barResult.comfortableBarHeight === 26, `header stays 26px in comfortable density (${barResult.comfortableBarHeight})`);
      check(barResult.comfortableTitleLabelX === barResult.comfortableRowTitleX,
        `alignment survives the density switch (label ${barResult.comfortableTitleLabelX} vs row ${barResult.comfortableRowTitleX})`);

      check(barResult.barSurvivesEmptySearch, 'bar survives a search that matches nothing');
      check(barResult.emptySearchMessage, 'empty search still shows its message');
      check(barResult.emptySearchRowCount === 0, `empty search renders no rows (${barResult.emptySearchRowCount})`);

      check(barResult.detailBarHeight === 26, `detail view renders the same 26px hairline (${barResult.detailBarHeight})`);
      check(barResult.detailTitleLabelX === barResult.detailRowTitleX,
        `detail Title label sits over its column (label ${barResult.detailTitleLabelX} vs row ${barResult.detailRowTitleX})`);
      check(barResult.detailTimeLabelRight === barResult.detailRowTimeRight,
        `detail Time label sits over its column (label ${barResult.detailTimeLabelRight} vs row ${barResult.detailRowTimeRight})`);

      check(barResult.emptyLibraryHasBar === false, 'empty library renders no bar');
      check(barResult.emptyLibraryPrompt, 'empty library still shows its prompt');
    }

    // The header has to survive the window's 700px minWidth
    // (electron/main.js). Driven from the main process because only it can
    // resize the window.
    const originalBounds = mainWindow.getBounds();
    mainWindow.setContentSize(700, 600);
    await sleep(600);
    const narrow = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        window.__sonusTest.setLibrary([{
          title: 'A Really Quite Long Track Title For Overflow', artist: 'Some Artist',
          album: 'Album', albumArtist: '', year: 2001, duration: 245, genre: '',
          thumb: null, lyrics: null, trackNumber: '', trackTotal: '', discNumber: '',
          discTotal: '', composer: '', comment: '', bpm: '', bitrate: 320,
          codecProfile: null, dateAdded: 1, playCount: 0, lastPlayed: null,
          filePath: '/narrow/a.mp3',
        }]);
        await sleep(500);
        const bar = document.querySelector('.track-list-header');
        const row = document.querySelector('.track-row');
        const label = document.querySelectorAll('.track-header-label')[0];
        return {
          height: bar.offsetHeight,
          // No internal overflow: the meta must ellipsize, not push layout wider.
          overflowX: bar.scrollWidth - bar.clientWidth,
          bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          labelX: Math.round(label.getBoundingClientRect().left),
          rowTitleX: Math.round(row.children[2].getBoundingClientRect().left),
        };
      })()
    `, true);
    mainWindow.setBounds(originalBounds);
    await sleep(500);
    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.setLibrary([])`, true);
    await sleep(200);

    check(narrow.height === 26, `header stays 26px at the 700px minWidth (${narrow.height})`);
    check(narrow.overflowX <= 1, `bar does not overflow horizontally when narrow (${narrow.overflowX}px)`);
    check(narrow.bodyOverflow <= 1, `page does not scroll horizontally when narrow (${narrow.bodyOverflow}px)`);
    check(narrow.labelX === narrow.rowTitleX,
      `alignment holds at minWidth (label ${narrow.labelX} vs row ${narrow.rowTitleX})`);
  } catch (err) {
    failures.push(`library command bar error: ${err.stack || err}`);
  }

  // ── Mini player (window height <= MINI_LAYOUT_HEIGHT_BREAKPOINT, 420) ─────
  // Replaces the whole shell, which stays mounted underneath (hidden + inert)
  // so leaving mini mode returns to the same page. Driven from the main
  // process because only it can resize the window; plays a real file so the
  // transport controls act on a real <audio>.
  if (wants('mini')) try {
    const miniFile = path.join(app.getPath('userData'), 'smoke-mini.mp3');
    await fs.copyFile(path.join(__dirname, '..', 'test-fixture.mp3'), miniFile);
    const miniOriginalBounds = mainWindow.getBounds();
    mainWindow.setContentSize(1000, 700);
    await sleep(500);
    await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const cv = document.createElement('canvas'); cv.width = 40; cv.height = 40;
        const cx = cv.getContext('2d'); cx.fillStyle = '#d03a8a'; cx.fillRect(0, 0, 40, 40);
        window.__sonusTest.setLibrary([{
          title: 'Mini Smoke Track', artist: 'Mini Artist', album: 'Album', albumArtist: '',
          year: 2001, duration: 20, genre: '', thumb: cv.toDataURL(), lyrics: null, trackNumber: '',
          trackTotal: '', discNumber: '', discTotal: '', composer: '', comment: '', bpm: '',
          bitrate: 320, codecProfile: null, dateAdded: 1, playCount: 0, lastPlayed: null,
          filePath: ${JSON.stringify(miniFile)},
        }]);
        window.__sonusTest.setView('library');
        await sleep(500);
        document.querySelector('.track-row').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      })()
    `, true);
    await waitFor(`(() => { const a = document.querySelector('audio'); return !!a && !a.paused; })()`, v => v === true);

    const miniMeasure = `(() => {
      const mp = document.querySelector('.mini-player');
      const panel = document.querySelector('.glass-panel');
      const base = { mini: !!mp, panelOpacity: getComputedStyle(panel).opacity, panelInert: panel.inert,
        pills: document.querySelectorAll('.player-pill, .player-pill-wrapper').length };
      if (!mp) return base;
      const inner = mp.querySelector('.mini-content').getBoundingClientRect();
      const hittable = (el) => { const b = el.getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return h === el || el.contains(h); };
      // The expand button is also a <button>; the five transport controls are the rest.
      const buttons = Array.from(mp.querySelectorAll('button:not(.mini-restore-btn)'));
      return { ...base, buttonCount: buttons.length, buttonsHittable: buttons.every(hittable),
        seekHittable: hittable(mp.querySelector('input[type=range]')),
        // The seek line is 4px thick but must be grabbable from a ~24px box
        // (an earlier version shrank the input to its drawn height).
        seekHitBox: (() => { const r = mp.querySelector('input[type=range]'); const b = r.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2; return b.height >= 20 && document.elementFromPoint(x, y - 9) === r && document.elementFromPoint(x, y + 9) === r; })(),
        text: mp.textContent, fits: inner.top >= 0 && inner.bottom <= innerHeight && mp.scrollHeight <= mp.clientHeight,
        eqPlaying: !!mp.querySelector('.mini-eq--playing'),
        flares: Array.from(mp.querySelectorAll('.ambient-flare')).map(e => getComputedStyle(e).animationPlayState),
        flaresOpacity: (() => { const w = mp.querySelector('.ambient-flares'); return w ? getComputedStyle(w).opacity : null; })(),
        artGlow: (() => { const a = mp.querySelector('.np-artwork'); return !!a && a.style.boxShadow.includes('rgba('); })() };
    })()`;
    // Regression guard (unrelated to mini mode itself, but this block already
    // has the playing track that makes the floating pill appear): at ~1000px
    // wide the full-width pill reaches left under the detail hero's 35%-wide
    // column, and used to sit on top of its Play button. The hero's text block
    // now clears the pill by the same bottomClearance the track list uses.
    mainWindow.setContentSize(1000, 700);
    await sleep(400);
    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.openDetail({ type: 'artist', key: 'Mini Artist' })`, true);
    const heroPill = await waitFor(`(() => {
      const pill = document.querySelector('.player-pill');
      const play = document.querySelector('.detail-play-button');
      if (!pill || !play) return null;
      const a = pill.getBoundingClientRect(), b = play.getBoundingClientRect();
      return { gap: Math.round(a.top - b.bottom), overlap: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top };
    })()`, v => v && typeof v.gap === 'number');
    check(heroPill && heroPill.overlap === false && heroPill.gap >= 8,
      `detail hero's Play button clears the floating pill at 1000px wide (gap ${heroPill?.gap}px, overlap ${heroPill?.overlap})`);
    // The pill's seek line must read like Now Playing's and the mini player's:
    // the cyan-to-blue fill and the glowing white dot (not flat accent blue).
    // (Chromium returns "none" from getComputedStyle for slider pseudo-elements,
    // so read the rules out of the built stylesheet instead.)
    const pillSeek = await mainWindow.webContents.executeJavaScript(`(() => {
      const rules = [];
      const walk = (list) => { for (const r of list) { if (r.cssRules && !r.selectorText) walk(r.cssRules); else if (r.selectorText) rules.push(r); } };
      for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch {} }
      const find = (sel) => rules.filter(r => r.selectorText.includes(sel)).map(r => r.cssText).join(' ');
      return { exists: !!document.querySelector('.pill-seek-bar'),
               track: find('.pill-seek-bar::-webkit-slider-runnable-track'),
               thumb: find('.pill-seek-bar::-webkit-slider-thumb') };
    })()`, true);
    check(pillSeek.exists && /00f2fe|rgb\(0, ?242, ?254\)/i.test(pillSeek.track) && /4facfe|rgb\(79, ?172, ?254\)/i.test(pillSeek.track)
        && /(#fff\b|#ffffff|rgb\(255, ?255, ?255\))/i.test(pillSeek.thumb) && /box-shadow:[^;]*10px/.test(pillSeek.thumb.replace(/\s+/g, '')),
      "pill seek line has Now Playing's cyan-to-blue fill and glowing white dot");
    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.closeDetail(); window.__sonusTest.setView('library')`, true);
    await sleep(300);

    // An empty Library must not scroll: its empty state used to carry a
    // marginTop that collapsed through a height:100% parent and overflowed the
    // scroller by exactly that margin (100px).
    {
      const execE = (c) => mainWindow.webContents.executeJavaScript(c, true);
      await execE(`window.__emptyLibBackup = window.__sonusTest.getLibrary(); window.__sonusTest.setView('library'); window.__sonusTest.setLibrary([])`);
      const emptyLib = await waitFor(`(() => { const s = document.querySelector('.scrollable'); return s && document.body.textContent.includes('Drag and drop files here') ? { sh: s.scrollHeight, ch: s.clientHeight } : null; })()`, v => !!v);
      check(emptyLib && emptyLib.sh <= emptyLib.ch, `an empty Library has nothing to scroll (scrollHeight ${emptyLib?.sh}, clientHeight ${emptyLib?.ch})`);
      await execE(`window.__sonusTest.setLibrary(window.__emptyLibBackup); delete window.__emptyLibBackup`);
      await waitFor(`window.__sonusTest.getLibrary().length`, v => v > 0);
    }

    // ── Search panel (title bar button / ⌘F) ──────────────────────────────
    // A floating panel searching the whole library (grouped Artists / Albums /
    // Songs), scoped to the page on a Details page, AND live-filtering the list
    // behind it on Library/Details. Text and the panel never survive a page
    // change. Opens over Now Playing without leaving it.
    const exec = (c) => mainWindow.webContents.executeJavaScript(c, true);
    const setInput = (v) => `(() => { const i = document.querySelector('.search-panel-input'); const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`;
    const openSearchPanel = async () => {
      await exec(`document.querySelector('.nav-search-btn').click()`);
      return waitFor(`!!document.querySelector('.search-panel-input')`, v => v === true);
    };
    const panelText = `(() => { const p = document.querySelector('.search-panel'); return p ? p.textContent : null; })()`;

    await exec(`window.__sonusTest.openDetail({ type: 'artist', key: 'Mini Artist' })`);
    await waitFor(`!!document.querySelector('.detail-play-button')`, v => v === true);
    check(await openSearchPanel(), 'Search panel opens from the title bar button');
    const normalTop = await waitFor(`(() => { const p = document.querySelector('.search-panel'); return p ? Math.round(p.getBoundingClientRect().top) : null; })()`, v => v !== null && Math.abs(v - 92) <= 3);
    check(Math.abs(normalTop - 92) <= 3, `the search panel sits at the same place as before it moved to the root (top ${normalTop}px, expected 92)`);
    await exec(setInput('zzz-no-such-track-zzz'));
    const detailNone = await waitFor(`document.querySelectorAll('.track-row:not(.search-panel-song)').length === 0 && document.body.textContent.includes('No tracks match')`, v => v === true);
    check(detailNone === true, "Details page's own list live-filters behind the panel (no match -> no rows + message)");
    const detailHeroIntact = await exec(`document.body.textContent.includes('1 track') && !!document.querySelector('.detail-play-button') && !document.querySelector('.detail-play-button').disabled`);
    check(detailHeroIntact, "live filtering leaves the page's own track count and Play button alone");
    await exec(setInput('mini smoke'));
    const detailRows = await waitFor(`document.querySelectorAll('.track-row:not(.search-panel-song)').length`, v => v === 1);
    check(detailRows === 1, `Details list keeps matching tracks while typing (${detailRows})`);
    const scoped = await waitFor(panelText, v => typeof v === 'string' && v.includes('Songs'));
    check(typeof scoped === 'string' && scoped.includes('Mini Smoke Track') && !scoped.includes('Artists'),
      `on a Details page the panel starts scoped to that page: songs only (${String(scoped).slice(0, 70)})`);
    await exec(`document.querySelector('.search-panel-chip').click()`);
    // "mini smoke" is a substring of the song title but not of the artist name,
    // so widen with a shorter query that matches both.
    await exec(setInput('mini'));
    const widened = await waitFor(panelText, v => typeof v === 'string' && v.includes('Artists'));
    check(typeof widened === 'string' && widened.includes('Artists') && widened.includes('Mini Artist'),
      'the scope chip widens the panel to the whole library (Artists appear)');

    await exec(`window.__sonusTest.closeDetail(); window.__sonusTest.setView('home')`);
    const closedOnLeave = await waitFor(`!document.querySelector('.search-panel')`, v => v === true);
    check(closedOnLeave === true, 'changing page closes the search panel');
    check(await openSearchPanel(), 'Search panel opens on Home');
    await exec(setInput('a'));
    // 'a' appears in the artist (Mini Artist), the album (Album) and the song
    // (Mini Smoke Track), so all three groups must show.
    const homeResults = await waitFor(panelText, v => typeof v === 'string' && v.includes('Songs'));
    check(typeof homeResults === 'string' && ['Artists', 'Albums', 'Songs', 'Mini Smoke Track', 'Mini Artist', 'Album'].every(t => homeResults.includes(t)),
      `panel shows grouped Artists / Albums / Songs results (${String(homeResults).slice(0, 80)})`);
    await exec(setInput('zzz-no-such-thing-zzz'));
    const homeNone = await waitFor(panelText, v => typeof v === 'string' && v.includes('No results'));
    check(typeof homeNone === 'string' && homeNone.includes('No results'), 'panel says so when nothing matches');
    await exec(setInput(''));
    const bodyGone = await waitFor(`!document.querySelector('.search-panel-body')`, v => v === true);
    check(bodyGone === true, 'clearing the text collapses the panel back to just its field');
    await exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    const escClosed = await waitFor(`!document.querySelector('.search-panel')`, v => v === true);
    check(escClosed === true, 'Escape closes the panel once the text is clear');

    // Clicking outside closes the panel and ONLY closes it: the gesture is
    // swallowed so nothing behind reacts; inside the panel and non-primary
    // buttons are ignored. On Library/Details the filter then stays on the list.
    const pdown = (sel, button = 0) => `document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: ${button} }))`;
    const gesture = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)});
      for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0 }));
      for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    })()`;
    await exec(`window.__seen = []; ['pointerdown', 'click'].forEach(t => document.addEventListener(t, e => window.__seen.push(t)));`);
    check(await openSearchPanel(), 'Search panel opens again on Home');
    await exec(setInput('a'));
    await exec(pdown('.search-panel-input'));
    await exec(pdown('body', 2));
    await sleep(150);
    check(await exec(`!!document.querySelector('.search-panel')`), 'clicking inside the panel or right-clicking outside does not close it');
    await exec(`window.__seen = []`);
    await exec(gesture('body'));
    const outsideClosed = await waitFor(`!document.querySelector('.search-panel')`, v => v === true);
    check(outsideClosed === true, 'clicking outside the panel closes it');
    const swallowed = await exec(`window.__seen.filter(t => t === 'click').length`);
    check(swallowed === 0, `the click that closed the panel does not reach what is behind it (${swallowed} clicks seen)`);
    await sleep(900);
    await exec(`window.__seen = []; document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    check(await exec(`window.__seen.filter(t => t === 'click').length`) === 1, 'clicks work normally again right after the panel is gone');
    check(await exec(`document.querySelector('.nav-search-btn').classList.contains('active')`) === false, 'on Home nothing is filtered, so the search button is not highlighted');

    await exec(`window.__sonusTest.setView('library')`);
    await waitFor(`window.__sonusTest.getView()`, v => v === 'library');
    check(await openSearchPanel(), 'Search panel opens on Library');
    await exec(setInput('mini'));
    await waitFor(`document.querySelectorAll('.track-row:not(.search-panel-song)').length`, v => v === 1);
    await exec(`window.__seen = []`);
    await exec(gesture('.track-row:not(.search-panel-song)'));
    const libClosed = await waitFor(`!document.querySelector('.search-panel')`, v => v === true);
    check(libClosed === true, 'on Library, clicking a row outside the panel closes it (rows are not exempt)');
    check(await exec(`window.__seen.filter(t => t === 'click').length`) === 0, 'and that click does not select or play the row behind');
    const kept = await exec(`({ rows: document.querySelectorAll('.track-row').length, active: document.querySelector('.nav-search-btn').classList.contains('active') })`);
    check(kept.rows === 1 && kept.active === true, `Library stays filtered after dismissal and the search button shows it (${JSON.stringify(kept)})`);
    await sleep(900);
    check(await openSearchPanel(), 'reopening search works while the list is filtered');
    const reopened = await exec(`document.querySelector('.search-panel-input').value`);
    check(reopened === 'mini', `reopened panel still holds the filter text (${reopened})`);
    await exec(setInput('zzz-no-such-track-zzz'));
    const noRows = await waitFor(`document.querySelectorAll('.track-row:not(.search-panel-song)').length`, v => v === 0);
    check(noRows === 0, 'the Library list filters live again once reopened');
    await exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    const listBack = await waitFor(`document.querySelectorAll('.track-row:not(.search-panel-song)').length`, v => v >= 1);
    check(listBack >= 1, `Escape clears the text and the full Library list returns (${listBack} rows)`);
    await exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    const cleared = await waitFor(`!document.querySelector('.search-panel')`, v => v === true);
    check(cleared === true, 'a second Escape closes the panel');
    check(await exec(`document.querySelector('.nav-search-btn').classList.contains('active')`) === false, 'with nothing filtered the search button is not highlighted');

    // Over Now Playing: the panel opens in place (no page change), and an
    // artist result opens its Details page with a back button to Now Playing.
    await exec(`window.__sonusTest.setView('library')`);
    await exec(`document.querySelector('.player-pill').click()`);
    const inNP = await waitFor(`window.__sonusTest.getView()`, v => v === 'now_playing');
    check(await openSearchPanel(), 'Search panel opens over Now Playing');
    const stayedOnNP = await exec(`window.__sonusTest.getView()`);
    check(inNP === 'now_playing' && stayedOnNP === 'now_playing', `opening search does not leave Now Playing (${stayedOnNP})`);
    await exec(setInput('mini'));
    await waitFor(`!!document.querySelector('.search-panel-tile')`, v => v === true);
    await exec(`document.querySelector('.search-panel-tile').click()`);
    const toDetail = await waitFor(`({ view: window.__sonusTest.getView(), detail: !!document.querySelector('.detail-play-button'), panel: !!document.querySelector('.search-panel'), back: (document.querySelector('.np-back-button') || {}).textContent || '' })`,
      v => v && v.detail);
    check(toDetail?.view === 'home' && toDetail?.panel === false && toDetail?.back.includes('Now Playing'),
      `an artist result opens its page, closes the panel, and offers a way back to Now Playing (${JSON.stringify(toDetail)})`);
    await exec(`window.__sonusTest.closeDetail(); window.__sonusTest.setView('library')`);
    await sleep(300);

    // ── Chill mode: Now Playing as a turntable (ChillScene.jsx) ─────────────
    // The photo fills Now Playing, the artwork is the spinning record, and the
    // framing must keep the record in view and clear of the bar at every
    // window shape. Playing track from the mini block above.
    {
      const execC = (c) => mainWindow.webContents.executeJavaScript(c, true);
      // macOS has no getter for the traffic lights; main.js records the last
      // requested state on the window (setWindowButtons).
      const lights = async (want) => {
        for (let i = 0; i < 40; i++) { if (mainWindow.__sonusButtonsVisible === want) return true; await sleep(150); }
        return mainWindow.__sonusButtonsVisible;
      };
      const chrome = `(() => { const q = (s) => document.querySelector(s); const op = (s) => (q(s) ? getComputedStyle(q(s)).opacity : null);
        return { idle: !!q('.chill-scene--idle'), bar: op('.chill-bar'), tabs: op('.nav-pill'), search: op('.nav-search-btn'), add: op('.nav-add-btn'), exit: op('.chill-exit-btn'), scene: op('.chill-scene-btn'),
          tabsInert: !!q('.nav-pill')?.inert, exitInert: !!q('.chill-exit-btn')?.inert }; })()`;
      const allOpacity = (v, o) => v && [v.bar, v.tabs, v.search, v.add, v.exit, v.scene].every(x => x === o);
      mainWindow.setContentSize(1000, 700);
      await sleep(400);
      // The fixture is only 20s long and this block runs longer than that from
      // the moment playback started — loop it so it can't end underneath us.
      await execC(`(() => { const a = document.querySelector('audio'); a.loop = true; })()`);
      await execC(`window.__sonusTest.setView('library')`);
      await execC(`document.querySelector('.player-pill').click()`);
      await waitFor(`window.__sonusTest.getView()`, v => v === 'now_playing');
      check(await waitFor(`!!document.querySelector('.chill-enter-btn')`, v => v === true) === true, 'full-width Now Playing offers a Chill mode button');
      await execC(`document.querySelector('.chill-enter-btn').click()`);
      const sceneUp = await waitFor(`(() => { const s = document.querySelector('.chill-scene'); const p = document.querySelector('.chill-photo'); return !!s && !!p && p.complete && p.naturalWidth === 2752; })()`, v => v === true);
      check(sceneUp === true, 'Chill mode shows the turntable photo (loaded at full size)');
      const bleed = await execC(`(() => { const r = document.querySelector('.chill-scene').getBoundingClientRect(); const d = document.querySelector('.chill-drag-strip').getBoundingClientRect();
        return { l: r.left, t: r.top, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight, stripTop: d.top, stripH: d.height, region: getComputedStyle(document.querySelector('.chill-drag-strip')).getPropertyValue('-webkit-app-region') }; })()`);
      check(bleed.l === 0 && bleed.t === 0 && Math.abs(bleed.w - bleed.iw) < 1 && Math.abs(bleed.h - bleed.ih) < 1,
        `the photo fills the whole window, title strip included (${JSON.stringify(bleed)})`);
      check(bleed.stripTop === 0 && bleed.stripH === 42 && bleed.region === 'drag', `a 42px drag band keeps the window movable from the top edge (${bleed.stripH}px, ${bleed.region})`);
      check(await execC(`!!document.querySelector('.chill-exit-btn')`), 'the exit button joins the title strip');
      // Electron's draggable area is built in DOCUMENT ORDER (a later drag region
      // is unioned over earlier ones, a later no-drag subtracted), not z-index.
      // The drag band must therefore precede every title-strip button, or it
      // re-claims their area as draggable and none of them can be clicked (this
      // shipped broken once: JS .click() in tests bypasses the OS drag layer).
      const regionOrder = await execC(`(() => { const strip = document.querySelector('.chill-drag-strip');
        return ['.nav-pill', '.nav-search-btn', '.nav-add-btn', '.chill-exit-btn', '.chill-scene-btn'].map(sel => { const el = document.querySelector(sel);
          return { sel, region: getComputedStyle(el).getPropertyValue('-webkit-app-region'), after: !!(strip.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) }; }); })()`);
      check(regionOrder.every(o => o.region === 'no-drag' && o.after),
        `every title-strip button is no-drag AND comes after the drag band in document order, so it stays clickable (${JSON.stringify(regionOrder)})`);
      // Every strip button must be the TOPMOST thing at its own position — a
      // layer over it would swallow the click just as surely as a drag region.
      const hitTest = await execC(`(() => { const out = {}; const sels = { home: '.nav-pill-btn:nth-child(1)', library: '.nav-pill-btn:nth-child(2)', search: '.nav-search-btn', add: '.nav-add-btn', exit: '.chill-exit-btn', scene: '.chill-scene-btn', menu: '[data-chill-menu-btn]', transport: '.chill-transport button' };
        for (const [k, s] of Object.entries(sels)) { const el = document.querySelector(s); if (!el) { out[k] = false; continue; } const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); out[k] = !!top && (top === el || el.contains(top)); }
        return out; })()`);
      check(Object.values(hitTest).every(Boolean), `every title-strip button and the transport controls are topmost at their own position (${JSON.stringify(hitTest)})`);
      // The search panel opens OVER Chill mode. It used to render inside the
      // glass card (a stacking context of its own), so the full-window photo
      // covered it completely and the button seemed to do nothing.
      await execC(`document.querySelector('.nav-search-btn').click()`);
      const overChill = await waitFor(`(() => { const p = document.querySelector('.search-panel'); if (!p) return null; const r = p.getBoundingClientRect(); if (r.width < 400) return null; const top = document.elementFromPoint(r.left + r.width / 2, r.top + 24);
        return { top: Math.round(r.top), onTop: !!top && !!top.closest('.search-panel') }; })()`, v => v && v.onTop === true && Math.abs(v.top - 92) <= 3); // the panel scales in: wait for it to settle
      check(overChill && overChill.onTop === true && Math.abs(overChill.top - 92) <= 3, `the search panel is visible on top of Chill mode, at its usual position (${JSON.stringify(overChill)})`);
      await execC(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      const afterEsc = await waitFor(`({ panel: !!document.querySelector('.search-panel'), scene: !!document.querySelector('.chill-scene') })`, v => v && v.panel === false);
      check(afterEsc && afterEsc.panel === false && afterEsc.scene === true, `Escape closes the search panel first and stays in Chill mode (${JSON.stringify(afterEsc)})`);
      // ── the ⋮ track menu in the Chill bar (the same menu the pill and Now Playing open) ──
      const menuBtn = await execC(`(() => { const b = document.querySelector('[data-chill-menu-btn]'); const bar = document.querySelector('.chill-bar').getBoundingClientRect(); if (!b) return null; const r = b.getBoundingClientRect(); return { inBar: r.left >= bar.left && r.right <= bar.right && r.top >= bar.top && r.bottom <= bar.bottom, label: b.getAttribute('aria-label') }; })()`);
      check(menuBtn && menuBtn.inBar && menuBtn.label === 'More', `the Chill bar has a ⋮ button inside it (${JSON.stringify(menuBtn)})`);
      await execC(`document.querySelector('[data-chill-menu-btn]').click()`);
      const menuOpen = await waitFor(`(() => { const m = document.querySelector('.track-dropdown'); if (!m) return null; const r = m.getBoundingClientRect(); const b = document.querySelector('[data-chill-menu-btn]').getBoundingClientRect(); const it = m.querySelector('.track-dropdown-item'); const ir = it.getBoundingClientRect(); const top = document.elementFromPoint(ir.left + 20, ir.top + ir.height / 2);
        return { items: [...m.querySelectorAll('.track-dropdown-item')].map(i => i.textContent.trim()), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, above: r.bottom <= b.top + 8, hit: !!top && !!top.closest('.track-dropdown') }; })()`, v => v && v.items.length > 0);
      check(menuOpen && menuOpen.items.join('|') === 'Start Mix|Edit Tags…|Reveal in Finder|Search in YouTube' && menuOpen.inView && menuOpen.above && menuOpen.hit,
        `the ⋮ opens the track menu over the photo: all four items, inside the window, above the bar, on top (${JSON.stringify(menuOpen)})`);
      // the chrome is held up while the menu is open, even past the idle time
      await sleep(4800);
      check(await execC(`getComputedStyle(document.querySelector('.chill-bar')).opacity`) === '1' && await execC(`!document.querySelector('.chill-scene--idle')`), 'the bar stays up while the menu is open (it does not fade out from under it)');
      // Escape closes the menu first and stays in Chill mode
      await execC(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      const afterMenuEsc = await waitFor(`({ menu: !!document.querySelector('.track-dropdown'), scene: !!document.querySelector('.chill-scene') })`, v => v && v.menu === false);
      check(afterMenuEsc && afterMenuEsc.menu === false && afterMenuEsc.scene === true, `Escape closes the menu first and stays in Chill mode (${JSON.stringify(afterMenuEsc)})`);
      // the button toggles it, and a click anywhere else closes it
      await execC(`document.querySelector('[data-chill-menu-btn]').click()`);
      check(await waitFor(`!!document.querySelector('.track-dropdown')`, v => v === true) === true, 'the ⋮ opens it again');
      await execC(`document.querySelector('[data-chill-menu-btn]').click()`);
      check(await waitFor(`!document.querySelector('.track-dropdown')`, v => v === true) === true, 'clicking the ⋮ again closes it (a toggle)');
      await execC(`document.querySelector('[data-chill-menu-btn]').click()`);
      await waitFor(`!!document.querySelector('.track-dropdown')`, v => v === true);
      await execC(`document.querySelector('.chill-photo').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      check(await waitFor(`!document.querySelector('.track-dropdown')`, v => v === true) === true, 'a click elsewhere closes it');
      check(await lights(true) === true, 'the traffic lights are shown while the chrome is up');
      check(await execC(`document.querySelectorAll('.ambient-flare').length`) === 0, "Chill mode doesn't also run Now Playing's blurred lights");
      check(await execC(`!document.querySelector('.np-artwork')`), "Chill mode replaces Now Playing's own artwork card");

      // the spin: runs at full speed while playing, and the art really rotates
      const spinning = await waitFor(`(() => { const a = document.querySelector('.chill-spin')?.getAnimations()[0]; return a ? { s: a.playState, r: a.playbackRate } : null; })()`, v => v && v.s === 'running' && v.r > 0.95);
      check(spinning && spinning.s === 'running' && spinning.r > 0.95, `the record spins at full speed while playing (${JSON.stringify(spinning)})`);
      const angle = `(() => { const m = new DOMMatrix(getComputedStyle(document.querySelector('.chill-spin')).transform); return Math.atan2(m.b, m.a) * 180 / Math.PI; })()`;
      const a1 = await execC(angle); await sleep(250); const a2 = await execC(angle);
      check(Math.abs(a2 - a1) > 5 && a2 !== a1, `the artwork's angle actually changes (${a1.toFixed(1)}° -> ${a2.toFixed(1)}°)`);
      const css = await execC(`(() => ({ mask: getComputedStyle(document.querySelector('.chill-grooves')).maskImage, blur: getComputedStyle(document.querySelector('.chill-bar')).backdropFilter }))()`);
      check(css.mask !== 'none' && String(css.blur).includes('blur'), `built CSS keeps the groove mask and the bar's blur (${JSON.stringify(css)})`);

      // framing at several window shapes: covered, record in view, clear of the bar
      const framing = `(() => {
        const s = document.querySelector('.chill-scene').getBoundingClientRect();
        const st = document.querySelector('.chill-stage').getBoundingClientRect();
        const d = document.querySelector('.chill-disc').getBoundingClientRect();
        const b = document.querySelector('.chill-bar').getBoundingClientRect();
        return { w: s.width, h: s.height, covered: st.left <= s.left + 1 && st.top <= s.top + 1 && st.right >= s.right - 1 && st.bottom >= s.bottom - 1,
          inView: d.left >= s.left - 1 && d.right <= s.right + 1 && d.top >= s.top - 1 && d.bottom <= s.bottom + 1,
          clearOfBar: d.bottom <= b.top + 1, frac: d.width / s.width };
      })()`;
      for (const [w, h] of [[1000, 700], [1600, 900], [700, 900], [1400, 500], [2200, 700]]) {
        mainWindow.setContentSize(w, h);
        // The size changes first and the stage's transform follows a frame later
        // (ResizeObserver -> state), so wait for the framing to be consistent —
        // "covered" is false before it settles, true after (and a real failure
        // still returns the last value, so the check below still fails).
        let f = await waitFor(framing, v => v && Math.abs(v.w - w) < 4 && v.covered);
        // ...and a stale stage can also look "covered" (a bigger one covers a
        // smaller box), so require two identical samples before judging.
        for (let i = 0; i < 20; i++) {
          await sleep(200);
          const f2 = await execC(framing);
          const same = JSON.stringify(f2) === JSON.stringify(f);
          f = f2;
          if (same && f.covered) break;
        }
        check(f && f.covered && f.inView && f.clearOfBar && f.frac > 0.3 && f.frac < 0.8,
          `framing at ${w}x${h}: photo covers, record in view and clear of the bar, ~${Math.round((f?.frac || 0) * 100)}% wide (${JSON.stringify(f)})`);
      }
      mainWindow.setContentSize(1000, 700);
      await sleep(300);

      // the whole chrome melts away together after a quiet few seconds while
      // playing: the bar, the title strip's buttons, and the traffic lights
      const gone = await waitFor(chrome, v => allOpacity(v, '0'), 9000);
      check(allOpacity(gone, '0') && gone.idle && gone.tabsInert && gone.exitInert,
        `bar, tabs, search, add and exit all fade out together and stop taking clicks (${JSON.stringify(gone)})`);
      check(await lights(false) === true, 'the traffic lights hide once the fade has finished');
      // ...and come back when the pointer moves (reported by main, since the
      // title strip is a drag area the page never sees the pointer over)
      mainWindow.webContents.send('window:pointer-moved');
      const back = await waitFor(chrome, v => allOpacity(v, '1'));
      check(allOpacity(back, '1') && !back.idle && !back.tabsInert, `a pointer move from main brings all of it back (${JSON.stringify(back)})`);
      check(await lights(true) === true, 'the traffic lights return at once with the chrome');
      // resting the pointer on a chrome element keeps it up. A synthetic DOM event
      // would not do: what counts is the browser's own :hover (a remembered flag from
      // an earlier move went stale whenever the pointer left without an event, and held
      // the chrome up forever), so use genuine input — sendInputEvent reaches the
      // renderer's widget and updates hover state, unlike a dispatched event.
      const barCentre = await execC(`(() => { const r = document.querySelector('.chill-bar').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: barCentre.x, y: barCentre.y });
      const hoverTook = await waitFor(`!!document.querySelector('[data-chill-chrome]:hover')`, v => v === true);
      check(hoverTook === true, 'a genuine pointer over the bar registers as :hover');
      await sleep(4600);
      check(allOpacity(await execC(chrome), '1'), 'the chrome stays up while the pointer rests on it');
      mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 12, y: 300 }); // off the chrome (open photo)
      await waitFor(chrome, v => allOpacity(v, '0'), 9000);
      await execC(`document.querySelector('audio').pause()`);
      const stopped = await waitFor(`(() => { const sc = document.querySelector('.chill-scene'); const a = document.querySelector('.chill-spin')?.getAnimations()[0]; return { idle: sc.classList.contains('chill-scene--idle'), s: a?.playState }; })()`, v => v && v.s === 'paused', 9000);
      check(stopped && stopped.s === 'paused' && stopped.idle === false, `pausing eases the record to a stop and brings the controls back (${JSON.stringify(stopped)})`);
      check(allOpacity(await waitFor(chrome, v => allOpacity(v, '1')), '1') && await lights(true) === true, 'while paused the whole chrome (and the traffic lights) stays up');
      await execC(`document.querySelector('audio').play()`);
      const again = await waitFor(`(() => { const a = document.querySelector('.chill-spin')?.getAnimations()[0]; return a ? { s: a.playState, r: a.playbackRate } : null; })()`, v => v && v.s === 'running' && v.r > 0.95, 9000);
      check(again && again.s === 'running', 'playing again spins it back up');

      // the exit button in the title strip leaves Chill mode and restores everything
      mainWindow.webContents.send('window:pointer-moved');
      await waitFor(chrome, v => allOpacity(v, '1'));
      await execC(`document.querySelector('.chill-exit-btn').click()`);
      const exited = await waitFor(`({ scene: !!document.querySelector('.chill-scene'), exit: !!document.querySelector('.chill-exit-btn'), tabs: getComputedStyle(document.querySelector('.nav-pill')).opacity, view: window.__sonusTest.getView() })`, v => v && v.scene === false);
      check(exited && !exited.scene && !exited.exit && exited.view === 'now_playing' && exited.tabs === '1', `the exit button leaves Chill mode (${JSON.stringify(exited)})`);
      check(await lights(true) === true, 'leaving Chill mode keeps the traffic lights visible');
      await execC(`window.__sonusTest.setChillMode(true)`);
      await waitFor(`!!document.querySelector('.chill-scene')`, v => v === true);
      await waitFor(chrome, v => allOpacity(v, '0'), 9000);
      check(await lights(false) === true, 'back in Chill mode the lights hide again after the idle fade');

      // the preference survives a narrow excursion but only renders where it can
      mainWindow.setContentSize(500, 700);
      await waitFor(`!document.querySelector('.chill-scene')`, v => v === true);
      check(await execC(`!document.querySelector('.chill-scene') && !document.querySelector('.chill-enter-btn')`), 'narrow windows get no Chill mode (and no button)');
      check(await lights(true) === true, 'going narrow while the lights were hidden puts them back');
      check(await execC(`getComputedStyle(document.querySelector('.nav-pill')).opacity`) === '1', 'and the title strip is back too');
      mainWindow.setContentSize(1000, 700);
      check(await waitFor(`!!document.querySelector('.chill-scene')`, v => v === true) === true, 'growing back to full width restores Chill mode');

      // Escape leaves Chill mode but not Now Playing
      await execC(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      const left = await waitFor(`({ scene: !!document.querySelector('.chill-scene'), view: window.__sonusTest.getView(), back: !!document.querySelector('.np-back-button') })`, v => v && v.scene === false);
      check(left && left.scene === false && left.view === 'now_playing' && left.back, `Escape exits Chill mode and stays on Now Playing (${JSON.stringify(left)})`);
      await execC(`(() => { const a = document.querySelector('audio'); a.loop = false; a.currentTime = 0; })()`);
      await execC(`window.__sonusTest.setView('library')`);
      await sleep(300);
    }

    // ── Chill scenes: the picker, the hammock scene, its live phone screen, and
    // the animated photo (ChillBeach.jsx, ChillLivingPhoto.jsx) ───────────────
    {
      const execS = (c) => mainWindow.webContents.executeJavaScript(c, true);
      mainWindow.setContentSize(1000, 700);
      await sleep(400);
      await execS(`(() => { const a = document.querySelector('audio'); a.loop = true; if (a.paused) a.play().catch(() => {}); })()`);
      await execS(`window.__sonusTest.setView('library')`);
      await execS(`document.querySelector('.player-pill').click()`);
      await waitFor(`window.__sonusTest.getView()`, v => v === 'now_playing');
      await execS(`window.__sonusTest.setChillScene('turntable'); window.__sonusTest.setChillMode(true)`);
      await waitFor(`!!document.querySelector('.chill-scene[data-scene="turntable"]')`, v => v === true);
      const wakeChrome = async () => {
        mainWindow.webContents.send('window:pointer-moved');
        await waitFor(`getComputedStyle(document.querySelector('.chill-scene-btn')).opacity`, v => v === '1');
      };
      await wakeChrome();

      // the picker
      await execS(`document.querySelector('.chill-scene-btn').click()`);
      const picker = await waitFor(`(() => { const p = document.querySelector('.chill-picker'); if (!p) return null; const r = p.getBoundingClientRect(); const top = document.elementFromPoint(r.left + 30, r.top + 30);
        return { items: [...p.querySelectorAll('.chill-picker-item')].map(b => b.dataset.sceneId + (b.classList.contains('active') ? '*' : '')), onTop: !!top && !!top.closest('.chill-picker') }; })()`, v => v && v.items.length > 0);
      check(picker && picker.items.join() === 'turntable*,beach,room' && picker.onTop, `the scene picker lists all three scenes, marks the current one, and sits on top (${JSON.stringify(picker)})`);
      await execS(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      const escPicker = await waitFor(`({ picker: !!document.querySelector('.chill-picker'), scene: !!document.querySelector('.chill-scene') })`, v => v && v.picker === false);
      check(escPicker && escPicker.picker === false && escPicker.scene === true, `Escape closes the picker first and stays in Chill mode (${JSON.stringify(escPicker)})`);
      await execS(`document.querySelector('.chill-scene-btn').click()`);
      await waitFor(`!!document.querySelector('.chill-picker')`, v => v === true);
      await execS(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))`);
      check(await waitFor(`!document.querySelector('.chill-picker')`, v => v === true) === true, 'a click outside the picker closes it');

      // choosing the hammock
      await execS(`document.querySelector('.chill-scene-btn').click()`);
      await waitFor(`!!document.querySelector('.chill-picker')`, v => v === true);
      await execS(`document.querySelector('.chill-picker-item[data-scene-id="beach"]').click()`);
      const chose = await waitFor(`({ scene: document.querySelector('.chill-scene')?.dataset.scene, picker: !!document.querySelector('.chill-picker'), saved: window.localStorage.getItem('sonus.chillScene'), hook: window.__sonusTest.getChillScene() })`, v => v && v.scene === 'beach');
      check(chose && chose.scene === 'beach' && !chose.picker && chose.saved === 'beach' && chose.hook === 'beach', `choosing the hammock switches scene, closes the picker and remembers the choice (${JSON.stringify(chose)})`);
      const photoUp = await waitFor(`(() => { const p = document.querySelector('.chill-scene[data-scene="beach"] .chill-photo'); return !!p && p.complete && p.naturalWidth === 2752; })()`, v => v === true);
      check(photoUp === true, 'the hammock photo loads at full size');

      // the animated photo: WebGL running, and really drawing frames
      const live = await waitFor(`(() => { const c = document.querySelector('.chill-living'); return c ? { gl: c.dataset.gl, live: c.dataset.live, frames: Number(c.dataset.frames || 0) } : null; })()`, v => v && v.gl !== 'pending' && (v.gl === 'fallback' || v.frames >= 10), 9000);
      check(live && live.gl === 'ok' && live.live === 'true', `the photo is drawn by WebGL with its palm and sea masks (${JSON.stringify(live)})`);
      await sleep(1200);
      const live2 = await execS(`Number(document.querySelector('.chill-living').dataset.frames || 0)`);
      check(live && live2 > live.frames + 10, `the animation keeps drawing frames (${live?.frames} -> ${live2})`);

      // the hammock swings, and the phone's overlay swings with it, on BOTH axes (an
      // ellipse): its wrapper's transform is rewritten every frame by the same sway
      // the shader uses
      const swayOf = `(() => { const m = /translate\\(([-0-9.]+)px, ([-0-9.]+)px\\)/.exec(document.querySelector('.chill-phone-sway')?.style.transform || ''); return m ? [parseFloat(m[1]), parseFloat(m[2])] : null; })()`;
      const swaySamples = [];
      for (let i = 0; i < 10; i++) { swaySamples.push(await execS(swayOf)); await sleep(450); }
      const okSamples = swaySamples.every(v => Array.isArray(v));
      const xs = swaySamples.filter(Array.isArray).map(v => v[0]), ys = swaySamples.filter(Array.isArray).map(v => v[1]);
      const rng = (a) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
      check(okSamples && rng(xs) > 0.5 && rng(ys) > 0.5 && Math.max(...xs.map(Math.abs)) < 12 && Math.max(...ys.map(Math.abs)) < 12,
        `the phone overlay swings gently with the hammock on both axes (x range ${rng(xs).toFixed(2)}px, y range ${rng(ys).toFixed(2)}px over ${swaySamples.length} samples)`);

      // the phone screen is live: real title and artist, a moving progress bar,
      // and a play/pause icon that follows the real state
      const phone = await waitFor(`(() => { const p = document.querySelector('[data-chill-phone]'); if (!p) return null; return { text: p.textContent, state: p.querySelector('[data-chill-phone-state]')?.dataset.chillPhoneState, bar: parseFloat(p.querySelector('.chill-phone-progress > div').style.width) || 0 }; })()`, v => v && v.bar > 0);
      check(phone && phone.text.includes('Mini Smoke Track') && phone.text.includes('Mini Artist') && phone.state === 'playing', `the phone shows the real title and artist and a pause icon while playing (${JSON.stringify(phone)})`);
      const bar1 = phone ? phone.bar : 0;
      await sleep(1500);
      const bar2 = await execS(`parseFloat(document.querySelector('.chill-phone-progress > div').style.width) || 0`);
      check(bar2 > bar1, `the phone's progress bar moves with playback (${bar1.toFixed(2)}% -> ${bar2.toFixed(2)}%)`);
      await execS(`document.querySelector('audio').pause()`);
      const paused = await waitFor(`document.querySelector('[data-chill-phone-state]')?.dataset.chillPhoneState`, v => v === 'paused');
      check(paused === 'paused', 'the phone shows a play icon once paused');
      await execS(`document.querySelector('audio').play()`);
      check(await waitFor(`document.querySelector('[data-chill-phone-state]')?.dataset.chillPhoneState`, v => v === 'playing') === 'playing', 'and a pause icon again when playing resumes');
      check(await execS(`getComputedStyle(document.querySelector('[data-chill-phone]')).pointerEvents`) === 'none', 'the phone is a picture, not a control (pointer-events none)');

      // framing at several window shapes: covered, phone in view and clear of the bar
      const beachFraming = `(() => {
        const s = document.querySelector('.chill-scene').getBoundingClientRect();
        const st = document.querySelector('.chill-stage').getBoundingClientRect();
        const ph = document.querySelector('[data-chill-phone]').getBoundingClientRect();
        const b = document.querySelector('.chill-bar').getBoundingClientRect();
        return { w: s.width, h: s.height, covered: st.left <= s.left + 1 && st.top <= s.top + 1 && st.right >= s.right - 1 && st.bottom >= s.bottom - 1,
          phoneInView: ph.left >= s.left && ph.right <= s.right && ph.top >= s.top && ph.bottom <= s.bottom,
          clearOfBar: ph.bottom <= b.top + 1, frac: ph.height / s.height };
      })()`;
      for (const [w, h] of [[1000, 700], [1600, 900], [700, 900], [1400, 500], [2200, 700]]) {
        mainWindow.setContentSize(w, h);
        let f = await waitFor(beachFraming, v => v && Math.abs(v.w - w) < 4 && v.covered);
        for (let i = 0; i < 20; i++) {
          await sleep(200);
          const f2 = await execS(beachFraming);
          const same = JSON.stringify(f2) === JSON.stringify(f);
          f = f2;
          if (same && f.covered) break;
        }
        check(f && f.covered && f.phoneInView && f.clearOfBar && f.frac > 0.1 && f.frac < 0.5,
          `hammock framing at ${w}x${h}: photo covers, phone in view and clear of the bar, ~${Math.round((f?.frac || 0) * 100)}% of the height (${JSON.stringify(f)})`);
      }
      mainWindow.setContentSize(1000, 700);
      await sleep(300);

      // ── the study room: the picker's third scene ──────────────────────────
      await wakeChrome();
      await execS(`document.querySelector('.chill-scene-btn').click()`);
      await waitFor(`!!document.querySelector('.chill-picker')`, v => v === true);
      await execS(`document.querySelector('.chill-picker-item[data-scene-id="room"]').click()`);
      const inRoom = await waitFor(`({ scene: document.querySelector('.chill-scene')?.dataset.scene, saved: window.localStorage.getItem('sonus.chillScene') })`, v => v && v.scene === 'room');
      check(inRoom && inRoom.scene === 'room' && inRoom.saved === 'room', `choosing the study room switches scene and remembers it (${JSON.stringify(inRoom)})`);
      check(await waitFor(`(() => { const p = document.querySelector('.chill-scene[data-scene="room"] .chill-photo'); return !!p && p.complete && p.naturalWidth === 2752; })()`, v => v === true) === true, 'the study-room photo loads at full size');
      const roomLive = await waitFor(`(() => { const c = document.querySelector('.chill-living'); return c ? { gl: c.dataset.gl, live: c.dataset.live, frames: Number(c.dataset.frames || 0) } : null; })()`, v => v && v.gl !== 'pending' && (v.gl === 'fallback' || v.frames >= 10), 9000);
      check(roomLive && roomLive.gl === 'ok' && roomLive.live === 'true', `the room is drawn by WebGL with its rain, typing and breathing effects (${JSON.stringify(roomLive)})`);
      await sleep(1200);
      check(await execS(`Number(document.querySelector('.chill-living').dataset.frames || 0)`) > (roomLive?.frames ?? 0) + 10, 'the room keeps drawing frames');

      // the song's artwork on the posters (only the image), and the live laptop screen
      const posters = await waitFor(`(() => { const ps = [...document.querySelectorAll('[data-chill-poster]')]; return ps.length ? { n: ps.length, imgs: ps.every(p => p.querySelector('img')), text: ps.map(p => p.textContent).join('').length, matrix: ps.every(p => p.style.transform.startsWith('matrix3d(')), looks: [...new Set(ps.map(p => [...p.classList].find(c => c.startsWith('chill-poster--'))))].length } : null; })()`, v => v && v.n > 0);
      check(posters && posters.n >= 15 && posters.n <= 30 && posters.imgs && posters.text === 0 && posters.matrix && posters.looks >= 3,
        `the artwork is on ${posters?.n} posters, as the image only, in perspective, in ${posters?.looks} different looks (${JSON.stringify(posters)})`);
      check(await execS(`!!document.querySelector('[data-chill-laptop]')`), 'the laptop shows a live document');

      // lightning, every so often: the first within ~5s of the scene appearing; posters and laptop flash with it
      const flashOf = `(() => { const o = document.querySelector('[data-chill-room-overlays]'); return o ? Number(o.dataset.flash || 0) : -1; })()`;
      let flashMax = 0, flashSeenDark = false, flashDroppedAgain = false;
      const flashEnd = Date.now() + 14000;
      while (Date.now() < flashEnd) { const f = await execS(flashOf); if (f <= 0.02) { flashSeenDark = true; if (flashMax > 0.5) flashDroppedAgain = true; } flashMax = Math.max(flashMax, f); await sleep(40); }
      check(flashMax > 0.5, `a lightning flash lights the room within a few seconds (peak ${flashMax})`);
      check(flashSeenDark && flashDroppedAgain, 'and the room goes dark again after it');
      const flashStyle = await execS(`(() => { const o = document.querySelector('[data-chill-room-overlays]'); return { var: getComputedStyle(o).getPropertyValue('--flash'), poster: !!document.querySelector('[data-chill-poster]') }; })()`);
      check(flashStyle.var !== '' && flashStyle.poster, 'the posters and the laptop read the same flash variable');

      // every print carries its OWN measured softness, and the original glare is put back over the art
      const postersFit = await execS(`(() => { const ps = [...document.querySelectorAll('[data-chill-poster]')]; return { n: ps.length, blurs: ps.map(p => parseFloat(p.style.getPropertyValue('--blur'))), glare: !!document.querySelector('[data-chill-glare]') }; })()`);
      // (local px: a small print's box is scaled up more, so its local blur is larger than a big print's)
      check(postersFit.n >= 18 && postersFit.blurs.every(b => b > 0.2 && b < 12) && new Set(postersFit.blurs.map(b => b.toFixed(1))).size >= 3 && postersFit.glare,
        `each print is softened by its own measured blur (${new Set(postersFit.blurs.map(b => b.toFixed(1))).size} distinct values) and the original glare is back on top`);

      // The lightning is an EXPOSURE change: hold the flash at fixed strengths and measure real
      // pixels. At full strength the picture's colours brighten by roughly 10-35% across the
      // room (not a white wash), the same on every channel, and almost nothing clips to white.
      const meanOf = (img, r) => { const { width, height } = img.getSize(); const buf = img.toBitmap(); const sc = width / mainWindow.getContentSize()[0];
        let sum = [0, 0, 0], n = 0; const x0 = Math.max(0, Math.round(r.x * sc)), y0 = Math.max(0, Math.round(r.y * sc)), x1 = Math.min(width, Math.round((r.x + r.w) * sc)), y1 = Math.min(height, Math.round((r.y + r.h) * sc));
        for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const o = (y * width + x) * 4; sum[0] += buf[o + 2]; sum[1] += buf[o + 1]; sum[2] += buf[o]; n++; }
        return sum.map(v => v / Math.max(1, n)); };
      const regions = await execS(`(() => { const st = document.querySelector('.chill-stage').getBoundingClientRect(); const k = st.width / 2752; const rr = (x, y, w, h) => ({ x: st.left + x * k, y: st.top + y * k, w: w * k, h: h * k }); return { sky: rr(1900, 80, 300, 220), house: rr(2000, 450, 200, 250), wall: rr(2480, 270, 160, 170), laptop: rr(1560, 890, 220, 110) }; })()`);
      await execS(`window.__sonusFlashOverride = 0`); await sleep(500);
      const calmImg = await mainWindow.webContents.capturePage();
      await execS(`window.__sonusFlashOverride = 1`); await sleep(500);
      const flashImg = await mainWindow.webContents.capturePage();
      await execS(`delete window.__sonusFlashOverride`);
      const ratios = {};
      for (const [name, r] of Object.entries(regions)) { const a = meanOf(calmImg, r), b = meanOf(flashImg, r); ratios[name] = { lum: (0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2]) / (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]), ch: b.map((v, i) => v / a[i]) }; }
      const lums = Object.values(ratios).map(v => v.lum);
      check(lums.every(v => v > 1.04 && v < 1.4), `a full flash brightens every part of the picture by about 5-40% (${Object.entries(ratios).map(([k, v]) => k + ' x' + v.lum.toFixed(2)).join(', ')})`);
      check(Object.values(ratios).every(v => Math.max(...v.ch) - Math.min(...v.ch) < 0.12), 'the same on every channel: brighter, not tinted or washed toward white');
      // flat white = all three channels pinned (a bright sky that gets a little brighter is not clipping)
      const clipShare = (img) => { const b = img.toBitmap(); let n = 0, c = 0; for (let i = 0; i < b.length; i += 4 * 17) { n++; if (Math.min(b[i], b[i + 1], b[i + 2]) >= 253) c++; } return c / n; };
      const cs0 = clipShare(calmImg), cs1 = clipShare(flashImg);
      check(cs1 - cs0 < 0.015, `almost nothing is pinned to flat white in the flash (${(cs0 * 100).toFixed(2)}% -> ${(cs1 * 100).toFixed(2)}%)`);
      // The coffee's steam moves; the mug and the glass's frame/mullion/sill do NOT (the rain must stay on
      // the glass: it once spilled onto the frame, the mullion between the panes and the sill below).
      await execS(`window.__sonusFlashOverride = 0`); await sleep(400);
      const SPILL_LIMIT = 0.45;
      // Thin strips JUST OUTSIDE each measured glass border — exactly where an over-wide mask lets rain
      // spill (the earlier hand-placed polygons put drops 6-23px past the glass onto the left frame, the
      // slanted edge of the left pane, the gap between the panes, the right frame and the sill below).
      const rects = await execS(`(() => { const st = document.querySelector('.chill-stage').getBoundingClientRect(); const k = st.width / 2752; const rr = (x, y, w, h) => ({ x: st.left + x * k, y: st.top + y * k, w: w * k, h: h * k }); return { steam: rr(1840, 975, 80, 40), mug: rr(1845, 1052, 70, 50), frameL: rr(1388, 200, 5, 560), leftPaneEdge: rr(1752, 300, 3, 500), gapR: rr(1816, 100, 3, 200), frameR: rr(2266, 450, 7, 400), sill: rr(1948, 978, 52, 7) }; })()`);
      const diffOf = (a, b, r) => { const { width } = a.getSize(); const A = a.toBitmap(), B = b.toBitmap(); const sc = width / mainWindow.getContentSize()[0]; const x0 = Math.round(r.x * sc), y0 = Math.round(r.y * sc), x1 = Math.round((r.x + r.w) * sc), y1 = Math.round((r.y + r.h) * sc); let sum = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * width + x) * 4; sum += Math.abs(A[o] - B[o]) + Math.abs(A[o + 1] - B[o + 1]) + Math.abs(A[o + 2] - B[o + 2]); n += 3; } return sum / Math.max(1, n); };
      const seqF = [];
      for (let i = 0; i < 8; i++) { seqF.push(await mainWindow.webContents.capturePage()); await sleep(900); }
      // mean over frame pairs (not the max against one frame): a thin strip catches a drop only now and then
      const meanDiff = (r) => { let s = 0, n = 0; for (let a = 0; a < seqF.length; a++) for (let b = a + 1; b < seqF.length; b++) { s += diffOf(seqF[a], seqF[b], r); n++; } return s / n; };
      const dd = Object.fromEntries(Object.keys(rects).map((k) => [k, meanDiff(rects[k])]));
      check(dd.steam > 1.2, `the coffee's steam moves (mean change ${dd.steam.toFixed(2)})`);
      check(dd.mug < 0.35, `the mug itself holds still (${dd.mug.toFixed(2)})`);
      const spill = ['frameL', 'leftPaneEdge', 'gapR', 'frameR', 'sill'].map((k) => `${k} ${dd[k].toFixed(2)}`);
      check(['frameL', 'leftPaneEdge', 'gapR', 'frameR', 'sill'].every((k) => dd[k] < SPILL_LIMIT), `no rain outside the glass: the frame, the slanted pane edge, the gap between the panes and the sill stay still (${spill.join(', ')})`);
      check(await execS(`!document.querySelector('.chill-poster')?.matches('[style*="mix-blend-mode"]') && !document.querySelector('.chill-poster::before')`), 'and no white overlay sits on the posters');

      // typing, and stopping: over a few seconds she both types and stops (the laptop canvas reports it)
      const typingState = `(() => { const c = document.querySelector('[data-chill-laptop]'); return c ? { typing: c.dataset.typing, chars: Number(c.dataset.chars || 0) } : null; })()`;
      const seen = new Set(); let firstChars = null, lastChars = 0;
      const tEnd = Date.now() + 16000;
      while (Date.now() < tEnd) { const v = await execS(typingState); if (v) { seen.add(v.typing); if (firstChars === null) firstChars = v.chars; lastChars = v.chars; } await sleep(250); }
      check(seen.has('1') && seen.has('0'), `she types and she stops, over 16 seconds (states seen: ${[...seen].join(',')})`);
      check(lastChars > firstChars + 5, `the document grows while she types (${firstChars} -> ${lastChars} characters)`);
      // pausing the music stops her; she stays stopped; playing resumes it
      await execS(`document.querySelector('audio').pause()`);
      const stoppedTyping = await waitFor(typingState, v => v && v.typing === '0', 4000);
      const frozenAt = stoppedTyping ? stoppedTyping.chars : -1;
      await sleep(5000);
      const stillStopped = await execS(typingState);
      check(stoppedTyping && stillStopped.typing === '0' && stillStopped.chars - frozenAt <= 1, `pausing the music stops her typing, and she stays stopped (chars ${frozenAt} -> ${stillStopped?.chars})`);
      await execS(`document.querySelector('audio').play()`);
      const resumedTyping = await waitFor(typingState, v => v && v.typing === '1', 12000);
      check(!!resumedTyping, 'playing again lets her type again');

      // ── her typing the song's lyrics (on the laptop's page) ─────────────────
      // With lyrics: real text, typed straight through a verse (no stop between its lines), and a
      // real stop only at the verse break; pausing freezes it; a different track starts over; and
      // with no lyrics the generic typing is back.
      const lapState = `(() => { const c = document.querySelector('[data-chill-laptop]'); return c ? { lyrics: c.dataset.lyrics, typing: c.dataset.typing, line: Number(c.dataset.lyricLine || -1), chars: Number(c.dataset.lyricChars || 0), cycle: Number(c.dataset.lyricCycle || 0), rows: Number(c.dataset.lyricRows || 0) } : null; })()`;
      const darkPixels = `(() => { const c = document.querySelector('[data-chill-laptop]'); const x = c.getContext('2d'); const d = x.getImageData(2 * 100, 2 * 56, 2 * 280, 2 * 230).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 110) n++; return n; })()`;
      await execS(`window.__sonusTest.setCurrentLyrics('smoke lyric one\\nsmoke lyric two\\n\\nsecond verse here\\nand its last line')`);
      const lyricsOn = await waitFor(lapState, v => v && v.lyrics === '1', 6000);
      check(lyricsOn && lyricsOn.lyrics === '1' && lyricsOn.rows === 4, `with lyrics the laptop types THEM, not the generic text (${JSON.stringify(lyricsOn)})`);
      const seq = [];
      const tEnd2 = Date.now() + 11000;
      while (Date.now() < tEnd2) { const v = await execS(lapState); if (v) seq.push(v); await sleep(90); }
      const firstTyping = seq.findIndex(v => v.typing === '1');
      const stopsInVerse = seq.slice(firstTyping).filter(v => v.typing === '0' && v.line === 0);
      check(firstTyping >= 0 && stopsInVerse.length === 0, `she types straight on from line to line inside a verse (stops on its first line: ${stopsInVerse.length})`);
      const verseBreakStops = seq.filter(v => v.typing === '0' && v.line === 1 && v.chars >= 'smoke lyric two'.length);
      check(verseBreakStops.length >= 8, `and she stops at the end of the verse (${verseBreakStops.length} stopped samples at the break)`);
      check(seq.some(v => v.line >= 2 && v.typing === '1'), 'then carries on into the next verse');
      const darkNow = await execS(darkPixels);
      check(darkNow > 150, `real text is drawn on the page (${darkNow} dark pixels)`);
      // paused: nothing more is typed
      await execS(`document.querySelector('audio').pause()`);
      const frozen0 = await waitFor(lapState, v => v && v.typing === '0', 4000);
      await sleep(3500);
      const frozen1 = await execS(lapState);
      check(frozen0 && frozen1.line === frozen0.line && frozen1.chars === frozen0.chars && frozen1.typing === '0', `pausing the music freezes the lyrics where they were (line ${frozen0?.line} char ${frozen0?.chars} -> line ${frozen1?.line} char ${frozen1?.chars})`);
      await execS(`document.querySelector('audio').play()`);
      // a different track's lyrics start from the top
      await execS(`window.__sonusTest.setCurrentLyrics('another song\\nfirst words')`);
      const restarted = await waitFor(lapState, v => v && v.lyrics === '1' && v.rows === 2 && v.line === 0 && v.cycle === 0, 4000);
      check(!!restarted, `a different track's lyrics start over from the first line (${JSON.stringify(restarted)})`);
      // no lyrics: the generic typing is back, exactly as before
      await execS(`window.__sonusTest.setCurrentLyrics(null)`);
      const generic = await waitFor(`(() => { const c = document.querySelector('[data-chill-laptop]'); return c ? { l: c.dataset.lyrics, chars: Number(c.dataset.chars || 0), typing: c.dataset.typing } : null; })()`, v => v && v.l === '0', 4000);
      await sleep(7000);
      const generic2 = await execS(`(() => { const c = document.querySelector('[data-chill-laptop]'); return { l: c.dataset.lyrics, chars: Number(c.dataset.chars || 0) }; })()`);
      check(generic && generic2.l === '0' && generic2.chars > generic.chars, `with no lyrics the generic typing is back and the document grows (${generic?.chars} -> ${generic2?.chars})`);

      // and back to the turntable; the choice is remembered again
      await wakeChrome();
      await execS(`document.querySelector('.chill-scene-btn').click()`);
      await waitFor(`!!document.querySelector('.chill-picker')`, v => v === true);
      check(await execS(`document.querySelector('.chill-picker-item.active')?.dataset.sceneId`) === 'room', 'the picker marks the study room as current');
      await execS(`document.querySelector('.chill-picker-item[data-scene-id="turntable"]').click()`);
      const back = await waitFor(`({ scene: document.querySelector('.chill-scene')?.dataset.scene, disc: !!document.querySelector('.chill-disc'), living: !!document.querySelector('.chill-living'), saved: window.localStorage.getItem('sonus.chillScene') })`, v => v && v.scene === 'turntable');
      check(back && back.disc && !back.living && back.saved === 'turntable', `switching back restores the turntable and drops the animated photo (${JSON.stringify(back)})`);

      await execS(`window.__sonusTest.setChillMode(false)`);
      await waitFor(`!document.querySelector('.chill-scene')`, v => v === true);
      await execS(`(() => { const a = document.querySelector('audio'); a.loop = false; a.currentTime = 0; })()`);
      await execS(`window.__sonusTest.setView('library')`);
      await sleep(300);
    }

    const tallBefore = await mainWindow.webContents.executeJavaScript(`!!document.querySelector('.mini-player')`, true);

    mainWindow.setContentSize(440, 300);
    const mini = await waitFor(miniMeasure, v => v && v.mini);
    check(tallBefore === false, 'no mini player at a normal window height');
    check(mini.mini === true, 'window shorter than the breakpoint shows the mini player');
    check(mini.panelOpacity === '0' && mini.panelInert === true, `app underneath is hidden and inert in mini (opacity ${mini.panelOpacity}, inert ${mini.panelInert})`);
    check(mini.pills === 0, `no floating pill competes with the mini player (${mini.pills})`);
    check(mini.buttonCount === 6, `mini shows the five transport controls and the ⋮ menu button (${mini.buttonCount})`);
    check(mini.buttonsHittable && mini.seekHittable, 'mini controls are actually clickable (nothing covers them)');
    check(mini.seekHitBox, 'mini seek line has a generous click area (grabbable 9px above and below the line)');
    check(String(mini.text).includes('Mini Smoke Track') && String(mini.text).includes('Mini Artist'), 'mini shows the current title and artist');
    check(mini.fits, 'mini content fits inside a 440x300 window');
    check(mini.eqPlaying === true, 'mini bars animate while playing');
    check(mini.flares.length === 3 && mini.flares.every(x => x === 'running') && mini.flaresOpacity === '1',
      `mini shows Now Playing's three moving lights while playing (${JSON.stringify(mini.flares)}, opacity ${mini.flaresOpacity})`);
    check(mini.artGlow, "mini artwork carries the cover-coloured glow");

    await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('.mini-player button:not(.mini-restore-btn)')[2].click()`, true);
    const paused = await waitFor(`document.querySelector('audio').paused`, v => v === true);
    const lightsPaused = await waitFor(`Array.from(document.querySelectorAll('.mini-player .ambient-flare')).map(e => getComputedStyle(e).animationPlayState).join()`, v => v === 'paused,paused,paused');
    check(lightsPaused === 'paused,paused,paused', `mini lights stop when playback pauses (${lightsPaused})`);
    await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('.mini-player button:not(.mini-restore-btn)')[2].click()`, true);
    const resumed = await waitFor(`!document.querySelector('audio').paused`, v => v === true);
    check(paused === true && resumed === true, 'mini play/pause button toggles the real audio');

    // Leaving mini: the expand button and Escape both ask main.js
    // (window:restore-from-mini) to grow the window back to the last
    // non-mini size the renderer saw — here the 1000x700 set above.
    const settle = async () => {
      let prev = null;
      for (let i = 0; i < 30; i++) {
        const cur = JSON.stringify(mainWindow.getContentSize());
        if (cur === prev) break;
        prev = cur;
        await sleep(150);
      }
      return mainWindow.getContentSize();
    };
    const wa = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
    // The remembered size here is 1000x700, below the 760px floor, so Restore
    // must land on 760 (or the display's height if that is smaller).
    const expectW = Math.min(1000, wa.width);
    const expectH = Math.min(760, wa.height);
    const hasRestoreBtn = await mainWindow.webContents.executeJavaScript(`!!document.querySelector('.mini-restore-btn')`, true);
    check(hasRestoreBtn, 'mini shows an expand button');

    // The expand button is shown only while the pointer is over the window,
    // together with the macOS traffic lights (main.js hides/shows those from
    // the same signal and sends window:pointer-inside to the page). The real
    // cursor can't be moved from here, so: (1) the poller's very first report
    // must match where the cursor really is, and (2) the page must follow
    // that channel in both directions.
    const btnState = `(() => { const b = document.querySelector('.mini-restore-btn'); const cs = getComputedStyle(b); return { opacity: cs.opacity, pe: cs.pointerEvents }; })()`;
    const cursorNow = screen.getCursorScreenPoint();
    const bNow = mainWindow.getBounds();
    const cursorInside = cursorNow.x >= bNow.x && cursorNow.x < bNow.x + bNow.width && cursorNow.y >= bNow.y && cursorNow.y < bNow.y + bNow.height;
    const initial = await waitFor(btnState, v => v && v.opacity === (cursorInside ? '1' : '0'), { timeout: 3000 });
    check(initial && initial.opacity === (cursorInside ? '1' : '0'),
      `expand button's first state matches the real pointer (cursor ${cursorInside ? 'inside' : 'outside'}, button opacity ${initial?.opacity})`);
    mainWindow.webContents.send('window:pointer-inside', true);
    const shown = await waitFor(btnState, v => v && v.opacity === '1', { timeout: 3000 });
    mainWindow.webContents.send('window:pointer-inside', false);
    const hidden = await waitFor(btnState, v => v && v.opacity === '0', { timeout: 3000 });
    check(shown?.opacity === '1' && shown?.pe === 'auto', `expand button appears when the pointer is over the window (${JSON.stringify(shown)})`);
    check(hidden?.opacity === '0' && hidden?.pe === 'none', `expand button hides, and can't be clicked blind, when it is not (${JSON.stringify(hidden)})`);

    // ── the ⋮ track menu in the mini player (the same menu the pill, Now Playing and Chill mode open) ──
    {
      const execM = (c) => mainWindow.webContents.executeJavaScript(c, true);
      const menuState = `(() => { const m = document.querySelector('.track-dropdown'); if (!m) return null; const r = m.getBoundingClientRect(); const b = document.querySelector('[data-mini-menu-btn]').getBoundingClientRect(); const it = m.querySelector('.track-dropdown-item'); const ir = it.getBoundingClientRect(); const top = document.elementFromPoint(ir.left + 20, ir.top + ir.height / 2);
        return { items: [...m.querySelectorAll('.track-dropdown-item')].map(i => i.textContent.trim()).join('|'), inView: r.left >= 5 && r.right <= innerWidth - 5 && r.top >= 5 && r.bottom <= innerHeight - 5, hit: !!top && !!top.closest('.track-dropdown'), region: getComputedStyle(m).getPropertyValue('-webkit-app-region') }; })()`;
      for (const [w, h] of [[380, 180], [440, 300], [700, 420]]) {
        mainWindow.setContentSize(w, h);
        await waitFor(`!!document.querySelector('.mini-player') && innerHeight === ${h}`, v => v === true);
        await sleep(300);
        const row = await execM(`(() => { const b = document.querySelector('[data-mini-menu-btn]'); const r = b.getBoundingClientRect(); const others = [...document.querySelectorAll('.mini-player button:not(.mini-restore-btn):not([data-mini-menu-btn])')].map(x => x.getBoundingClientRect()); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { inside: r.right <= innerWidth && r.bottom <= innerHeight, clear: others.every(o => o.right <= r.left + 0.5), topmost: top === b || b.contains(top) }; })()`);
        check(row.inside && row.clear && row.topmost, `${w}x${h}: the ⋮ sits inside the window, clear of the transport controls, and clickable (${JSON.stringify(row)})`);
        await execM(`document.querySelector('[data-mini-menu-btn]').click()`);
        const ms = await waitFor(menuState, v => v && v.items.length > 0);
        check(ms && ms.items === 'Start Mix|Edit Tags…|Reveal in Finder|Search in YouTube' && ms.inView && ms.hit && ms.region === 'no-drag',
          `${w}x${h}: the menu opens with all four items, inside the window (even this short), on top, and out of the window-drag area so its items take clicks (${JSON.stringify(ms)})`);
        // Escape closes the menu FIRST and does not expand the window
        await execM(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
        await waitFor(`!document.querySelector('.track-dropdown')`, v => v === true);
        await sleep(400);
        check(await execM(`!!document.querySelector('.mini-player') && !document.querySelector('.track-dropdown')`), `${w}x${h}: Escape closes the menu first and the mini player stays`);
      }
      // At the 180px minimum the artwork must clear the traffic lights (they end ~22px from the top): it once sat
      // only ~5px below them against 22px of margin on its left. Larger sizes keep their layout.
      for (const [w, h, wantTop] of [[380, 180, 36], [380, 205, 36], [440, 260, 26]]) {
        mainWindow.setContentSize(w, h);
        await waitFor(`!!document.querySelector('.mini-player') && innerHeight === ${h}`, v => v === true);
        await sleep(300);
        const g = await execM(`(() => { const a = document.querySelector('.mini-content .np-artwork').getBoundingClientRect(); const c = document.querySelector('.mini-content').getBoundingClientRect(); const b = document.querySelector('[data-mini-menu-btn]').getBoundingClientRect(); return { artTop: a.top, artLeft: a.left, contentBottom: c.bottom, btnBottom: b.bottom, vh: innerHeight }; })()`);
        check(g.artTop >= wantTop && g.contentBottom <= g.vh - 10 && g.btnBottom <= g.vh - 10 && g.artLeft >= 20,
          `${w}x${h}: the artwork starts ${g.artTop.toFixed(0)}px down (>= ${wantTop}), clear of the traffic lights, and everything still fits above the bottom edge (${JSON.stringify(g)})`);
      }
      mainWindow.setContentSize(440, 300);
      await waitFor(`!!document.querySelector('.mini-player') && innerHeight === 300`, v => v === true);
      // toggle, and a click elsewhere closes it
      await execM(`document.querySelector('[data-mini-menu-btn]').click()`);
      await waitFor(`!!document.querySelector('.track-dropdown')`, v => v === true);
      await execM(`document.querySelector('[data-mini-menu-btn]').click()`);
      check(await waitFor(`!document.querySelector('.track-dropdown')`, v => v === true) === true, 'clicking the ⋮ again closes the mini menu (a toggle)');
      await execM(`document.querySelector('[data-mini-menu-btn]').click()`);
      await waitFor(`!!document.querySelector('.track-dropdown')`, v => v === true);
      await execM(`document.querySelector('.mini-player').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      check(await waitFor(`!document.querySelector('.track-dropdown')`, v => v === true) === true, 'a click elsewhere closes it');
      // an open menu does not follow the window out of mini mode
      mainWindow.setContentSize(440, 300);
      await waitFor(`!!document.querySelector('.mini-player')`, v => v === true);
      await execM(`document.querySelector('[data-mini-menu-btn]').click()`);
      await waitFor(`!!document.querySelector('.track-dropdown')`, v => v === true);
      mainWindow.setContentSize(1000, 700);
      await waitFor(`!document.querySelector('.mini-player')`, v => v === true);
      check(await waitFor(`!document.querySelector('.track-dropdown')`, v => v === true) === true, 'growing out of mini mode closes an open menu');
      // Start Mix from the mini player expands the window so the mix page is actually seen
      mainWindow.setContentSize(440, 300);
      await waitFor(`!!document.querySelector('.mini-player')`, v => v === true);
      await execM(`(() => { const t = window.__sonusTest.getLibrary()[0]; window.__sonusTest.seedMixResult(t, []); })()`);
      await execM(`document.querySelector('[data-mini-menu-btn]').click()`);
      await waitFor(`!!document.querySelector('.track-dropdown')`, v => v === true);
      await execM(`document.querySelector('.track-dropdown .track-dropdown-item').click()`);
      const mixOut = await waitFor(`({ mini: !!document.querySelector('.mini-player'), view: window.__sonusTest.getView(), h: innerHeight })`, v => v && v.mini === false && v.h > 420, 8000);
      check(mixOut && mixOut.mini === false && mixOut.h > 420 && mixOut.view === 'home', `Start Mix from the mini player expands the window so the mix page is shown (${JSON.stringify(mixOut)})`);
      await execM(`window.__sonusTest.closeDetail(); window.__sonusTest.setView('library')`);
      mainWindow.setContentSize(440, 300);
      await waitFor(`!!document.querySelector('.mini-player')`, v => v === true);
      await sleep(300);
    }

    for (const how of ['button', 'Escape']) {
      await mainWindow.webContents.executeJavaScript(
        how === 'button'
          ? `document.querySelector('.mini-restore-btn').click()`
          : `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`, true);
      await waitFor(`!document.querySelector('.mini-player')`, v => v === true);
      const [rw, rh] = await settle();
      const rb = mainWindow.getBounds();
      check(Math.abs(rw - expectW) <= 2 && Math.abs(rh - expectH) <= 2,
        `${how} restores the window to its last normal size (${rw}x${rh}, expected ${expectW}x${expectH})`);
      check(rb.y >= wa.y && rb.y + rb.height <= wa.y + wa.height + 1 && rb.x >= wa.x && rb.x + rb.width <= wa.x + wa.width + 1,
        `${how}-restored window stays on its display`);
      mainWindow.setContentSize(440, 300);
      await waitFor(`!!document.querySelector('.mini-player')`, v => v === true);
    }
    // A remembered size already taller than the floor is kept, not clamped down.
    const tallH = Math.min(880, wa.height);
    const tallW = Math.min(1100, wa.width);
    mainWindow.setContentSize(tallW, tallH);
    await sleep(500);
    mainWindow.setContentSize(440, 300);
    await waitFor(`!!document.querySelector('.mini-player')`, v => v === true);
    await mainWindow.webContents.executeJavaScript(`document.querySelector('.mini-restore-btn').click()`, true);
    await waitFor(`!document.querySelector('.mini-player')`, v => v === true);
    const [kw, kh] = await settle();
    check(Math.abs(kw - tallW) <= 2 && Math.abs(kh - tallH) <= 2,
      `Restore keeps a remembered size that is already taller than 760 (${kw}x${kh}, expected ${tallW}x${tallH})`);
    mainWindow.setContentSize(440, 300);
    await waitFor(`!!document.querySelector('.mini-player')`, v => v === true);

    mainWindow.setContentSize(440, 420);
    const atBreakpoint = await waitFor(`!!document.querySelector('.mini-player')`, v => v === true);
    mainWindow.setContentSize(440, 421);
    const justAbove = await waitFor(`!document.querySelector('.mini-player')`, v => v === true);
    check(atBreakpoint === true && justAbove === true, `breakpoint is exactly 420 (mini at 420: ${atBreakpoint}, normal at 421: ${justAbove})`);

    mainWindow.setContentSize(380, 180);
    const tiny = await waitFor(miniMeasure, v => v && v.mini);
    check(tiny.mini && tiny.fits, 'mini content still fits at the minimum 380x180 window');

    mainWindow.setBounds(miniOriginalBounds);
    const back = await waitFor(miniMeasure, v => v && v.mini === false);
    const restored = await mainWindow.webContents.executeJavaScript(
      `({ view: window.__sonusTest.getView(), tracks: window.__sonusTest.getLibrary().length })`, true);
    check(back.mini === false && back.panelOpacity === '1' && back.panelInert === false, 'growing the window brings the app back, visible and interactive');
    check(restored.view === 'library' && restored.tracks === 1, `mini round-trip keeps the page and library (${restored.view}, ${restored.tracks} track)`);

    await mainWindow.webContents.executeJavaScript(`
      (() => { const a = document.querySelector('audio'); if (a) a.pause(); window.__sonusTest.setLibrary([]); })()
    `, true);
    await sleep(300);
    await fs.rm(miniFile, { force: true });
  } catch (err) {
    failures.push(`mini player error: ${err.stack || err}`);
  }

  // ── App menus: File (Add Music, the three window sizes) and Controls ──────
  // The real menu from Menu.getApplicationMenu(), clicked the way a menu pick
  // reaches main.js. Sizes are checked in the real window; Add Music is
  // intercepted at the native dialog so the suite never opens one.
  if (wants('menus')) try {
    const menu = Menu.getApplicationMenu();
    const topLabels = menu.items.map(i => i.label);
    const fileItems = (menu.items.find(i => i.label === 'File')?.submenu?.items || []).filter(i => i.type !== 'separator');
    check(JSON.stringify(fileItems.map(i => i.label)) === JSON.stringify(['Add Music…', 'Filled Screen Mode', 'Narrow Mode', 'Mini Mode', 'Chill Mode', 'Close Window']),
      `File menu has exactly the agreed items (${fileItems.map(i => i.label).join(' | ')})`);
    check(topLabels.indexOf('Controls') > topLabels.indexOf('View') && topLabels.indexOf('Controls') < topLabels.indexOf('Window'),
      `Controls sits between View and Window (${topLabels.join(', ')})`);

    const accels = [];
    const walk = (items) => items.forEach(i => { if (i.accelerator) accels.push(String(i.accelerator)); if (i.submenu) walk(i.submenu.items); });
    walk(menu.items);
    const dupes = accels.filter((a, i) => accels.indexOf(a) !== i);
    check(dupes.length === 0, `no two menu items share an accelerator (duplicates: ${dupes.join(', ') || 'none'})`);

    const click = (id) => menu.getMenuItemById(id).click();
    const menuFile = path.join(app.getPath('userData'), 'smoke-menu.mp3');
    await fs.copyFile(path.join(__dirname, '..', 'test-fixture.mp3'), menuFile);
    const menuOriginalBounds = mainWindow.getBounds();
    const workArea = screen.getDisplayMatching(menuOriginalBounds).workArea;
    const waitBounds = async (pred) => {
      const end = Date.now() + 6000 * SLOW;
      let b;
      for (;;) {
        b = mainWindow.getBounds();
        if (pred(b)) return b;
        if (Date.now() >= end) return b;
        await sleep(100);
      }
    };
    const execMenu = (c) => mainWindow.webContents.executeJavaScript(c, true);

    // ── Add Music: Cmd+O's menu item runs the same dialog as the + button ──
    mainWindow.setContentSize(1000, 700);
    await sleep(500);
    check(menu.getMenuItemById('file-add-music').accelerator === 'CommandOrControl+O', 'Add Music is Cmd+O');
    const realShowOpenDialog = dialog.showOpenDialog;
    let dialogCalls = 0;
    dialog.showOpenDialog = async () => { dialogCalls += 1; return { canceled: true, filePaths: [] }; };
    try {
      click('file-add-music');
      for (let i = 0; i < 40 && dialogCalls === 0; i++) await sleep(100);
    } finally {
      dialog.showOpenDialog = realShowOpenDialog;
    }
    check(dialogCalls === 1, `File > Add Music opens the Add Music dialog once (${dialogCalls})`);

    // ── the three window sizes ──
    click('file-narrow');
    const narrow = await waitBounds(b => Math.abs(b.width - 440) <= 2);
    const narrowDom = await waitFor(`({ w: innerWidth, mini: !!document.querySelector('.mini-player') })`, v => v && v.w < 560 && !v.mini);
    check(Math.abs(narrow.width - 440) <= 2 && Math.abs(narrow.height - Math.min(760, workArea.height)) <= 2,
      `Narrow Mode: 440x760 (${narrow.width}x${narrow.height})`);
    check(narrowDom.w < 560 && !narrowDom.mini, `the app is in its narrow layout, not mini (${JSON.stringify(narrowDom)})`);

    click('file-mini');
    const mini = await waitBounds(b => Math.abs(b.width - 380) <= 2 && Math.abs(b.height - 200) <= 2);
    const miniDom = await waitFor(`!!document.querySelector('.mini-player')`, v => v === true);
    check(Math.abs(mini.width - 380) <= 2 && Math.abs(mini.height - 200) <= 2, `Mini Mode: 380x200 (${mini.width}x${mini.height})`);
    check(miniDom === true, 'the app shows the mini player at that size');

    click('file-filled');
    const filled = await waitBounds(b => Math.abs(b.width - workArea.width) <= 2 && Math.abs(b.height - workArea.height) <= 2);
    const filledDom = await waitFor(`({ w: innerWidth, mini: !!document.querySelector('.mini-player') })`, v => v && v.w >= 560 && !v.mini);
    check(Math.abs(filled.width - workArea.width) <= 2 && Math.abs(filled.height - workArea.height) <= 2,
      `Filled Screen Mode fills the display's work area (${filled.width}x${filled.height} vs ${workArea.width}x${workArea.height})`);
    check(filledDom.w >= 560 && !filledDom.mini, `the full layout is back (${JSON.stringify(filledDom)})`);

    // Narrow Mode is the same size whether it comes from Mini or from Filled Screen.
    click('file-narrow');
    const narrowFromFilled = await waitBounds(b => Math.abs(b.width - 440) <= 2);
    check(Math.abs(narrowFromFilled.width - narrow.width) <= 2 && Math.abs(narrowFromFilled.height - narrow.height) <= 2,
      `Narrow Mode from Filled Screen is the same size as from Mini (${narrowFromFilled.width}x${narrowFromFilled.height} vs ${narrow.width}x${narrow.height})`);

    // ── Controls: a playing track, then each item through the real menu ──
    mainWindow.setBounds(menuOriginalBounds);
    mainWindow.setContentSize(1000, 700);
    await sleep(500);
    await execMenu(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const cv = document.createElement('canvas'); cv.width = 40; cv.height = 40;
        const cx = cv.getContext('2d'); cx.fillStyle = '#3a8ad0'; cx.fillRect(0, 0, 40, 40);
        window.__sonusTest.setLibrary([{
          title: 'Menu Smoke Track', artist: 'Menu Artist', album: 'Album', albumArtist: '',
          year: 2002, duration: 20, genre: '', thumb: cv.toDataURL(), lyrics: null, trackNumber: '',
          trackTotal: '', discNumber: '', discTotal: '', composer: '', comment: '', bpm: '',
          bitrate: 320, codecProfile: null, dateAdded: 1, playCount: 0, lastPlayed: null,
          filePath: ${JSON.stringify(menuFile)},
        }]);
        window.__sonusTest.setView('library');
        await sleep(500);
        document.querySelector('.track-row').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      })()
    `);
    // the fixture is 20s long; keep it playing underneath this whole block
    await waitFor(`(() => { const a = document.querySelector('audio'); if (a) a.loop = true; return !!a && !a.paused; })()`, v => v === true);

    const menuWaitFor = async (pred) => {
      const end = Date.now() + 6000 * SLOW;
      for (;;) {
        if (pred()) return true;
        if (Date.now() >= end) return false;
        await sleep(100);
      }
    };
    const item = (id) => menu.getMenuItemById(id);
    check(await menuWaitFor(() => item('controls-play-pause').label === 'Pause'), `Controls shows "Pause" while playing (${item('controls-play-pause').label})`);
    check(['controls-next', 'controls-previous', 'controls-go-to-current'].every(id => item(id).enabled),
      'Next, Previous and Go to Current Song are enabled with a track loaded');

    click('controls-play-pause');
    const paused = await waitFor(`(() => { const a = document.querySelector('audio'); return !!a && a.paused; })()`, v => v === true);
    check(paused === true, 'Controls > Pause pauses the real <audio>');
    check(await menuWaitFor(() => item('controls-play-pause').label === 'Play'), `the item flips to "Play" (${item('controls-play-pause').label})`);
    click('controls-play-pause');
    const resumed = await waitFor(`(() => { const a = document.querySelector('audio'); return !!a && !a.paused; })()`, v => v === true);
    check(resumed === true, 'Controls > Play resumes playback');

    // The tick on a checkbox item flips by itself when clicked, so also read the
    // renderer: the pill's shuffle button is white only when shuffle is really on (gray when off).
    click('controls-shuffle');
    check(await menuWaitFor(() => item('controls-shuffle').checked === true), 'Shuffle is ticked after choosing it');
    const onColor = await waitFor(`(document.querySelector('.player-control-button:has(.lucide-shuffle)') || {style: {}}).style.color`, v => v === 'var(--chrome-text)');
    check(onColor === 'var(--chrome-text)', `the renderer's shuffle really turned on, white (${onColor})`);
    // "On" is also a marker, not just a brightness: a small white dot under the icon.
    const toggleState = (icon) => `(() => { const b = document.querySelector('.player-control-button:has(.lucide-${icon})'); return b && { on: b.classList.contains('player-toggle--on'), pressed: b.getAttribute('aria-pressed'), dot: getComputedStyle(b, '::after').opacity, bg: getComputedStyle(b).backgroundColor.replace(/\\s/g, '') }; })()`;
    const dotOn = await waitFor(toggleState('shuffle'), v => v && v.on && v.dot === '1');
    check(dotOn && dotOn.on && dotOn.pressed === 'true' && dotOn.dot === '1' && dotOn.bg === 'rgba(0,0,0,0)', `an active toggle shows the dot (and no chip) and aria-pressed (${JSON.stringify(dotOn)})`);
    click('controls-shuffle');
    check(await menuWaitFor(() => item('controls-shuffle').checked === false), 'choosing Shuffle again clears the tick');
    const offColor = await waitFor(`(document.querySelector('.player-control-button:has(.lucide-shuffle)') || {style: {}}).style.color`, v => v === 'var(--chrome-text-off)');
    check(offColor === 'var(--chrome-text-off)', `and the renderer's shuffle turned off, gray (${offColor})`);
    const dotOff = await waitFor(toggleState('shuffle'), v => v && !v.on && v.dot === '0');
    check(dotOff && !dotOff.on && dotOff.pressed === 'false' && dotOff.dot === '0', `an inactive toggle has no dot (${JSON.stringify(dotOff)})`);

    const repeatSeen = [];
    for (let i = 0; i < 3; i++) {
      const before = item('controls-repeat').label;
      click('controls-repeat');
      await menuWaitFor(() => item('controls-repeat').label !== before);
      repeatSeen.push(item('controls-repeat').label);
      const wantChip = item('controls-repeat').label !== 'Repeat: Off';
      const rs = await waitFor(`(() => { const b = document.querySelector('.player-control-button:has(.lucide-repeat, .lucide-repeat-1)'); return b && { on: b.classList.contains('player-toggle--on'), pressed: b.getAttribute('aria-pressed'), dot: getComputedStyle(b, '::after').opacity }; })()`, v => v && v.on === wantChip && v.dot === (wantChip ? '1' : '0'));
      check(rs && rs.on === wantChip && rs.pressed === String(wantChip) && rs.dot === (wantChip ? '1' : '0'), `repeat ${item('controls-repeat').label}: dot ${wantChip ? 'shown' : 'hidden'} (${JSON.stringify(rs)})`);
    }
    check(JSON.stringify(repeatSeen) === JSON.stringify(['Repeat: All', 'Repeat: One', 'Repeat: Off']),
      `Repeat cycles Off > All > One > Off in the label (${repeatSeen.join(' | ')})`);

    await execMenu(`window.__sonusTest.setView('home')`);
    await waitFor(`window.__sonusTest.getView()`, v => v === 'home');
    click('controls-go-to-current');
    const toLibrary = await waitFor(`window.__sonusTest.getView()`, v => v === 'library');
    check(toLibrary === 'library', `Go to Current Song brings the Library forward (${toLibrary})`);
    const selectedRow = await waitFor(`!!document.querySelector('.track-row.selected, .track-row[aria-selected="true"]')`, v => v === true, { timeout: 4000 });
    check(selectedRow === true, 'and highlights the current song');

    // ── File > Chill Mode: fill the screen AND open Now Playing in Chill mode ──
    check(item('file-chill').enabled === true, 'Chill Mode is enabled with a song loaded');
    check(item('file-chill').accelerator === 'Shift+CommandOrControl+C', 'Chill Mode is Shift+Cmd+C');
    mainWindow.setBounds(menuOriginalBounds);
    mainWindow.setContentSize(1000, 700);
    await sleep(500);
    await execMenu(`window.__sonusTest.setView('library')`);
    await waitFor(`window.__sonusTest.getView()`, v => v === 'library');
    click('file-chill');
    const chillUp = await waitFor(`({ view: window.__sonusTest.getView(), scene: !!document.querySelector('.chill-scene') })`, v => v && v.view === 'now_playing' && v.scene);
    const chillBounds = await waitBounds(b => Math.abs(b.width - workArea.width) <= 2 && Math.abs(b.height - workArea.height) <= 2);
    check(chillUp.view === 'now_playing' && chillUp.scene === true, `File > Chill Mode opens Now Playing in Chill mode (${JSON.stringify(chillUp)})`);
    check(Math.abs(chillBounds.width - workArea.width) <= 2 && Math.abs(chillBounds.height - workArea.height) <= 2,
      `and fills the screen (${chillBounds.width}x${chillBounds.height} vs ${workArea.width}x${workArea.height})`);
    // Leaving Chill mode leaves the window as it is.
    await execMenu(`document.querySelector('.chill-exit-btn').click()`);
    const chillGone = await waitFor(`!document.querySelector('.chill-scene')`, v => v === true);
    const afterExit = mainWindow.getBounds();
    check(chillGone === true && Math.abs(afterExit.width - workArea.width) <= 2 && Math.abs(afterExit.height - workArea.height) <= 2,
      `leaving Chill mode keeps the window full (${afterExit.width}x${afterExit.height})`);

    // ── The three size items end Chill mode (it used to stay on after Filled Screen Mode) ──
    const chillOn = () => waitFor(`({ view: window.__sonusTest.getView(), scene: !!document.querySelector('.chill-scene') })`, v => v && v.view === 'now_playing' && v.scene);
    const stillChill = async () => { await sleep(700); return execMenu(`({ view: window.__sonusTest.getView(), scene: !!document.querySelector('.chill-scene') })`); };
    click('file-chill');
    await chillOn();
    click('file-filled');
    const afterFilled = await waitFor(`({ view: window.__sonusTest.getView(), scene: !!document.querySelector('.chill-scene') })`, v => v && v.scene === false, { timeout: 4000 });
    check(afterFilled.scene === false && afterFilled.view === 'now_playing',
      `Filled Screen Mode while in Chill mode leaves Chill, on Now Playing (${JSON.stringify(afterFilled)})`);

    for (const [id, label] of [['file-narrow', 'Narrow'], ['file-mini', 'Mini']]) {
      click('file-chill');
      await chillOn();
      click(id);
      await waitBounds(b => b.width < 560);
      mainWindow.setContentSize(1000, 700);   // big again, not through the menu
      await waitFor(`innerWidth >= 560 && innerHeight > 420`, v => v === true);
      const back = await stillChill();
      check(back.scene === false, `${label} Mode ends Chill for good: a big window later does not bring it back (${JSON.stringify(back)})`);
    }

    await execMenu(`(() => { const a = document.querySelector('audio'); if (a) { a.loop = false; a.pause(); } window.__sonusTest.setLibrary([]); })()`);
    await sleep(300);
    mainWindow.setBounds(menuOriginalBounds);
    await fs.rm(menuFile, { force: true });
  } catch (err) {
    failures.push(`app menu error: ${err.stack || err}`);
  }

  // ── Add-songs dialog (AddTracksDialog.jsx) in every window mode ───────────
  // Opened through the ?test=1 hook instead of a native file dialog or a drag.
  // Every track is a real file: the focus-time path check would otherwise drop
  // fake ones from the library mid-suite. Geometry is measured in the real
  // window: nothing clipped, every button inside the panel and actually hit by
  // a click, and in the mini player the whole card clear of the traffic lights.
  if (wants('adddialog')) try {
    const dFile1 = path.join(app.getPath('userData'), 'smoke-dialog-1.mp3');
    const dFile2 = path.join(app.getPath('userData'), 'smoke-dialog-2.mp3');
    await fs.copyFile(path.join(__dirname, '..', 'test-fixture.mp3'), dFile1);
    await fs.copyFile(path.join(__dirname, '..', 'test-fixture.mp3'), dFile2);
    const dialogOriginalBounds = mainWindow.getBounds();
    const execD = (c) => mainWindow.webContents.executeJavaScript(c, true);
    const mkTrack = (title, filePath) => `{ title: ${JSON.stringify(title)}, artist: 'Dialog Artist', album: 'Album', albumArtist: '',
      year: 2003, duration: 20, genre: '', thumb: null, lyrics: null, trackNumber: '', trackTotal: '', discNumber: '',
      discTotal: '', composer: '', comment: '', bpm: '', bitrate: 320, codecProfile: null, dateAdded: 1, playCount: 0,
      lastPlayed: null, filePath: ${JSON.stringify(filePath)} }`;
    const seedDialog = async (n = 1) => {
      await execD(`window.__sonusTest.setLibrary([${mkTrack('Already Here', dFile1)}]);
        window.__sonusTest.setView('library'); 0`);
      const tracks = n === 1 ? `[${mkTrack('Dialog Smoke Track', dFile2)}]`
        : `[${mkTrack('Dialog Smoke Track', dFile2)}, ${mkTrack('Second', dFile2 + '.2')}, ${mkTrack('Third', dFile2 + '.3')}]`;
      await execD(`window.__sonusTest.openAddDialog(${tracks}); 0`);
      return waitFor(`!!document.querySelector('.add-dialog')`, v => v === true);
    };
    const measureDialog = `(() => {
      const d = document.querySelector('.add-dialog');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      const buttons = Array.from(d.querySelectorAll('button'));
      const hits = (b) => { const q = b.getBoundingClientRect(); const e = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return e === b || b.contains(e); };
      const inside = (b) => { const q = b.getBoundingClientRect(); return q.left >= r.left - 0.5 && q.right <= r.right + 0.5 && q.top >= r.top - 0.5 && q.bottom <= r.bottom + 0.5; };
      const hdr = d.querySelector('.add-dialog-header').getBoundingClientRect();
      return { compact: d.classList.contains('add-dialog--compact'), top: r.top, left: r.left, right: r.right, bottom: r.bottom,
        w: innerWidth, h: innerHeight, clipped: d.scrollHeight > d.clientHeight + 1 || d.scrollWidth > d.clientWidth + 1,
        buttons: buttons.length, allInside: buttons.every(inside), allHit: buttons.every(hits), headerTop: hdr.top,
        textOverflow: Array.from(d.querySelectorAll('.add-dialog-option-label')).some(e => e.scrollWidth > e.clientWidth + 1),
        subtextShown: d.querySelectorAll('.add-dialog-option-hint').length, hintLines: d.querySelectorAll('.add-dialog-hint').length,
        hintClipped: (() => { const h = d.querySelector('.add-dialog-hint'); return !h || h.scrollWidth > h.clientWidth + 1; })(),
        };
    })()`;

    // [width, height, expectCompact, label]
    const modes = [[1000, 700, false, 'normal 1000x700'], [440, 760, false, 'narrow 440x760'], [380, 560, false, 'narrow 380x560'],
      [440, 300, true, 'mini 440x300'], [380, 205, true, 'mini 380x205'], [380, 180, true, 'mini minimum 380x180']];
    for (const [w, h, expectCompact, label] of modes) {
      mainWindow.setContentSize(w, h);
      await waitFor(`innerWidth === ${w} && innerHeight === ${h}`, v => v === true);
      await seedDialog(3);
      // two identical consecutive samples: the layout lags a resize by a frame
      let m = await waitFor(measureDialog, v => !!v && v.w === w && v.h === h && v.compact === expectCompact);
      const again = await execD(measureDialog);
      if (JSON.stringify(m) !== JSON.stringify(again)) m = await waitFor(measureDialog, v => JSON.stringify(v) !== JSON.stringify(m));
      check(m && m.compact === expectCompact, `${label}: ${expectCompact ? 'compact' : 'regular'} layout (${m && m.compact})`);
      check(m && !m.clipped && m.top >= 0 && m.left >= 0 && m.right <= m.w + 0.5 && m.bottom <= m.h + 0.5,
        `${label}: the dialog fits inside the window and is not clipped (${JSON.stringify(m && { top: m.top, bottom: m.bottom, h: m.h, clipped: m.clipped })})`);
      check(m && m.buttons === 4 && m.allInside && m.allHit, `${label}: all four buttons are inside the dialog and receive clicks (${JSON.stringify(m && { n: m.buttons, inside: m.allInside, hit: m.allHit })})`);
      check(m && !m.textOverflow, `${label}: no button label is cut off`);
      check(m && m.subtextShown === 0 && m.hintLines === 1 && !m.hintClipped, `${label}: buttons show only their names, the subtext is one unclipped hint line (${JSON.stringify(m && { subtext: m.subtextShown, lines: m.hintLines, clipped: m.hintClipped })})`);
      if (m && expectCompact) {
        check(m.top === 0 && m.left === 0 && Math.abs(m.right - m.w) <= 0.5 && Math.abs(m.bottom - m.h) <= 0.5,
          `${label}: the mini dialog fills the window, so the traffic lights sit on it and not across an edge (${JSON.stringify({ top: m.top, left: m.left, right: m.right, bottom: m.bottom, w: m.w, h: m.h })})`);
      }
      if (expectCompact) check(m && m.headerTop >= 28, `${label}: the title row sits below the traffic lights (top ${m && m.headerTop})`);
      await execD(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0`);
      const gone = await waitFor(`!document.querySelector('.add-dialog')`, v => v === true);
      check(gone === true, `${label}: Escape closes the dialog`);
    }

    // ── the window can be moved while the dialog is open ──
    // A native -webkit-app-region can't be exercised from here, and the first
    // version of this (a drag region) did not work for the user while every
    // computed-style check passed - so the drag is page-driven (useWindowDrag +
    // 'window:drag' in main.js) and tested by what actually matters: the
    // window's position. main follows the OS cursor, so the test moves the REAL
    // cursor (CGWarpMouseCursorPosition, no permission needed) while the mouse
    // events that start, tick and end the drag are sent with sendInputEvent.
    const warpCursor = (x, y) => execSync(`osascript -l JavaScript -e 'ObjC.import("CoreGraphics"); $.CGWarpMouseCursorPosition($.CGPointMake(${x}, ${y}))'`, { stdio: 'ignore' });
    const dragFrom = async (label, pointExpr, expectMove) => {
      const pt = await execD(pointExpr);
      const before = mainWindow.getPosition();
      const c0 = screen.getCursorScreenPoint();
      mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
      await sleep(100);
      warpCursor(c0.x + 80, c0.y + 40);
      await sleep(100);
      const c1 = screen.getCursorScreenPoint();
      check(Math.abs(c1.x - c0.x - 80) <= 2 && Math.abs(c1.y - c0.y - 40) <= 2, `${label}: the test moved the real cursor (${c1.x - c0.x}, ${c1.y - c0.y} vs 80, 40)`);
      mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: pt.x + 80, y: pt.y + 40, button: 'left', modifiers: ['leftButtonDown'] });
      for (let i = 0; i < 30 && expectMove && mainWindow.getPosition()[0] === before[0]; i++) await sleep(50);
      await sleep(150);
      // released somewhere else (the window lags the pointer): that click must not cancel the dialog
      mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: pt.x + 80, y: pt.y + 40, button: 'left', clickCount: 1 });
      await sleep(200);
      const after = mainWindow.getPosition();
      const moved = [after[0] - before[0], after[1] - before[1]];
      const open = await execD(`!!document.querySelector('.add-dialog')`);
      if (expectMove) check(Math.abs(moved[0] - 80) <= 2 && Math.abs(moved[1] - 40) <= 2, `${label}: pressing and moving moves the window (${moved.join(', ')} vs 80, 40)`);
      else check(moved[0] === 0 && moved[1] === 0, `${label}: pressing a button and moving does not move the window (${moved.join(', ')})`);
      check(open === true, `${label}: the dialog is still open afterwards (releasing a drag is not a click)`);
      warpCursor(c0.x, c0.y);
      mainWindow.setPosition(before[0], before[1], false);
      await sleep(100);
    };
    for (const [w, h, label, grab] of [
      [1000, 700, 'normal', `(() => { const r = document.querySelector('.add-dialog-drag-strip').getBoundingClientRect(); return { x: Math.round(r.left + 120), y: Math.round(r.top + r.height / 2) }; })()`],
      [380, 205, 'mini', `(() => { const r = document.querySelector('.add-dialog-detail').getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }; })()`],
    ]) {
      mainWindow.setContentSize(w, h);
      await waitFor(`innerWidth === ${w} && innerHeight === ${h}`, v => v === true);
      await seedDialog(1);
      await waitFor(`!!document.querySelector('.add-dialog${w === 380 ? '--compact' : ''}')`, v => v === true);
      await dragFrom(`${label} window`, grab, true);
      await dragFrom(`${label} window (from a button)`, `(() => { const b = Array.from(document.querySelectorAll('.add-dialog-option')).find(x => x.textContent.includes('Play next')); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`, false);
      await execD(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0`);
      await waitFor(`!document.querySelector('.add-dialog')`, v => v === true);
    }

    // ── the actions still do what they did ──
    mainWindow.setContentSize(1000, 700);
    await waitFor(`innerWidth === 1000 && innerHeight === 700`, v => v === true);
    const click = (name) => execD(`Array.from(document.querySelectorAll('.add-dialog button')).find(b => b.textContent.includes(${JSON.stringify(name)})).click()`);
    const libLen = () => execD(`window.__sonusTest.getLibrary().map(t => t.title)`);

    await seedDialog(1);
    const detail = await execD(`document.querySelector('.add-dialog-title').textContent + ' | ' + document.querySelector('.add-dialog-detail').textContent`);
    check(detail === 'Dialog Smoke Track | Dialog Artist · 1 song', `the dialog names the song being added (${detail})`);
    // The subtext follows the real pointer (genuine mouse input, like the Chill idle fade).
    const hintText = () => execD(`document.querySelector('.add-dialog-hint').textContent`);
    const centreOf = (label) => execD(`(() => { const b = Array.from(document.querySelectorAll('.add-dialog-option')).find(x => x.textContent.includes(${JSON.stringify(label)})); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    check(await hintText() === 'Replaces your current library', `with nothing hovered the hint says what Play does (${await hintText()})`);
    const pn = await centreOf('Play next');
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: pn.x, y: pn.y });
    const hovered = await waitFor(`document.querySelector('.add-dialog-hint').textContent`, v => v !== 'Replaces your current library');
    check(hovered === 'Right after the current song' || hovered === 'At the top of your library', `hovering Play next shows its subtext (${hovered})`);
    const aq = await centreOf('Add to queue');
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: aq.x, y: aq.y });
    const hovered2 = await waitFor(`document.querySelector('.add-dialog-hint').textContent`, v => v === 'At the end of your library');
    check(hovered2 === 'At the end of your library', `hovering Add to queue shows its subtext (${hovered2})`);
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 300 });
    const back = await waitFor(`document.querySelector('.add-dialog-hint').textContent`, v => v === 'Replaces your current library');
    check(back === 'Replaces your current library', `moving off the buttons goes back to Play's subtext (${back})`);
    await click('Cancel');
    await waitFor(`!document.querySelector('.add-dialog')`, v => v === true);
    check(JSON.stringify(await libLen()) === JSON.stringify(['Already Here']), 'Cancel changes nothing');

    await seedDialog(1);
    await click('Add to queue');
    const queued = await waitFor(`window.__sonusTest.getLibrary().map(t => t.title)`, v => v.length === 2);
    check(JSON.stringify(queued) === JSON.stringify(['Already Here', 'Dialog Smoke Track']), `Add to queue appends (${JSON.stringify(queued)})`);

    await seedDialog(1);
    await click('Play now');
    const replaced = await waitFor(`window.__sonusTest.getLibrary().map(t => t.title)`, v => v.length === 1 && v[0] === 'Dialog Smoke Track');
    check(JSON.stringify(replaced) === JSON.stringify(['Dialog Smoke Track']), `Play replaces the library, as the dialog says (${JSON.stringify(replaced)})`);

    await execD(`(() => { const a = document.querySelector('audio'); if (a) a.pause(); window.__sonusTest.setLibrary([]); })()`);
    mainWindow.setBounds(dialogOriginalBounds);
    await sleep(300);
    await fs.rm(dFile1, { force: true });
    await fs.rm(dFile2, { force: true });
  } catch (err) {
    failures.push(`add dialog error: ${err.stack || err}`);
  }

  // ── Track list rows: white states, the playing bars, the footer, the handle ──
  // The blue accent was dropped from lists and the player's toggles; this guards
  // that no blue sneaks back in a state the plain tests never reach (selected,
  // playing, header), and the new row furniture. Real files: see the focus note.
  if (wants('listrows')) try {
    const lrFiles = [1, 2, 3].map(i => path.join(app.getPath('userData'), `smoke-listrows-${i}.mp3`));
    for (const f of lrFiles) await fs.copyFile(path.join(__dirname, '..', 'test-fixture.mp3'), f);
    const lrOriginalBounds = mainWindow.getBounds();
    const execL = (c) => mainWindow.webContents.executeJavaScript(c, true);
    mainWindow.setContentSize(1000, 700);
    await sleep(500);
    const mk = (i) => `{ title: 'Row Song ${i}', artist: 'Row Artist', album: 'Album', albumArtist: '', year: 2004, duration: 20, genre: '', thumb: null, lyrics: null,
      trackNumber: '', trackTotal: '', discNumber: '', discTotal: '', composer: '', comment: '', bpm: '', bitrate: 320, codecProfile: null,
      dateAdded: ${i}, playCount: 0, lastPlayed: null, filePath: ${JSON.stringify(lrFiles[i - 1])} }`;
    await execL(`window.__sonusTest.setLibrary([${mk(1)}, ${mk(2)}, ${mk(3)}]); window.__sonusTest.setView('library'); 0`);
    await waitFor(`document.querySelectorAll('.track-list .track-row').length`, v => v === 3);

    const footer = await waitFor(`(document.querySelector('.track-list-footer') || {}).textContent`, v => !!v);
    check(footer === '3 songs · 1 min', `the list ends with a summary line (${footer})`);
    const footerGap = await execL(`(() => { const rows = document.querySelectorAll('.track-list .track-row'); const last = rows[rows.length - 1].getBoundingClientRect(); const f = document.querySelector('.track-list-footer').getBoundingClientRect(); return Math.round(f.top - last.bottom); })()`);
    check(footerGap >= 0 && footerGap <= 3, `the summary sits right under the last row, not stranded below the player's clearance (${footerGap}px gap)`);

    const blueScan = `(() => { const blue = '10, 132, 255'; const bad = [];
      document.querySelectorAll('.track-list *, .track-list-header *').forEach(el => { const s = getComputedStyle(el);
        [s.color, s.backgroundColor, s.boxShadow, s.borderTopColor, s.outlineColor, s.fill, s.stroke].forEach(v => { if (v && v.includes(blue)) bad.push((el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ': ' + v); }); });
      return bad.slice(0, 5); })()`;

    // selected row: white ring, no blue
    await execL(`document.querySelectorAll('.track-list .track-row')[0].click(); 0`);
    const sel = await waitFor(`(() => { const r = document.querySelector('.track-list .track-row.selected'); if (!r) return null; const s = getComputedStyle(r); return { shadow: s.boxShadow, bg: s.backgroundColor }; })()`, v => !!v && v.shadow.includes('255, 255, 255') && v.bg.replace(/\s/g, '').startsWith('rgba(255,255,255,0.18'));   // the fill and ring fade in over 0.15s: wait for the settled value
    check(sel && sel.shadow.includes('255, 255, 255') && !sel.shadow.includes('10, 132, 255'), `a selected row has a white ring, not a blue one (${sel && sel.shadow})`);
    check(sel && sel.bg.replace(/\s/g, '').startsWith('rgba(255,255,255,0.18'), `and a stronger white fill (${sel && sel.bg})`);

    // playing row: bars in the leading column, no stripe, no blue
    await execL(`document.querySelectorAll('.track-list .track-row')[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 0`);
    await waitFor(`(() => { const a = document.querySelector('audio'); if (a) a.loop = true; return !!a && !a.paused; })()`, v => v === true);
    const playing = await waitFor(`(() => { const r = document.querySelector('.track-list .track-row.active'); if (!r) return null;
      const eq = r.querySelector('.row-eq'); const rows = Array.from(document.querySelectorAll('.track-list .track-row'));
      return { bars: r.querySelectorAll('.row-eq i').length, anim: eq && getComputedStyle(eq.querySelector('i')).animationName, paused: !!eq && eq.classList.contains('row-eq--paused'),
        shadow: getComputedStyle(r).boxShadow, numberHidden: !/^\\s*2\\s*$/.test(r.querySelector('div').textContent || ''), others: rows.filter(x => x !== r).every(x => !x.querySelector('.row-eq')),
        leadText: rows.map(x => x.children[0].textContent.trim()) }; })()`, v => v && v.bars === 3);
    check(playing && playing.bars === 3 && playing.anim === 'row-eq-bounce' && !playing.paused, `the playing row shows three dancing bars (${JSON.stringify(playing)})`);
    check(playing && playing.shadow === 'none', `and no stripe (${playing && playing.shadow})`);
    check(playing && playing.others === true && playing.leadText[0] === '1' && playing.leadText[2] === '3', `the other rows keep their numbers (${JSON.stringify(playing && playing.leadText)})`);
    await execL(`(() => { const a = document.querySelector('audio'); if (a) a.pause(); })()`);
    const stilled = await waitFor(`(() => { const eq = document.querySelector('.track-list .track-row.active .row-eq'); return eq && { paused: eq.classList.contains('row-eq--paused'), anim: getComputedStyle(eq.querySelector('i')).animationName }; })()`, v => v && v.paused);
    check(stilled && stilled.paused && stilled.anim === 'none', `the bars stand still while paused (${JSON.stringify(stilled)})`);

    check((await execL(blueScan)).length === 0, `no blue anywhere in the list or its header, in any state (${JSON.stringify(await execL(blueScan))})`);

    // the drag handle: invisible at rest, there on a real hover
    const handleOpacity = () => execL(`getComputedStyle(document.querySelectorAll('.track-list .track-row')[2].querySelector('.track-row-handle')).opacity`);
    const hasHandle = await execL(`!!document.querySelectorAll('.track-list .track-row')[2].querySelector('.track-row-handle')`);
    check(hasHandle === true, 'in manual order every row has a drag handle');
    if (hasHandle) {
      check(await handleOpacity() === '0', `the handle is invisible at rest (${await handleOpacity()})`);
      const pt = await execL(`(() => { const r = document.querySelectorAll('.track-list .track-row')[2].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y });
      const shown = await waitFor(`getComputedStyle(document.querySelectorAll('.track-list .track-row')[2].querySelector('.track-row-handle')).opacity`, v => v === '1');
      check(shown === '1', `and visible while the pointer is over the row (${shown})`);
      mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });
      const gone = await waitFor(`getComputedStyle(document.querySelectorAll('.track-list .track-row')[2].querySelector('.track-row-handle')).opacity`, v => v === '0');
      check(gone === '0', `then gone again (${gone})`);
    }

    await execL(`(() => { const a = document.querySelector('audio'); if (a) { a.loop = false; a.pause(); } window.__sonusTest.setLibrary([]); })()`);
    mainWindow.setBounds(lrOriginalBounds);
    await sleep(300);
    for (const f of lrFiles) await fs.rm(f, { force: true });
  } catch (err) {
    failures.push(`list rows error: ${err.stack || err}`);
  }

  // ── Tag write round-trip over real IPC (MP3 path + index/thumb sync) ──────
  if (wants('tagwrite')) try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const tmpCopy = path.join(app.getPath('userData'), 'smoke-writetag.mp3');
    await fs.copyFile(fixture, tmpCopy);
    await parseFilePaths([tmpCopy]); // seed index entry (writeTag sync needs it)

    const wtResult = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const out = {};
        const p = ${JSON.stringify(tmpCopy)};
        const res = await window.electronAPI.writeTag(p, {
          title: 'Smoke Title', artist: 'Smoke Artist', album: 'Smoke Album',
          albumArtist: '', year: '2024', genre: 'Test', trackNumber: '3', trackTotal: '9',
          discNumber: '', discTotal: '', composer: '', comment: 'smoke comment',
          bpm: '', lyrics: 'smoke lyrics line'
        });
        out.writeOk = res === true || res?.success === true;
        out.thumbAfterWrite = res?.thumb ?? null;
        const [reparsed] = await window.electronAPI.parseFiles([p]);
        out.title = reparsed?.title; out.artist = reparsed?.artist;
        out.year = reparsed?.year; out.lyrics = reparsed?.lyrics;
        out.trackNumber = reparsed?.trackNumber; out.trackTotal = reparsed?.trackTotal;
        out.fullArt = await window.electronAPI.readArtwork(p);
        const stats = await window.electronAPI.recordPlay(p);
        out.playCount = stats?.playCount;
        return out;
      })()
    `, true);

    check(wtResult.writeOk, 'writeTag succeeded');
    check(wtResult.title === 'Smoke Title' && wtResult.artist === 'Smoke Artist', `re-parse sees new tags (${wtResult.title} / ${wtResult.artist})`);
    check(String(wtResult.year) === '2024', `year round-trips (${wtResult.year})`);
    check(wtResult.lyrics === 'smoke lyrics line', 'lyrics round-trip');
    check(wtResult.trackNumber === '3' && wtResult.trackTotal === '9', `track n/of round-trips (${wtResult.trackNumber}/${wtResult.trackTotal})`);
    check(typeof wtResult.fullArt === 'string' && wtResult.fullArt.startsWith('data:image/'), 'readArtwork returns full-res data URL');
    check(wtResult.playCount === 1, `recordPlay over IPC (${wtResult.playCount})`);
    await fs.rm(tmpCopy, { force: true });
  } catch (err) {
    failures.push(`writeTag round-trip error: ${err.stack || err}`);
  }

  // ── Dropping a folder expands into its nested tracks (fs:parseFiles) ──────
  if (wants('folder')) try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const folderRoot = path.join(app.getPath('userData'), 'smoke-drop-folder');
    await fs.rm(folderRoot, { recursive: true, force: true });
    await fs.mkdir(path.join(folderRoot, 'Artist A', 'Album 1'), { recursive: true });
    await fs.mkdir(path.join(folderRoot, 'Artist B'), { recursive: true });
    await fs.copyFile(fixture, path.join(folderRoot, 'Artist A', 'Album 1', 'song1.mp3'));
    await fs.copyFile(fixture, path.join(folderRoot, 'Artist B', 'song2.mp3'));
    await fs.writeFile(path.join(folderRoot, '.DS_Store'), ''); // must be excluded

    const dropResult = await mainWindow.webContents.executeJavaScript(`
      window.electronAPI.parseFiles([${JSON.stringify(folderRoot)}]).then(tracks =>
        tracks.map(t => t.filePath.split('/').pop())
      )
    `, true);
    check(dropResult.length === 2, `dropped folder expands recursively into its nested tracks (got ${dropResult.length})`);
    check(dropResult.includes('song1.mp3') && dropResult.includes('song2.mp3'), `both nested-subfolder tracks found, .DS_Store excluded (${dropResult.join(', ')})`);

    await fs.rm(folderRoot, { recursive: true, force: true });
  } catch (err) {
    failures.push(`folder drop expansion error: ${err.stack || err}`);
  }

  // ── WAV + FLAC writer round-trips (real files generated on the fly) ───────
  if (wants('writers')) try {
    // Minimal valid WAV: RIFF/fmt/data, 0.2s of 16-bit mono silence @ 8kHz.
    const sampleCount = 1600;
    const dataSize = sampleCount * 2;
    const wav = Buffer.alloc(44 + dataSize);
    wav.write('RIFF', 0, 'ascii'); wav.writeUInt32LE(36 + dataSize, 4); wav.write('WAVE', 8, 'ascii');
    wav.write('fmt ', 12, 'ascii'); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36, 'ascii'); wav.writeUInt32LE(dataSize, 40);
    const wavPath = path.join(app.getPath('userData'), 'smoke.wav');
    await fs.writeFile(wavPath, wav);
    await parseFilePaths([wavPath]); // seed index

    const wavResult = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const p = ${JSON.stringify(wavPath)};
        const res = await window.electronAPI.writeTag(p, {
          title: 'Wav Title', artist: 'Wav Artist', album: 'Wav Album', albumArtist: '',
          year: '2023', genre: '', trackNumber: '', trackTotal: '', discNumber: '', discTotal: '',
          composer: '', comment: '', bpm: '', lyrics: 'wav lyrics'
        });
        const [t] = await window.electronAPI.parseFiles([p]);
        return { ok: res === true || res?.success === true, title: t?.title, artist: t?.artist, lyrics: t?.lyrics };
      })()
    `, true);
    check(wavResult.ok, 'WAV writeTag succeeded');
    check(wavResult.title === 'Wav Title' && wavResult.artist === 'Wav Artist', `WAV tags round-trip (${wavResult.title}/${wavResult.artist})`);
    check(wavResult.lyrics === 'wav lyrics', 'WAV lyrics round-trip');
    await fs.rm(wavPath, { force: true });

    // Hand-crafted minimal FLAC (fLaC marker + STREAMINFO only) — plus a
    // variant with a leading ID3v2 header, exercising the writer's strip path.
    const streamInfo = Buffer.alloc(34);
    streamInfo.writeUInt16BE(4608, 0);
    streamInfo.writeUInt16BE(4608, 2);
    streamInfo[10] = 8000 >> 12;
    streamInfo[11] = (8000 >> 4) & 0xFF;
    streamInfo[12] = ((8000 & 0xF) << 4);
    streamInfo[13] = (15 & 0xF) << 4;      // 16 bps, total-samples high nibble 0
    streamInfo.writeUInt32BE(1600, 14);    // total samples
    const flacBytes = Buffer.concat([Buffer.from('fLaC', 'ascii'), Buffer.from([0x80, 0x00, 0x00, 0x22]), streamInfo]);
    const id3Prefix = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]); // 'ID3' v2.3, size 0

    for (const [name, bytes] of [['plain', flacBytes], ['id3-prefixed', Buffer.concat([id3Prefix, flacBytes])]]) {
      const flacPath = path.join(app.getPath('userData'), `smoke-${name}.flac`);
      await fs.writeFile(flacPath, bytes);
      await parseFilePaths([flacPath]);
      const flacResult = await mainWindow.webContents.executeJavaScript(`
        (async () => {
          const p = ${JSON.stringify(flacPath)};
          const res = await window.electronAPI.writeTag(p, {
            title: 'Flac Title', artist: 'Flac Artist', album: 'Flac Album', albumArtist: 'AA',
            year: '2022', genre: 'G', trackNumber: '2', trackTotal: '8', discNumber: '', discTotal: '',
            composer: '', comment: '', bpm: '', lyrics: 'flac lyrics'
          });
          const [t] = await window.electronAPI.parseFiles([p]);
          return { ok: res === true || res?.success === true, title: t?.title, artist: t?.artist, year: t?.year, lyrics: t?.lyrics, albumArtist: t?.albumArtist };
        })()
      `, true);
      check(flacResult.ok, `FLAC writeTag succeeded (${name})`);
      check(flacResult.title === 'Flac Title' && flacResult.artist === 'Flac Artist', `FLAC tags round-trip (${name}: ${flacResult.title}/${flacResult.artist})`);
      check(String(flacResult.year) === '2022', `FLAC year round-trips (${name}: ${flacResult.year})`);
      check(flacResult.lyrics === 'flac lyrics', `FLAC lyrics round-trip (${name})`);
      check(flacResult.albumArtist === 'AA', `FLAC albumArtist round-trips (${name})`);
      // The writer must emit a clean file starting at fLaC (ID3 prefix dropped).
      const written = await fs.readFile(flacPath);
      check(written.slice(0, 4).toString('ascii') === 'fLaC', `saved FLAC starts with fLaC marker (${name})`);
      await fs.rm(flacPath, { force: true });
    }
  } catch (err) {
    failures.push(`WAV/FLAC round-trip error: ${err.stack || err}`);
  }

  // ── Background reindex: drop the index entry, reload, verify it heals ─────
  if (wants('reindex')) try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    await fs.writeFile(
      path.join(app.getPath('userData'), 'library.json'),
      JSON.stringify({ trackPaths: [fixture], currentTrackPath: null, currentTime: 0 })
    );
    getStore().removeEntries([fixture]); // simulate missing/stale index (migration)

    const loadResult = await mainWindow.webContents.executeJavaScript(
      `window.electronAPI.loadLibraryState()`, true
    );
    check(loadResult.tracks.length === 1, 'instant load returns a row for unindexed path');
    check(loadResult.tracks[0].pending === true, 'unindexed path served as placeholder');
    check(typeof loadResult.tracks[0].title === 'string' && loadResult.tracks[0].title.length > 0, 'placeholder has a display title');

    // background verify should re-parse and heal the index
    await new Promise(r => setTimeout(r, 2500));
    const healed = getStore().getEntry(fixture);
    check(!!healed && typeof healed.mtimeMs === 'number', 'background verify re-indexed the stale path');
    check(typeof healed?.dateAdded === 'number' && healed.dateAdded > 0, 'reindex set dateAdded (birthtime mode)');
  } catch (err) {
    failures.push(`reindex pipeline error: ${err.stack || err}`);
  }

  // ── File-open launch: arbitration in library:load + replace semantics ─────
  // Cold-launch arbitration is exercised against loadLibraryState directly: in
  // a real cold launch the renderer isn't ready when the batch settles, which
  // is precisely what lets library:load win the batch. Smoke runs with a fully
  // loaded renderer, so driving it over IPC would test the warm path instead.
  // The warm path is covered separately, below, through the renderer.
  if (wants('fileopen')) try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const udir = app.getPath('userData');
    // Real, parseable copies whose names sort differently from the order the
    // batch is handed to us in.
    const copyC = path.join(udir, 'open-c.mp3');
    const copyA = path.join(udir, 'open-a.mp3');
    const copyB = path.join(udir, 'open-b.mp3');
    const copyD = path.join(udir, 'open-d.mp3');
    const sessionFile = path.join(udir, 'open-session.mp3');
    for (const p of [copyC, copyA, copyB, copyD, sessionFile]) await fs.copyFile(fixture, p);
    const SERVICE_FLAG = 'service-action.flag';

    // A saved session that a file-open launch must beat, and a Services launch
    // must fall back to. Indexed up front so the restore path can be checked
    // for *real* metadata rather than placeholders (see below).
    await parseFilePaths([sessionFile]);
    // Re-seeded before every case that reads it: the renderer's own debounced
    // library:save overwrites library.json whenever its library changes, which
    // several cases below deliberately do. Writing it once up front leaves the
    // later cases racing that save.
    //
    // Re-seeding alone is still not enough. App.jsx debounces that save by
    // 500ms, so a mutation from the previous case can be sitting in flight and
    // land *after* the seed, clobbering it - the read then returns the wrong
    // library. It cost an intermittent "unreadable open falls back to the saved
    // session" failure under Rosetta. Waiting out the debounce window first
    // means the file we write is the last word.
    const SAVE_DEBOUNCE_MS = 500; // must match App.jsx's library:save debounce
    const seedSession = async () => {
      await sleep(SAVE_DEBOUNCE_MS + 250);
      await fs.writeFile(
        path.join(udir, 'library.json'),
        JSON.stringify({ trackPaths: [sessionFile], currentTrackPath: sessionFile, currentTime: 42 })
      );
    };
    await seedSession();

    // 1. Double-click cold launch: the opened file wins outright.
    seedOpenFileBatch([copyC]);
    const opened = await loadLibraryState();
    check(opened.tracks.length === 1, `file-open launch returns only the opened file (${opened.tracks.length})`);
    check(opened.tracks[0]?.filePath === copyC, 'file-open launch discards the saved session');
    check(opened.autoPlay === true, 'file-open launch flags autoPlay');
    check(opened.currentTime === 0, 'file-open launch ignores the saved resume position');
    check(opened.failedOpenCount === 0, 'file-open launch reports no failures');

    // 2. Multi-file selection: sorted by file name, first one becomes current.
    seedOpenFileBatch([copyC, copyA, copyB]);
    const multi = await loadLibraryState();
    const order = multi.tracks.map(t => path.basename(t.filePath)).join(',');
    check(order === 'open-a.mp3,open-b.mp3,open-c.mp3', `multi-file batch sorted by name (${order})`);
    check(multi.currentTrackPath === copyA, 'first track by name becomes current');

    // 3. A Services invocation is NOT a file-open launch: the saved session
    //    restores, paused at its position, and the batch is left for the flush.
    await seedSession();
    await fs.writeFile(path.join(udir, 'service-action.flag'), 'add-to-queue');
    seedOpenFileBatch([copyC]);
    const svc = await loadLibraryState();
    check(svc.tracks[0]?.filePath === sessionFile, 'Services launch restores the saved session');
    check(svc.autoPlay === false, 'Services launch does not autoplay');
    check(svc.currentTime === 42, `Services launch keeps the saved position (${svc.currentTime})`);
    // The restore must come from the index, not be a placeholder. This is the
    // observable symptom of the store being read before it finished loading
    // (see ensureStoreLoaded in main.js): every path looks unknown, so the whole
    // library comes back pending and triggers a spurious full reindex.
    check(svc.tracks[0]?.pending !== true, 'session restore serves indexed metadata, not a placeholder');
    check(typeof svc.tracks[0]?.duration === 'number' && svc.tracks[0].duration > 0,
      `restored track carries real metadata (duration ${svc.tracks[0]?.duration})`);
    // That batch was deliberately left unconsumed, so loadLibraryState's
    // hand-back must now deliver it to the renderer as a service-add-to-queue -
    // a Services launch that queued nothing would be a silent dead end. (Also
    // has to land before the replace cases below, or it appends mid-test.)
    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.setLibrary([])`, true);
    await sleep(700);
    const afterService = await mainWindow.webContents.executeJavaScript(
      `window.__sonusTest.getLibrary().map(t => t.filePath)`, true
    );
    check(afterService.length === 1 && afterService[0] === copyC,
      `Services batch still delivered after the session load (${afterService.length})`);

    // 4. Unreadable files must never leave the user with an empty library.
    await seedSession();
    seedOpenFileBatch([path.join(udir, 'no-such-file.mp3')]);
    const failedOpen = await loadLibraryState();
    check(failedOpen.tracks[0]?.filePath === sessionFile, 'unreadable open falls back to the saved session');
    check(failedOpen.failedOpenCount === 1, `failure count reported (${failedOpen.failedOpenCount})`);
    check(failedOpen.autoPlay === false, 'failed open does not autoplay');

    // 5. Warm double-click, through the renderer: replaces the library, clears
    //    the detail view, and lands on Library.
    await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        window.__sonusTest.setLibrary([
          { title: 'Old A', artist: 'Artist 1', album: 'Old', year: 2000, duration: 100, thumb: null, lyrics: null, filePath: '/old/a.mp3', playCount: 0, lastPlayed: null, dateAdded: 1 },
          { title: 'Old B', artist: 'Artist 1', album: 'Old', year: 2000, duration: 100, thumb: null, lyrics: null, filePath: '/old/b.mp3', playCount: 0, lastPlayed: null, dateAdded: 2 },
          { title: 'Old C', artist: 'Artist 2', album: 'Old', year: 2000, duration: 100, thumb: null, lyrics: null, filePath: '/old/c.mp3', playCount: 0, lastPlayed: null, dateAdded: 3 }
        ]);
        await sleep(150);
        window.__sonusTest.openDetail({ type: 'artist', key: 'Artist 1' });
        await sleep(250);
        return true;
      })()
    `, true);

    mainWindow.webContents.send('open-external-file', { tracks: multi.tracks, failedCount: 0 });
    await sleep(500);

    const afterWarm = await mainWindow.webContents.executeJavaScript(`
      (() => ({
        count: window.__sonusTest.getLibrary().length,
        first: window.__sonusTest.getLibrary()[0]?.filePath,
        view: window.__sonusTest.getView(),
        hasActiveRow: !!document.querySelector('.track-row.active'),
      }))()
    `, true);
    check(afterWarm.count === 3, `warm open replaces the library (${afterWarm.count} tracks)`);
    check(afterWarm.first === copyA, 'warm open library is the opened batch, name-sorted');
    check(afterWarm.view === 'library', `warm open leaves a detail view for Library (${afterWarm.view})`);
    check(afterWarm.hasActiveRow, 'warm open marks the new first track as current');

    // 6. Now Playing is the one screen that stays put across a replace.
    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.setView('now_playing')`, true);
    await sleep(150);
    mainWindow.webContents.send('open-external-file', { tracks: [multi.tracks[2]], failedCount: 0 });
    // Wait for the replace to actually land rather than assuming it fits in
    // 400ms. On timeout the last value is returned unchanged, so the checks
    // below still run and still fail - only the timing assumption is gone.
    const afterNp = await waitFor(
      `(() => ({ view: window.__sonusTest.getView(), count: window.__sonusTest.getLibrary().length }))()`,
      (s) => s?.count === 1,
    );
    check(afterNp.view === 'now_playing', `Now Playing survives a replace (${afterNp.view})`);
    check(afterNp.count === 1, `replace still happened while in Now Playing (${afterNp.count})`);

    // 7. A warm open where everything failed must not wipe the library.
    mainWindow.webContents.send('open-external-file', { tracks: [], failedCount: 2 });
    await sleep(400);
    const afterFail = await mainWindow.webContents.executeJavaScript(`
      (() => ({ count: window.__sonusTest.getLibrary().length }))()
    `, true);
    check(afterFail.count === 1, `failed warm open leaves the library intact (${afterFail.count})`);

    // 8. Services actions, delivered through the real flag → flush → renderer
    //    path. Start from a known 3-track library whose *first* track is the
    //    current one, so "play next" has an unambiguous insertion point.
    mainWindow.webContents.send('open-external-file', { tracks: multi.tracks, failedCount: 0 });
    await sleep(500);

    const serviceCases = [
      { flag: SERVICE_FLAG, action: 'add-to-queue', file: copyD, expectIndex: 3, label: 'add-to-queue appends' },
      { flag: SERVICE_FLAG, action: 'play-next', file: copyD, expectIndex: 1, label: 'play-next inserts after the current track' },
      // The pre-2.0 bundle's flag must still mean add-to-queue: an old bundle
      // survives until the first packaged launch updates it, and falling
      // through to the file-open path would replace the user's library.
      { flag: 'service-add-to-queue.flag', action: '', file: copyD, expectIndex: 3, label: 'legacy flag still means add-to-queue' },
    ];

    for (const tc of serviceCases) {
      // Reset to the same 3-track baseline before each case.
      mainWindow.webContents.send('open-external-file', { tracks: multi.tracks, failedCount: 0 });
      await sleep(400);
      await fs.writeFile(path.join(udir, tc.flag), tc.action);
      seedOpenFileBatch([tc.file]);
      await loadLibraryState();
      await sleep(700);
      const state = await mainWindow.webContents.executeJavaScript(
        `({ lib: window.__sonusTest.getLibrary().map(t => t.filePath), view: window.__sonusTest.getView() })`, true
      );
      check(state.lib.length === 4, `${tc.label}: one track added (${state.lib.length})`);
      check(state.lib[tc.expectIndex] === copyD, `${tc.label} (index ${state.lib.indexOf(copyD)})`);
      check(state.lib[0] === copyA, `${tc.label}: current track stays first`);
    }

    // 9. A Service handing over tracks already in the library is a no-op.
    await fs.writeFile(path.join(udir, SERVICE_FLAG), 'add-to-queue');
    seedOpenFileBatch([copyD]);
    await loadLibraryState();
    await sleep(700);
    const dupState = await mainWindow.webContents.executeJavaScript(
      `window.__sonusTest.getLibrary().length`, true
    );
    check(dupState === 4, `duplicate Services add is a no-op (${dupState})`);

    // 10. Unlike Add to Queue, Play Next on a track already in the library is
    // NOT a no-op — it's an explicit "play this specific file next" request,
    // so the track's row must move to right after the current one instead of
    // being silently dropped just because it isn't a new row. Regression
    // guard: this used to dedupe before deciding what to queue, so an
    // already-present track never reached forcedNextQueueRef at all.
    mainWindow.webContents.send('open-external-file', { tracks: multi.tracks, failedCount: 0 });
    await sleep(400);
    await fs.writeFile(path.join(udir, SERVICE_FLAG), 'add-to-queue');
    seedOpenFileBatch([copyD]);
    await loadLibraryState();
    await sleep(700);
    await fs.writeFile(path.join(udir, SERVICE_FLAG), 'play-next');
    seedOpenFileBatch([copyD]);
    await loadLibraryState();
    await sleep(700);
    const movedState = await mainWindow.webContents.executeJavaScript(
      `window.__sonusTest.getLibrary().map(t => t.filePath)`, true
    );
    check(movedState.length === 4, `play-next on an existing track adds no duplicate row (${movedState.length})`);
    check(movedState[1] === copyD, `play-next moves an already-present track to right after the current one (index ${movedState.indexOf(copyD)})`);
    check(movedState[0] === copyA, 'play-next on an existing track leaves the current track in place');

    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.setView('library'); window.__sonusTest.setLibrary([]);`, true);
    await sleep(150);
  } catch (err) {
    failures.push(`file-open launch error: ${err.stack || err}`);
  }

  // ── Saving tags on the playing track keeps it playing from the same spot ──
  // The Tag Editor's Save rewrites the file in place while <audio> has it
  // open; App.jsx's onTagSaved handler forces a clean reload and restores
  // position. Exercises the real path: renderer → preload writeTag →
  // fs:writeTag → tag-editor:saved → onTagSaved. Regression guard for the
  // production path only: the bug this was written for (the reload living
  // inside a setCurrentTrack updater, which StrictMode double-invokes) shows
  // up under npm run dev, not in the built app this suite runs — see the
  // matching "fails silently" row in CLAUDE.md.
  if (wants('save-playing')) try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const copy = path.join(app.getPath('userData'), 'save-while-playing.mp3');
    // A realistic size, not the 320KB fixture: a small file is fully buffered
    // before the save, so an in-place rewrite can't disturb it and the case
    // passes vacuously. Repeat the fixture's MPEG frames (self-delimiting)
    // after its ID3v2 tag to get ~5MB / ~5 minutes that Chromium streams in
    // ranges while it's being rewritten underneath.
    const fixtureBytes = await fs.readFile(fixture);
    let audioStart = 0;
    if (fixtureBytes.toString('latin1', 0, 3) === 'ID3') {
      const s = (fixtureBytes[6] << 21) | (fixtureBytes[7] << 14) | (fixtureBytes[8] << 7) | fixtureBytes[9];
      audioStart = 10 + s;
    }
    const frames = fixtureBytes.subarray(audioStart);
    await fs.writeFile(copy, Buffer.concat([fixtureBytes.subarray(0, audioStart), ...Array(15).fill(frames)]));
    const coverB64 = 'data:image/jpeg;base64,' + (await fs.readFile(path.join(__dirname, '..', 'scripts', 'fixture-cover.jpg'))).toString('base64');
    const [track] = await parseFilePaths([copy]); // also seeds the index entry writeTag's sync needs
    mainWindow.webContents.send('open-external-file', { tracks: [track], failedCount: 0 });
    await sleep(900);

    const before = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const a = document.querySelector('audio');
        if (!a) return { noAudio: true };
        for (let i = 0; i < 200 && a.readyState < 1; i++) await sleep(50);
        // Muted playback sidesteps Chromium's no-gesture autoplay block, so
        // wasPlaying is genuinely true when the save lands.
        a.muted = true;
        let playErr = null;
        try { await a.play(); } catch (e) { playErr = String(e); }
        a.currentTime = 5;
        for (let i = 0; i < 60 && a.currentTime < 4; i++) await sleep(50);
        const t0 = a.currentTime;
        await sleep(600);
        const advanced = a.currentTime - t0;
        window.__saveDiag = { error: 0, pause: 0, emptied: 0, loadedmetadata: 0, errCode: null };
        a.addEventListener('error', () => { window.__saveDiag.error++; window.__saveDiag.errCode = a.error?.code ?? null; });
        a.addEventListener('pause', () => window.__saveDiag.pause++);
        a.addEventListener('emptied', () => window.__saveDiag.emptied++);
        a.addEventListener('loadedmetadata', () => window.__saveDiag.loadedmetadata++);
        const snap = { paused: a.paused, currentTime: a.currentTime, advanced, playErr,
          activeTitle: document.querySelector('.track-row.active')?.textContent ?? null };
        const res = await window.electronAPI.writeTag(${JSON.stringify(copy)}, { title: 'Saved While Playing', picture: ${JSON.stringify(coverB64)} });
        return { ...snap, writeOk: !!res?.success };
      })()
    `, true);

    const after = await waitFor(
      `(() => {
        const a = document.querySelector('audio');
        const lib = window.__sonusTest.getLibrary();
        return {
          paused: a ? a.paused : null, currentTime: a ? a.currentTime : null,
          errCode: a?.error?.code ?? null, diag: window.__saveDiag,
          titleUpdated: lib.some(t => t.title === 'Saved While Playing'),
          activeTitle: document.querySelector('.track-row.active')?.textContent ?? null,
        };
      })()`,
      (s) => s && s.titleUpdated && s.paused === false && s.currentTime >= 4,
      { timeout: 5000 },
    );
    check(before.writeOk, 'save-while-playing: writeTag succeeded');
    check(!before.noAudio && before.playErr === null && before.paused === false && before.advanced > 0.3,
      `save-while-playing: track was genuinely playing before the save (paused ${before.paused}, advanced ${before.advanced?.toFixed(2)}s, playErr ${before.playErr})`);
    check(after.titleUpdated, 'save-while-playing: tag-editor:saved reached the renderer');
    check(after.diag?.error === 0, `save-while-playing: no media error during the in-place rewrite (errors ${after.diag?.error}, code ${after.diag?.errCode})`);
    check(after.paused === false, `save-while-playing: still playing after the save (paused ${after.paused})`);
    check(after.currentTime >= 4 && after.currentTime <= 12, `save-while-playing: resumed near the same spot, not rewound (${after.currentTime?.toFixed(2)}s)`);
    check(typeof after.activeTitle === 'string' && after.activeTitle.includes('Saved While Playing'),
      `save-while-playing: same track still current (active row: ${JSON.stringify(after.activeTitle)})`);

    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.setLibrary([])`, true);
    await sleep(150);
  } catch (err) {
    failures.push(`save-while-playing error: ${err.stack || err}`);
  }

  // ── Re-opening the already-loaded file restarts it ───────────────────────
  // Regression guard for a real bug: <audio>'s src is derived from the track's
  // path, so re-opening the file that is already loaded produces an IDENTICAL
  // src. React then makes no DOM change, autoPlay never re-fires, and the
  // element just sits where it was — paused, mid-track. The suite previously
  // only ever opened *different* files, which is why this went unnoticed.
  //
  // Asserts currentTime rewinding to 0, deliberately not "is audible": Chromium
  // blocks unmuted autoplay without a user gesture, so asserting real playback
  // would be flaky for reasons unrelated to this bug.
  if (wants('reopen')) try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const [track] = await parseFilePaths([fixture]);

    mainWindow.webContents.send('open-external-file', { tracks: [track], failedCount: 0 });
    await sleep(900);

    const before = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const a = document.querySelector('audio');
        if (!a) return { noAudio: true };
        // Decoding a 13MB MP3 far enough to expose a seekable duration takes
        // longer on slower hardware; the old flat 2s cap expired first under
        // Rosetta and reported readyState 0. Poll for the real condition.
        for (let i = 0; i < 200 && a.readyState < 1; i++) await sleep(50);
        a.pause();
        a.currentTime = 5;
        // currentTime is applied asynchronously - wait for the seek to take
        // rather than assuming 200ms is always enough.
        for (let i = 0; i < 60 && a.currentTime < 4; i++) await sleep(50);
        return { src: a.src, currentTime: a.currentTime, paused: a.paused, readyState: a.readyState };
      })()
    `, true);

    // The reported action: double-click the same file again in Finder.
    mainWindow.webContents.send('open-external-file', { tracks: [track], failedCount: 0 });

    // The rewind is the behaviour under test, so poll for it rather than
    // sampling once after a fixed 900ms and hoping the restart already ran.
    const after = await waitFor(
      `(() => {
        const a = document.querySelector('audio');
        return a ? { currentTime: a.currentTime, src: a.src } : { noAudio: true };
      })()`,
      (s) => s && !s.noAudio && s.currentTime < 1,
    );

    check(!before.noAudio && !after.noAudio, 'audio element present across the re-open');
    check(before.readyState >= 1, `fixture loaded far enough to seek (readyState ${before.readyState})`);
    check(before.currentTime >= 4, `seek to 5s took effect before re-opening (${before.currentTime})`);
    check(after.src === before.src, 'still the same file after re-opening it');
    check(after.currentTime < 1, `re-opening the loaded file rewinds it to the start (${after.currentTime})`);

    // Same root cause, second route: double-clicking the row of the track that
    // is already loaded also lands in playTrack with an unchanged src.
    const viaRow = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const a = document.querySelector('audio');
        const row = document.querySelector('.track-row');
        if (!a || !row) return { missing: true };
        a.pause();
        a.currentTime = 7;
        for (let i = 0; i < 60 && a.currentTime < 6; i++) await sleep(50);
        const seeded = a.currentTime;
        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        // Poll for the restart instead of a flat 600ms.
        for (let i = 0; i < 100 && a.currentTime >= 1; i++) await sleep(50);
        return { seeded, currentTime: a.currentTime };
      })()
    `, true);
    check(!viaRow.missing, 'row present for the in-app double-click test');
    check(viaRow.seeded >= 6, `seek to 7s took effect before the row double-click (${viaRow.seeded})`);
    check(viaRow.currentTime < 1, `double-clicking the loaded track's row restarts it (${viaRow.currentTime})`);

    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.setLibrary([])`, true);
    await sleep(200);
  } catch (err) {
    failures.push(`re-open same file error: ${err.stack || err}`);
  }

  // ── Tag Editor opens centred on its display ──────────────────────────────
  // The window is created at a 720px fallback height and only resized once the
  // renderer reports the form's real height. setContentSize pins the top-left
  // corner, so without an explicit re-position the window's centre slides by
  // half the height difference — measured at ~67px too low for a tall form,
  // and too high for a short one.
  if (wants('tageditor')) try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const [track] = await parseFilePaths([fixture]);
    openTagEditor(track);

    let win = null;
    for (let i = 0; i < 50; i++) {
      await sleep(150);
      const w = getTagEditorWindow();
      if (w && !w.isDestroyed() && w.isVisible()) { win = w; break; }
    }

    if (!win) {
      failures.push('tag editor window never became visible');
    } else {
      await sleep(500); // let the fit-to-content resize settle
      const b = win.getBounds();
      const wa = screen.getDisplayMatching(b).workArea;
      const dx = (b.x + b.width / 2) - (wa.x + wa.width / 2);
      const dy = (b.y + b.height / 2) - (wa.y + wa.height / 2);
      check(Math.abs(dx) <= 2, `tag editor horizontally centred (off by ${Math.round(dx)}px)`);
      check(Math.abs(dy) <= 2, `tag editor vertically centred (off by ${Math.round(dy)}px)`);
      check(b.width === 960, `tag editor keeps its fixed 960 width (${b.width})`);
      check(b.y >= wa.y && b.y + b.height <= wa.y + wa.height,
        `tag editor sits fully inside the work area (y ${b.y}, h ${b.height}, wa ${wa.y}..${wa.y + wa.height})`);

      // Search Online results: an overlay, not part of the form. Driven through
      // the ?test=1 hook so the suite never calls iTunes/MusicBrainz.
      const heightBeforePopup = win.getBounds().height;
      const popup = await win.webContents.executeJavaScript(`
        (async () => {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          if (!window.__sonusTagEditorTest) return { noHook: true };
          const formBefore = document.querySelector('.scrollable').scrollHeight;
          // 40 distinct songs, each one duplicated: only 10 should survive, and
          // they must be the first 10 — proving dedupe runs BEFORE the cap.
          const rows = [];
          for (let i = 0; i < 40; i++) {
            const row = { title: 'Song ' + i, artist: 'A', album: 'Al', year: String(2000 + i), source: 'iTunes', artworkUrl: null };
            rows.push(row, { ...row });
          }
          window.__sonusTagEditorTest.openSearchResults(rows);
          await sleep(450);
          const backdrop = document.querySelector('.tag-search-backdrop');
          if (!backdrop) return { noBackdrop: true };
          const cs = getComputedStyle(backdrop);
          const out = {
            cardCount: [...backdrop.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Use this').length,
            text: backdrop.textContent,
            appRegion: cs.getPropertyValue('-webkit-app-region') || backdrop.style.webkitAppRegion || '',
            insideForm: !!backdrop.closest('.scrollable'),
            formBefore,
            formAfter: document.querySelector('.scrollable').scrollHeight,
          };
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(350);
          out.closedByEscape = !document.querySelector('.tag-search-backdrop');
          return out;
        })()
      `, true);

      if (popup.noHook) failures.push('tag editor test hook (?test=1) not present');
      else if (popup.noBackdrop) failures.push('search results popup did not open');
      else {
        check(popup.insideForm === false, 'results popup renders outside the scrolling form');
        check(win.getBounds().height === heightBeforePopup,
          `window does not resize when results open (${heightBeforePopup} → ${win.getBounds().height})`);
        check(popup.formAfter === popup.formBefore,
          `results no longer inflate the form's height (${popup.formBefore} → ${popup.formAfter})`);
        // The silent trap: without no-drag the panel background drags the window.
        check(popup.appRegion === 'no-drag', `results popup opts out of the window drag region (${popup.appRegion || 'unset'})`);
        check(popup.cardCount === 10, `10 results shown from a 40-duplicated-to-80 pool (${popup.cardCount})`);
        check(popup.text.includes('10 results found'), 'header reports the de-duplicated count');
        check(popup.text.includes('Song 0') && popup.text.includes('Song 9') && !popup.text.includes('Song 10'),
          'the 10 shown are the first 10, in relevance order');
        check(popup.closedByEscape === true, 'Escape closes the results popup');
      }

      win.destroy();
      await sleep(400);

      // The shorter layout: a format with no Lyrics column (only MP3/FLAC/WAV
      // get one). A synthetic track is enough — the editor is handed the whole
      // object over IPC and only reads the extension to decide. Also re-checks
      // that a *fresh* window centres, not just the first one of the run.
      openTagEditor({ ...track, filePath: '/synthetic/no-lyrics-column.m4a', lyrics: null });
      let win2 = null;
      for (let i = 0; i < 50; i++) {
        await sleep(150);
        const w = getTagEditorWindow();
        if (w && !w.isDestroyed() && w.isVisible()) { win2 = w; break; }
      }
      if (!win2) {
        failures.push('tag editor did not reopen for the no-lyrics layout');
      } else {
        await sleep(500);
        const b2 = win2.getBounds();
        const wa2 = screen.getDisplayMatching(b2).workArea;
        const dy2 = (b2.y + b2.height / 2) - (wa2.y + wa2.height / 2);
        check(Math.abs(dy2) <= 2, `no-lyrics-column layout also centred (off by ${Math.round(dy2)}px)`);
        win2.destroy();
        await sleep(300);
      }
    }
  } catch (err) {
    failures.push(`tag editor centring error: ${err.stack || err}`);
  }

  // ── Scale bench: 20k tracks — bounded DOM, fast sort, live scroll window ──
  if (wants('bench')) try {
    const benchResult = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const out = {};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        if (!window.__sonusTest) { out.noHook = true; return out; }
        window.__sonusTest.setView('library');

        const N = 20000;
        const tracks = new Array(N);
        for (let i = 0; i < N; i++) {
          tracks[i] = {
            title: 'Bench ' + String(i).padStart(5, '0'), artist: 'Artist ' + (i % 500),
            album: 'Album ' + (i % 2000), albumArtist: '', year: 1960 + (i % 66),
            duration: 90 + (i % 400), genre: '', thumb: null, lyrics: null,
            trackNumber: '', trackTotal: '', discNumber: '', discTotal: '',
            composer: '', comment: '', bpm: '', bitrate: 256, codecProfile: null,
            dateAdded: 1600000000000 + i, playCount: (i * 7) % 100, lastPlayed: null,
            filePath: '/bench/t' + i + '.mp3',
          };
        }
        const t0 = performance.now();
        window.__sonusTest.setLibrary(tracks);
        await sleep(600);
        out.injectMs = performance.now() - t0;
        out.rowCount = document.querySelectorAll('.track-row').length;

        // canDrag must be gated off above 5k — leading cell shows index, not grip
        out.hasGrip = !!document.querySelector('.track-row svg.lucide-grip-vertical');

        // sort 20k by title (click header) and time it
        const t1 = performance.now();
        document.querySelectorAll('.track-header-label')[0]?.click();
        await sleep(500);
        out.sortMs = performance.now() - t1 - 500;
        const firstTitle = document.querySelector('.track-row')?.children[2]?.children[0]?.textContent;
        out.sortedFirst = firstTitle;
        out.rowCountAfterSort = document.querySelectorAll('.track-row').length;

        // deep programmatic scroll: window must move, stay bounded
        const scrollEl = document.querySelector('.scrollable');
        scrollEl.scrollTop = 400000;
        await sleep(400);
        out.rowCountDeep = document.querySelectorAll('.track-row').length;
        out.deepFirst = document.querySelector('.track-row')?.children[2]?.children[0]?.textContent;

        // Walk the rest of the Title cycle back to manual, then clean up.
        for (let i = 0; i < 4; i++) {
          document.querySelectorAll('.track-header-label')[0]?.click();
          await sleep(200);
        }
        window.__sonusTest.setLibrary([]);
        await sleep(100);
        return out;
      })()
    `, true);

    if (!benchResult.noHook) {
      check(benchResult.rowCount > 0 && benchResult.rowCount < 80, `20k: mounted rows bounded (${benchResult.rowCount})`);
      check(benchResult.rowCountAfterSort < 80, `20k: bounded after sort (${benchResult.rowCountAfterSort})`);
      check(benchResult.rowCountDeep < 80, `20k: bounded after deep scroll (${benchResult.rowCountDeep})`);
      check(!benchResult.hasGrip, '20k: drag gated off (no grip handles)');
      check(benchResult.sortedFirst === 'Bench 00000', `20k: title sort correct (${benchResult.sortedFirst})`);
      check(benchResult.deepFirst !== benchResult.sortedFirst, `20k: scroll window actually moved (${benchResult.deepFirst})`);
      metrics.bench20k = {
        injectMs: Math.round(benchResult.injectMs),
        sortMs: Math.round(benchResult.sortMs),
        mountedRows: benchResult.rowCount,
      };
      // This budget was suspected of being an Apple-Silicon assumption that
      // would false-fail on a 2017 Intel iMac. Measuring it settled the
      // question: sortMs is ~1ms, because only the ~21 mounted rows re-render,
      // not all 20,000. The 1500ms ceiling therefore has three orders of
      // magnitude of headroom and is in no danger on slow hardware — it stays
      // tight, because what it exists to catch (virtualization lost, all 20k
      // rows re-rendered) costs seconds and a loose ceiling would let a real
      // regression through. The measured value is recorded above regardless.
      check(benchResult.sortMs < 1500, `20k: sort re-render under budget (${Math.round(benchResult.sortMs)}ms)`);
    }
  } catch (err) {
    failures.push(`scale bench error: ${err.stack || err}`);
  }

  // ── Compositor cost of the glass UI (measured, deliberately not asserted) ──
  // Sonus's whole look is GPU blur: .glass-panel blur(30px), the player panel
  // and Now Playing backdrop at blur(40px), and — the expensive one — three
  // independently animated circles inside a blur(100px) container behind the
  // artwork. On Apple Silicon that is free. On a 2017 Intel iMac (Iris Plus 640
  // or a Radeon Pro pushing a 5K panel) it may not be, and "does it feel
  // smooth?" is not something a screenshot or an opinion can answer.
  //
  // Two windows are sampled so the result is comparable ACROSS machines with
  // different refresh rates: a baseline in Library (no overlay, no furnace) and
  // Now Playing with the furnace running. A 120Hz ProMotion Mac idles at
  // ~8.3ms and a 60Hz iMac at ~16.7ms, so the absolute p50 means little on its
  // own — the ratio between the two windows is the signal.
  //
  // Reported as metrics, never asserted: the correct threshold for "too slow"
  // is a judgement call, and a hard limit here would turn slow-but-working
  // hardware into a red build and mask real failures. The only assertion is
  // that the measurement actually ran.
  if (wants('frames')) try {
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const [track] = await parseFilePaths([fixture]);
    mainWindow.webContents.send('open-external-file', { tracks: [track], failedCount: 0 });
    await sleep(1200);

    const frame = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const out = {};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        if (!window.__sonusTest) { out.noHook = true; return out; }

        // Collect raw requestAnimationFrame deltas for a fixed wall-clock window.
        const sampleFrames = (ms) => new Promise(resolve => {
          const deltas = [];
          let last = performance.now();
          const start = last;
          const tick = (now) => {
            deltas.push(now - last);
            last = now;
            if (now - start < ms) requestAnimationFrame(tick);
            // Drop the first few: the frame a view switch lands on includes
            // layout and first paint, which is startup cost, not steady state.
            else resolve(deltas.slice(3));
          };
          requestAnimationFrame(tick);
        });
        const pctl = (arr, p) => {
          if (!arr.length) return null;
          const s = [...arr].sort((a, b) => a - b);
          return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
        };
        const summarize = (d) => ({
          frames: d.length,
          p50: pctl(d, 0.5),
          p95: pctl(d, 0.95),
          max: d.length ? Math.round(Math.max(...d) * 10) / 10 : null,
          // At 60Hz a frame over 20ms was dropped; a useful count on any display.
          janky: d.filter(x => x > 20).length,
        });

        // ── Baseline: Library, no overlay, no furnace ──
        window.__sonusTest.setView('library');
        await sleep(700);
        out.baseline = summarize(await sampleFrames(1500));

        // ── Stress: Now Playing with the furnace live ──
        // The flares render only when artworkRgb resolved (fast-average-color
        // over the thumbnail) AND isPlaying is true — they are opacity 0 and
        // animation-paused otherwise, so measuring a paused player would
        // measure nothing. Muted playback is used deliberately: Chromium allows
        // it with no user gesture, and the compositing work is identical.
        const a = document.querySelector('audio');
        if (a) { a.muted = true; try { await a.play(); } catch { /* policy */ } }
        window.__sonusTest.setView('now_playing');

        const flareCount = () => [...document.querySelectorAll('div')]
          .filter(el => (getComputedStyle(el).animationName || '').includes('np-flare')).length;
        // Poll for the furnace to actually exist rather than trusting a delay.
        for (let i = 0; i < 120 && flareCount() === 0; i++) await sleep(50);
        out.flares = flareCount();
        out.playing = a ? !a.paused : false;
        out.artworkPresent = !!document.querySelector('.np-artwork');
        // The furnace wrapper fades in over 1.5s; measure the settled state.
        await sleep(1700);
        out.nowPlaying = summarize(await sampleFrames(2500));

        // ── Chill mode: the photo + the spinning record, no furnace ──
        window.__sonusTest.setChillMode(true);
        for (let i = 0; i < 120 && !document.querySelector('.chill-scene'); i++) await sleep(50);
        const spinState = () => { const an = document.querySelector('.chill-spin')?.getAnimations()[0]; return an ? an.playState : null; };
        for (let i = 0; i < 120 && spinState() !== 'running'; i++) await sleep(50);
        out.chillSpinning = spinState() === 'running';
        await sleep(1500);
        out.chill = summarize(await sampleFrames(2500));
        // ── Chill mode, hammock scene: the photo drawn by WebGL every frame ──
        window.__sonusTest.setChillScene('beach');
        for (let i = 0; i < 120 && document.querySelector('.chill-living')?.dataset.live !== 'true'; i++) await sleep(50);
        out.chillBeachLive = document.querySelector('.chill-living')?.dataset.live === 'true';
        await sleep(1500);
        out.chillBeach = summarize(await sampleFrames(2500));
        // ── Chill mode, study room: rain, typing, breathing and lights, drawn by WebGL every frame ──
        window.__sonusTest.setChillScene('room');
        for (let i = 0; i < 120 && document.querySelector('.chill-living')?.dataset.live !== 'true'; i++) await sleep(50);
        out.chillRoomLive = document.querySelector('.chill-living')?.dataset.live === 'true';
        await sleep(1500);
        out.chillRoom = summarize(await sampleFrames(2500));
        window.__sonusTest.setChillScene('turntable');
        window.__sonusTest.setChillMode(false);
        await sleep(300);

        if (a) { a.pause(); a.muted = false; }
        window.__sonusTest.setView('library');
        window.__sonusTest.setLibrary([]);
        await sleep(150);
        return out;
      })()
    `, true);

    if (!frame.noHook) {
      metrics.frameTimeMs = {
        baseline: frame.baseline,
        nowPlaying: frame.nowPlaying,
        chill: frame.chill,
        chillBeach: frame.chillBeach,
        chillRoom: frame.chillRoom,
        flares: frame.flares,
        playing: frame.playing,
        // How much the glass UI costs over an ordinary list view. ~1.0 means
        // the furnace is free; a large ratio is the number to act on.
        npCostRatio: frame.baseline?.p50 && frame.nowPlaying?.p50
          ? Math.round((frame.nowPlaying.p50 / frame.baseline.p50) * 100) / 100
          : null,
      };
      // Sanity only — proves the probe ran, asserts nothing about speed.
      check((frame.baseline?.frames ?? 0) > 20 && (frame.nowPlaying?.frames ?? 0) > 20,
        `frame-time probe collected samples (baseline ${frame.baseline?.frames}, NP ${frame.nowPlaying?.frames})`);
      check((frame.chill?.frames ?? 0) > 20 && frame.chillSpinning === true,
        `frame-time probe measured Chill mode while the record spun (frames ${frame.chill?.frames}, spinning ${frame.chillSpinning})`);
      check((frame.chillBeach?.frames ?? 0) > 20 && frame.chillBeachLive === true,
        `frame-time probe measured the animated hammock scene while WebGL was drawing it (frames ${frame.chillBeach?.frames}, live ${frame.chillBeachLive})`);
      check((frame.chillRoom?.frames ?? 0) > 20 && frame.chillRoomLive === true,
        `frame-time probe measured the animated study room while WebGL was drawing it (frames ${frame.chillRoom?.frames}, live ${frame.chillRoomLive})`);
      // If the furnace never rendered, the NP number is measuring an empty
      // panel and must not be mistaken for a clean bill of health.
      check(frame.flares === 3 && frame.playing === true,
        `frame-time probe actually stressed the blur furnace (flares ${frame.flares}, playing ${frame.playing})`);
    }
  } catch (err) {
    failures.push(`frame-time probe error: ${err.stack || err}`);
  }

  // "Start Mix" — drives the Details screen's async 'mix' item type entirely
  // through window.__sonusTest.seedMixResult (mirrors
  // __sonusTagEditorTest.openSearchResults for Search Online), so this never
  // makes a real call to MusicBrainz/ListenBrainz/Deezer. The matching
  // pipeline itself (mixMatch.js) is covered by its own unit tests; this
  // checks the UI wiring — the Details page renders what useMix hands it,
  // Play works, and the "Playing from" breadcrumb picks it up.
  if (wants('mix')) try {
    // All three need to be real, existing files, not just the one Play
    // actually loads into <audio>: the "on window focus, batch-check every
    // library path and silently remove whatever's missing" effect in
    // App.jsx doesn't care which track is playing — it validates the whole
    // library via fs.access and drops anything that fails, and a real
    // window focus event is entirely plausible mid-suite. match/unrelated
    // are never played, so a plain copy of the fixture is enough — nothing
    // ever parses these as audio, only matches their filePath against
    // fs.access and their title/artist against page text.
    const fixture = path.join(__dirname, '..', 'test-fixture.mp3');
    const matchCopy = path.join(app.getPath('userData'), 'smoke-mix-match.mp3');
    const unrelatedCopy = path.join(app.getPath('userData'), 'smoke-mix-unrelated.mp3');
    await fs.copyFile(fixture, matchCopy);
    await fs.copyFile(fixture, unrelatedCopy);
    const seed = { filePath: fixture, title: 'Mix Seed Song', artist: 'Mix Seed Artist', album: 'A', year: 2020, duration: 180 };
    const match = { filePath: matchCopy, title: 'Mix Match Song', artist: 'Mix Similar Artist', album: 'B', year: 2019, duration: 200 };
    const unrelated = { filePath: unrelatedCopy, title: 'Mix Unrelated Song', artist: 'Nobody Similar', album: 'C', year: 2018, duration: 150 };

    await mainWindow.webContents.executeJavaScript(`
      window.__sonusTest.setLibrary(${JSON.stringify([seed, match, unrelated])});
      window.__sonusTest.seedMixResult(${JSON.stringify({ artist: seed.artist, title: seed.title })}, ${JSON.stringify([match])});
      window.__sonusTest.setView('library');
    `, true);
    await sleep(150);

    await mainWindow.webContents.executeJavaScript(`
      window.__sonusTest.openDetail({ type: 'mix', key: ${JSON.stringify(seed.filePath)}, label: ${JSON.stringify(seed.title)} });
    `, true);

    // Even on a cache hit, useMix's lookup only runs inside its effect — the
    // very first render still shows its useState initial value ('idle',
    // rendered as "Finding similar tracks…"), one tick before the effect
    // resolves it synchronously from the cache. The hero title/kicker render
    // immediately regardless (they only need item.label, not the fetch), so
    // waiting on those alone would race the actual tracklist — wait for the
    // matched track's own title instead, which only ever appears once
    // useMix has genuinely reached 'ready'.
    const populated = await waitFor(`
      (function() {
        const body = document.body.innerText;
        return {
          hasMixKicker: body.includes('MIX'),
          hasSeed: body.includes(${JSON.stringify(seed.title)}),
          hasMatch: body.includes(${JSON.stringify(match.title)}),
          hasUnrelated: body.includes(${JSON.stringify(unrelated.title)}),
        };
      })()
    `, (r) => r.hasMatch, { timeout: 4000 });
    check(populated.hasMixKicker, 'mix: Details page shows the MIX kicker');
    check(populated.hasSeed, `mix: Details page shows the seed track's title`);
    check(populated.hasMatch, 'mix: shows the matched track from the seeded result');
    check(!populated.hasUnrelated, 'mix: does not show an unrelated library track');

    const playAllClicked = await mainWindow.webContents.executeJavaScript(`
      (function() {
        const btn = document.querySelector('.detail-play-button');
        if (!btn || btn.disabled) return false;
        btn.click();
        return true;
      })()
    `, true);
    check(playAllClicked, 'mix: Play is enabled and clickable once results are ready');

    await sleep(300);
    await mainWindow.webContents.executeJavaScript(`window.__sonusTest.setView('now_playing')`, true);
    const npBreadcrumb = await waitFor(
      `document.body.innerText.includes('Playing from')`,
      (r) => r === true,
      { timeout: 3000 }
    );
    check(npBreadcrumb === true, 'mix: Now Playing shows the "Playing from" breadcrumb after Play');

    // Empty state: a seeded result of zero tracks, using a second, still-
    // fake seed track (this one is never played, only opened as a mix, so
    // it doesn't need to be a real file the way `seed` above does).
    await mainWindow.webContents.executeJavaScript(`
      window.__sonusTest.closeDetail();
      window.__sonusTest.setView('library');
      window.__sonusTest.seedMixResult(${JSON.stringify({ artist: unrelated.artist, title: unrelated.title })}, []);
    `, true);
    await sleep(400);
    await mainWindow.webContents.executeJavaScript(`
      window.__sonusTest.openDetail({ type: 'mix', key: ${JSON.stringify(unrelated.filePath)}, label: ${JSON.stringify(unrelated.title)} });
    `, true);
    const empty = await waitFor(
      `document.body.innerText.includes('No similar tracks found in your library yet.')`,
      (r) => r === true,
      { timeout: 4000 }
    );
    check(empty === true, 'mix: empty result shows the "no similar tracks" state');

    await mainWindow.webContents.executeJavaScript(`
      window.__sonusTest.closeDetail();
      window.__sonusTest.setLibrary([]);
    `, true);
    await sleep(150);
  } catch (err) {
    failures.push(`mix error: ${err.stack || err}`);
  }

  // Renderer console errors are failures (ignore benign autoplay policy noise).
  const realErrors = consoleErrors.filter(m => !/Autoplay|play\(\) failed|user didn't interact/i.test(m));
  if (realErrors.length > 0) failures.push(`renderer console errors: ${realErrors.join(' | ')}`);

  const partial = only.length > 0;
  if (partial) console.log(`SMOKE PARTIAL RUN (${only.join(', ')} only): not a release gate, run the full suite before building.`);
  console.log('SMOKE_RESULT:' + JSON.stringify({ ok: failures.length === 0, failures, metrics, ...(partial ? { partial: true, only } : {}), ...envInfo() }));
  app.exit(failures.length === 0 ? 0 : 1);
}
