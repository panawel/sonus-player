import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createIndexStore, diffPaths, INDEX_VERSION } from './indexStore.mjs';

let dir;
const indexPath = () => path.join(dir, 'library-index.json');
const statsPath = () => path.join(dir, 'play-stats.json');

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonus-index-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('diffPaths', () => {
  const entry = (mtimeMs) => ({ title: 'x', mtimeMs });

  it('partitions missing / changed / new / fresh correctly', () => {
    const paths = ['/a.mp3', '/b.mp3', '/c.mp3', '/d.mp3'];
    const stats = new Map([
      ['/a.mp3', { mtimeMs: 100 }],  // fresh (matches index)
      ['/b.mp3', { mtimeMs: 200 }],  // changed (index has 150)
      ['/c.mp3', null],              // missing on disk
      ['/d.mp3', { mtimeMs: 300 }],  // not indexed at all
    ]);
    const indexed = new Map([
      ['/a.mp3', entry(100)],
      ['/b.mp3', entry(150)],
      ['/c.mp3', entry(100)],
    ]);
    const { missing, toParse, fresh } = diffPaths(paths, stats, indexed);
    expect(missing).toEqual(['/c.mp3']);
    expect(toParse).toEqual(['/b.mp3', '/d.mp3']);
    expect(fresh).toEqual(['/a.mp3']);
  });

  it('handles empty inputs', () => {
    expect(diffPaths([], new Map(), new Map())).toEqual({ missing: [], toParse: [], fresh: [] });
  });
});

describe('createIndexStore', () => {
  it('starts empty when no files exist', async () => {
    const store = createIndexStore({ indexPath: indexPath(), statsPath: statsPath() });
    await store.load();
    expect(store.size).toBe(0);
    expect(store.getEntry('/x.mp3')).toBeNull();
    expect(store.getStats('/x.mp3')).toEqual({ playCount: 0, lastPlayed: null });
  });

  it('persists entries across store instances via flush', async () => {
    const a = createIndexStore({ indexPath: indexPath(), statsPath: statsPath() });
    await a.load();
    a.setEntry('/song.mp3', { title: 'Song', mtimeMs: 42, dateAdded: 1000, thumb: null });
    await a.flush();

    const b = createIndexStore({ indexPath: indexPath(), statsPath: statsPath() });
    await b.load();
    expect(b.size).toBe(1);
    expect(b.getEntry('/song.mp3')).toEqual({ title: 'Song', mtimeMs: 42, dateAdded: 1000, thumb: null });
  });

  it('removeEntries deletes and persists', async () => {
    const a = createIndexStore({ indexPath: indexPath(), statsPath: statsPath() });
    await a.load();
    a.setEntry('/one.mp3', { mtimeMs: 1 });
    a.setEntry('/two.mp3', { mtimeMs: 2 });
    a.removeEntries(['/one.mp3', '/never-existed.mp3']);
    await a.flush();

    const b = createIndexStore({ indexPath: indexPath(), statsPath: statsPath() });
    await b.load();
    expect(b.hasEntry('/one.mp3')).toBe(false);
    expect(b.hasEntry('/two.mp3')).toBe(true);
  });

  it('recordPlay increments count, stamps lastPlayed, and persists separately', async () => {
    const a = createIndexStore({ indexPath: indexPath(), statsPath: statsPath() });
    await a.load();
    const first = a.recordPlay('/song.mp3', 5000);
    expect(first).toEqual({ playCount: 1, lastPlayed: 5000 });
    const second = a.recordPlay('/song.mp3', 9000);
    expect(second).toEqual({ playCount: 2, lastPlayed: 9000 });
    await a.flush();

    // stats survive a reload without an index entry existing
    const b = createIndexStore({ indexPath: indexPath(), statsPath: statsPath() });
    await b.load();
    expect(b.getStats('/song.mp3')).toEqual({ playCount: 2, lastPlayed: 9000 });
    expect(b.size).toBe(0); // stats never leak into the index file
  });

  it('discards an index written by a different version', async () => {
    await fs.writeFile(indexPath(), JSON.stringify({
      version: INDEX_VERSION + 1,
      tracks: { '/old.mp3': { title: 'Old', mtimeMs: 1 } },
    }));
    const store = createIndexStore({ indexPath: indexPath(), statsPath: statsPath() });
    await store.load();
    expect(store.size).toBe(0);
  });

  it('survives a corrupt index file', async () => {
    await fs.writeFile(indexPath(), 'not json {{{');
    const store = createIndexStore({ indexPath: indexPath(), statsPath: statsPath() });
    await store.load();
    expect(store.size).toBe(0);
  });

  it('debounced saves land on disk without an explicit flush', async () => {
    const a = createIndexStore({ indexPath: indexPath(), statsPath: statsPath() });
    await a.load();
    a.setEntry('/song.mp3', { mtimeMs: 7 });
    await new Promise(r => setTimeout(r, 1300)); // > INDEX_SAVE_DEBOUNCE_MS
    const raw = JSON.parse(await fs.readFile(indexPath(), 'utf-8'));
    expect(raw.tracks['/song.mp3']).toEqual({ mtimeMs: 7 });
  });
});
