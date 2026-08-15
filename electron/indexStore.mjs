// Persistent metadata index + play-stats store. Plain JSON, no native deps —
// deliberately isolated behind this module so a future SQLite swap is contained.
//
// Two files, two write cadences:
//   library-index.json — parsed metadata per filePath (big, changes rarely)
//   play-stats.json    — playCount/lastPlayed per filePath (tiny, changes often)
// Keeping them separate means bumping a play count never rewrites the big index.
//
// No Electron imports — unit-testable under vitest with a temp dir.

import fs from 'fs/promises';
import path from 'path';

export const INDEX_VERSION = 1;

const INDEX_SAVE_DEBOUNCE_MS = 1000;
const STATS_SAVE_DEBOUNCE_MS = 2000;

// Crash-safe write: temp file in the same dir, then rename over the target.
// (userData is app-owned, so directory-level writes are always permitted here —
// unlike the music folders, where fs:writeTag deliberately avoids temp files.)
async function writeAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, filePath);
}

// Pure diff: partition library paths against fresh stat results + the index.
//   paths       string[] — the library's track paths, in order
//   statResults Map(path -> { mtimeMs, birthtimeMs } | null)  (null = missing)
//   indexed     Map(path -> entry with .mtimeMs)
// Returns { missing, toParse, fresh } — fresh entries can be served from cache.
export function diffPaths(paths, statResults, indexed) {
  const missing = [];
  const toParse = [];
  const fresh = [];
  for (const p of paths) {
    const st = statResults.get(p);
    if (!st) { missing.push(p); continue; }
    const entry = indexed.get(p);
    if (!entry || entry.mtimeMs !== st.mtimeMs) toParse.push(p);
    else fresh.push(p);
  }
  return { missing, toParse, fresh };
}

export function createIndexStore({ indexPath, statsPath }) {
  /** @type {Map<string, object>} filePath -> metadata entry (incl. mtimeMs, dateAdded, thumb) */
  const tracks = new Map();
  /** @type {Map<string, {playCount: number, lastPlayed: number|null}>} */
  const stats = new Map();

  let indexTimer = null;
  let statsTimer = null;
  let loaded = false;

  async function load() {
    try {
      const raw = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
      if (raw?.version === INDEX_VERSION && raw.tracks && typeof raw.tracks === 'object') {
        for (const [p, entry] of Object.entries(raw.tracks)) tracks.set(p, entry);
      }
      // version mismatch → start empty; caller reindexes in the background
    } catch { /* first run or unreadable — start empty */ }
    try {
      const raw = JSON.parse(await fs.readFile(statsPath, 'utf-8'));
      if (raw?.stats && typeof raw.stats === 'object') {
        for (const [p, s] of Object.entries(raw.stats)) {
          if (s && typeof s.playCount === 'number') {
            stats.set(p, { playCount: s.playCount, lastPlayed: s.lastPlayed ?? null });
          }
        }
      }
    } catch { /* no stats yet */ }
    loaded = true;
  }

  async function saveIndexNow() {
    clearTimeout(indexTimer);
    indexTimer = null;
    const obj = { version: INDEX_VERSION, tracks: Object.fromEntries(tracks) };
    try {
      await fs.mkdir(path.dirname(indexPath), { recursive: true });
      await writeAtomic(indexPath, JSON.stringify(obj));
    } catch (err) {
      console.error('Failed to save library index:', err);
    }
  }

  async function saveStatsNow() {
    clearTimeout(statsTimer);
    statsTimer = null;
    const obj = { version: 1, stats: Object.fromEntries(stats) };
    try {
      await fs.mkdir(path.dirname(statsPath), { recursive: true });
      await writeAtomic(statsPath, JSON.stringify(obj));
    } catch (err) {
      console.error('Failed to save play stats:', err);
    }
  }

  function scheduleIndexSave() {
    clearTimeout(indexTimer);
    indexTimer = setTimeout(saveIndexNow, INDEX_SAVE_DEBOUNCE_MS);
  }

  function scheduleStatsSave() {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(saveStatsNow, STATS_SAVE_DEBOUNCE_MS);
  }

  return {
    load,
    get loaded() { return loaded; },
    get size() { return tracks.size; },

    getEntry: (p) => tracks.get(p) ?? null,
    hasEntry: (p) => tracks.has(p),
    entriesMap: () => tracks,

    setEntry(p, entry) {
      tracks.set(p, entry);
      scheduleIndexSave();
    },

    removeEntries(paths) {
      let removed = false;
      for (const p of paths) removed = tracks.delete(p) || removed;
      if (removed) scheduleIndexSave();
      return removed;
    },

    getStats: (p) => stats.get(p) ?? { playCount: 0, lastPlayed: null },

    recordPlay(p, now = Date.now()) {
      const s = stats.get(p) ?? { playCount: 0, lastPlayed: null };
      const next = { playCount: s.playCount + 1, lastPlayed: now };
      stats.set(p, next);
      scheduleStatsSave();
      return next;
    },

    // Force pending writes to disk (call on app quit).
    async flush() {
      const jobs = [];
      if (indexTimer) jobs.push(saveIndexNow());
      if (statsTimer) jobs.push(saveStatsNow());
      await Promise.all(jobs);
    },
  };
}
