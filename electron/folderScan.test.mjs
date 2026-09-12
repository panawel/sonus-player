import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { expandToFiles } from './folderScan.mjs';

let dir;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonus-folderscan-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const touch = async (relPath) => {
  const full = path.join(dir, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, '');
  return full;
};

describe('expandToFiles', () => {
  it('passes a plain file straight through', async () => {
    const file = await touch('track.mp3');
    expect(await expandToFiles([file])).toEqual([file]);
  });

  it('recurses into nested Artist/Album subfolders', async () => {
    const a = await touch('Artist A/Album 1/track1.mp3');
    const b = await touch('Artist A/Album 2/track2.mp3');
    const c = await touch('Artist B/track3.mp3');
    const result = await expandToFiles([dir]);
    expect(result.sort()).toEqual([a, b, c].sort());
  });

  it('skips hidden files and directories', async () => {
    await touch('.DS_Store');
    await touch('.git/config');
    const visible = await touch('track.mp3');
    expect(await expandToFiles([dir])).toEqual([visible]);
  });

  it('handles a mix of files and directories in one call', async () => {
    const loose = await touch('loose.mp3');
    const nested = await touch('Folder/nested.mp3');
    const subdir = path.join(dir, 'Folder');
    const result = await expandToFiles([loose, subdir]);
    expect(result.sort()).toEqual([loose, nested].sort());
  });

  it('returns an empty array for an empty directory', async () => {
    const empty = path.join(dir, 'Empty');
    await fs.mkdir(empty);
    expect(await expandToFiles([empty])).toEqual([]);
  });

  it('does not filter by extension — that is parseFilePaths\' job', async () => {
    const readme = await touch('README.txt');
    expect(await expandToFiles([readme])).toEqual([readme]);
  });
});
