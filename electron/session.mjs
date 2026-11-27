// The app's session: everything about "how it was when you quit" that isn't the library itself
// (library.json keeps the list of songs). Electron-free, so vitest covers it directly.
//
// The renderer (App.jsx) owns almost all of it and sends it every couple of seconds when it has
// changed, and once more, synchronously, as the window closes. main.js adds what only it knows:
// whether the strip was open. On launch the whole thing goes back to the renderer with the
// library (library:load), and main reopens the strip if it was open.
//
// Everything read back is checked here: a session file is written by an older or newer build, or
// half-written by a crash, and a bad value must never stop the app from opening.

const VIEWS = new Set(['home', 'library', 'now_playing']);
const REPEAT = new Set(['off', 'all', 'one']);
export const SESSION_LIST_MAX = 500; // queue / history / a mix's songs: far more than anyone keeps

const isStr = (v) => typeof v === 'string' && v.length > 0;
const paths = (v) => (Array.isArray(v) ? v.filter(isStr).slice(0, SESSION_LIST_MAX) : []);
const numbers = (v) => {
  const out = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, n] of Object.entries(v)) if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
};
// A details-page item: { type, key, label? }, the shape homeDetailItem uses.
const detailItem = (v) => {
  if (!v || typeof v !== 'object' || !isStr(v.type) || typeof v.key !== 'string') return null;
  const out = { type: v.type, key: v.key };
  if (typeof v.label === 'string') out.label = v.label;
  return out;
};

export function sanitizeSession(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const source = s.queueSource && typeof s.queueSource === 'object' && typeof s.queueSource.label === 'string'
    ? { label: s.queueSource.label, item: detailItem(s.queueSource.item) }
    : null;
  const mix = s.mix && typeof s.mix === 'object' && isStr(s.mix.seedPath)
    ? { seedPath: s.mix.seedPath, paths: paths(s.mix.paths) }
    : null;
  return {
    currentTrackPath: isStr(s.currentTrackPath) ? s.currentTrackPath : null,
    currentTime: Number.isFinite(s.currentTime) && s.currentTime > 0 ? s.currentTime : 0,
    isShuffle: s.isShuffle === true,
    repeatMode: REPEAT.has(s.repeatMode) ? s.repeatMode : 'off',
    view: VIEWS.has(s.view) ? s.view : 'library',
    previousView: VIEWS.has(s.previousView) && s.previousView !== 'now_playing' ? s.previousView : 'library',
    homeDetailItem: detailItem(s.homeDetailItem),
    homeDetailOrigin: VIEWS.has(s.homeDetailOrigin) ? s.homeDetailOrigin : null,
    queueSource: source,
    isChillMode: s.isChillMode === true,
    isLyricsOpen: s.isLyricsOpen === true,
    npBeside: s.npBeside === true,
    playNext: paths(s.playNext),
    history: paths(s.history),
    mix,
    scroll: numbers(s.scroll),
    detailScrolls: numbers(s.detailScrolls),
    libraryScroll: Number.isFinite(s.libraryScroll) && s.libraryScroll > 0 ? s.libraryScroll : 0,
    stripOpen: s.stripOpen === true,
  };
}

// What main.js does at launch with the saved session: reopen the strip if it was open when the
// app quit (never in the smoke suite, which always starts from a fresh profile anyway).
export function launchPlan(session, { smoke = false } = {}) {
  return { openStrip: !smoke && !!session?.stripOpen };
}
