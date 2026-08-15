import { describe, it, expect } from 'vitest';
import { sortByFileName } from './launchFiles.mjs';

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
