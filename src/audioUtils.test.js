import { describe, it, expect } from 'vitest';
import { splitArtists, detectScript, snapToTier } from './audioUtils.js';

describe('splitArtists', () => {
  it('splits on the standard collab separators', () => {
    expect(splitArtists('Inna & Bob Taylor')).toEqual(['Inna', 'Bob Taylor']);
    expect(splitArtists('A feat. B')).toEqual(['A', 'B']);
    expect(splitArtists('A feat B')).toEqual(['A', 'B']);
    expect(splitArtists('A ft. B')).toEqual(['A', 'B']);
    expect(splitArtists('A ft B')).toEqual(['A', 'B']);
    expect(splitArtists('A x B')).toEqual(['A', 'B']);
    expect(splitArtists('A, B, C')).toEqual(['A', 'B', 'C']);
    expect(splitArtists('A and B')).toEqual(['A', 'B']);
  });

  it('only splits on space-bounded x — names containing x survive', () => {
    expect(splitArtists('Alex')).toEqual(['Alex']);
    expect(splitArtists('Xzibit')).toEqual(['Xzibit']);
  });

  it('returns [] for empty input', () => {
    expect(splitArtists('')).toEqual([]);
    expect(splitArtists(null)).toEqual([]);
    expect(splitArtists(undefined)).toEqual([]);
  });

  // Repeated-token rule: a real collab never lists the same artist twice, so
  // a repeated token means the separator is part of the artist's name —
  // treat the whole string as one artist. (Bug: "Years & Years" split into
  // ['Years','Years'] → duplicate React keys → corrupted player subtitle,
  // plus double-counted tracks in groupByArtist.)
  it('keeps names whose separator is part of the name intact', () => {
    expect(splitArtists('Years & Years')).toEqual(['Years & Years']);
    expect(splitArtists('Danism & Rae & Rae')).toEqual(['Danism & Rae & Rae']);
  });

  it('detects repeats case-insensitively', () => {
    expect(splitArtists('years & Years')).toEqual(['years & Years']);
  });

  it('never returns duplicate tokens', () => {
    for (const input of ['Years & Years', 'A & B', 'A, A', 'X feat. x']) {
      const tokens = splitArtists(input).map(t => t.toLowerCase());
      expect(new Set(tokens).size).toBe(tokens.length);
    }
  });
});

describe('detectScript', () => {
  it('classifies dominant scripts', () => {
    expect(detectScript('Hello World')).toBe('English');
    expect(detectScript('שיר של יום')).toBe('Hebrew');
    expect(detectScript('أغنية جميلة')).toBe('Arabic');
    expect(detectScript('Песня дня')).toBe('Cyrillic');
    expect(detectScript('残酷な天使のテーゼ')).toBe('CJK');
  });

  it('falls back to English for empty or letterless titles', () => {
    expect(detectScript('')).toBe('English');
    expect(detectScript('123 - 456')).toBe('English');
    expect(detectScript(null)).toBe('English');
  });
});

describe('snapToTier', () => {
  it('snaps to the nearest standard tier', () => {
    expect(snapToTier(318)).toBe(320);
    expect(snapToTier(129)).toBe(128);
    expect(snapToTier(192)).toBe(192);
  });
  it('classifies very high bitrates as Lossless', () => {
    expect(snapToTier(950)).toBe('Lossless');
  });
  it('returns null for missing bitrate', () => {
    expect(snapToTier(null)).toBeNull();
  });
});
