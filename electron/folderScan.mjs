// Pure helper for expanding dropped/picked paths (files or directories) into
// a flat file list. No Electron imports — unit-tested directly.

import fs from 'fs/promises';
import path from 'path';

// A real music library is nested (Artist/Album/track.mp3), so a directory has
// to be walked all the way down, not just its immediate children. Hidden
// entries (dotfiles, .git, .DS_Store, etc.) are skipped — nothing a user drags
// in as "my music folder" is meant to include those, and recursing into e.g.
// a stray .git directory would just waste time.
async function collectFilesRecursive(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFilesRecursive(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

// Expands a list of paths — each either a file or a directory, as dropped on
// the window or picked via the Add Music dialog — into a flat list of file
// paths. Extension filtering happens elsewhere (parseFilePaths already does
// it), so every file found is included here, audio or not.
export async function expandToFiles(paths) {
  const files = [];
  for (const p of paths) {
    const stat = await fs.stat(p);
    if (stat.isDirectory()) {
      files.push(...await collectFilesRecursive(p));
    } else {
      files.push(p);
    }
  }
  return files;
}
