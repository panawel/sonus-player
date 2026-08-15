// Pure helpers for files handed to the app by the OS (Finder double-click,
// "Open With", the Services menu). No Electron imports — unit-tested directly.

import path from 'path';

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
