// Pure helpers for files handed to the app by the OS (Finder double-click,
// "Open With", the Services menu). No Electron imports — unit-tested directly.

import path from 'path';
import fs from 'fs/promises';
import { expandToFiles } from './folderScan.mjs';

// macOS fires one 'open-file' event per file in a multi-file Finder selection,
// in no guaranteed order, so a batch is sorted by file name before use. That
// makes "the first track" deterministic across runs and close to Finder's own
// name sort (the OS never tells us its actual display order). Numeric-aware so
// "Track 2" lands before "Track 10".
export function sortByFileName(paths) {
  return [...paths].sort((a, b) =>
    path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' })
  );
}

// A Finder Service can hand the app a FOLDER as well as files (right-click a
// folder > Sonus - Add to Queue / Play Next / Play). Turn every folder into the
// files inside it, all the way down (folderScan.mjs, the same scan drag-and-drop
// and Add Music use), in natural file-name order: a directory listing's own order
// is not guaranteed (APFS doesn't sort), and an album's tracks must queue as
// 01, 02, ... 10. Order between the given paths is kept. A path that is missing
// or unreadable is passed through untouched, so the parse step fails it exactly
// as it did before folders existed (and a folder that can't be read is dropped).
export async function expandOpenedPaths(paths) {
  const out = [];
  for (const p of paths) {
    let isDir = false;
    try { isDir = (await fs.stat(p)).isDirectory(); } catch { /* missing: keep it */ }
    if (!isDir) { out.push(p); continue; }
    try {
      const files = await expandToFiles([p]);
      files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      out.push(...files);
    } catch { /* unreadable folder: nothing to add */ }
  }
  return out;
}
