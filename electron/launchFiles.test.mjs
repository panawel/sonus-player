import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { sortByFileName, expandOpenedPaths } from './launchFiles.mjs';

describe('sortByFileName', () => {
  it('sorts by base name, not by full path', () => {
    // /z/a.mp3 must win over /a/z.mp3 — the directory is irrelevant.
    expect(sortByFileName(['/z/a.mp3', '/a/z.mp3'])).toEqual(['/z/a.mp3', '/a/z.mp3']);
    expect(sortByFileName(['/a/z.mp3', '/z/a.mp3'])).toEqual(['/z/a.mp3', '/a/z.mp3']);
  });

  it('is numeric-aware', () => {
    expect(sortByFileName(['/m/Track 10.mp3', '/m/Track 2.mp3', '/m/Track 1.mp3']))
      .toEqual(['/m/Track 1.mp3', '/m/Track 2.mp3', '/m/Track 10.mp3']);
  });

  it('is case-insensitive', () => {
    expect(sortByFileName(['/m/beta.mp3', '/m/Alpha.mp3'])).toEqual(['/m/Alpha.mp3', '/m/beta.mp3']);
  });

  it('does not mutate the input', () => {
    const input = ['/m/c.mp3', '/m/a.mp3'];
    const out = sortByFileName(input);
    expect(input).toEqual(['/m/c.mp3', '/m/a.mp3']);
    expect(out).not.toBe(input);
  });

  it('handles empty and single-element batches', () => {
    expect(sortByFileName([])).toEqual([]);
    expect(sortByFileName(['/m/only.mp3'])).toEqual(['/m/only.mp3']);
  });

  it('is stable enough to be deterministic for duplicate names', () => {
    const input = ['/b/same.mp3', '/a/same.mp3'];
    expect(sortByFileName(input)).toEqual(sortByFileName(input));
  });
});

describe('expandOpenedPaths', () => {
  let dir;
  const touch = async (rel) => { const p = path.join(dir, rel); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, 'x'); return p; };
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonus-expand-')); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('passes plain files through, in the order given', async () => {
    const a = await touch('b.mp3'); const b = await touch('a.mp3');
    expect(await expandOpenedPaths([a, b])).toEqual([a, b]);
  });

  it('turns a folder into the files inside it, all the way down', async () => {
    const f1 = await touch('Album/01 One.mp3');
    const f2 = await touch('Album/Disc 2/01 Two.mp3');
    expect(await expandOpenedPaths([path.join(dir, 'Album')])).toEqual([f1, f2]);
  });

  it('puts an album in natural order: track 2 before track 10 (a directory listing is not sorted)', async () => {
    const t10 = await touch('Album/10 Ten.mp3'); const t2 = await touch('Album/2 Two.mp3'); const t1 = await touch('Album/1 One.mp3');
    expect(await expandOpenedPaths([path.join(dir, 'Album')])).toEqual([t1, t2, t10]);
  });

  it('keeps the order between the paths it was given, folder contents sorted inside their own slot', async () => {
    const solo = await touch('solo.mp3');
    const x2 = await touch('Folder/b.mp3'); const x1 = await touch('Folder/a.mp3');
    expect(await expandOpenedPaths([solo, path.join(dir, 'Folder')])).toEqual([solo, x1, x2]);
    expect(await expandOpenedPaths([path.join(dir, 'Folder'), solo])).toEqual([x1, x2, solo]);
  });

  it('skips hidden entries, like every other folder scan', async () => {
    const f = await touch('Album/a.mp3'); await touch('Album/.DS_Store'); await touch('Album/.hidden/x.mp3');
    expect(await expandOpenedPaths([path.join(dir, 'Album')])).toEqual([f]);
  });

  it('an empty folder contributes nothing', async () => {
    await fs.mkdir(path.join(dir, 'Empty'));
    expect(await expandOpenedPaths([path.join(dir, 'Empty')])).toEqual([]);
  });

  it('a missing path is passed through, so the parse step fails it as it always did', async () => {
    const missing = path.join(dir, 'gone.mp3');
    expect(await expandOpenedPaths([missing])).toEqual([missing]);
  });
});
