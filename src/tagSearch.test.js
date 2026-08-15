import { describe, it, expect } from 'vitest';
import { dedupeSearchResults, SEARCH_MAX_RESULTS } from './tagSearch.js';

const r = (title, artist, album, year, extra = {}) => ({ title, artist, album, year, ...extra });

describe('dedupeSearchResults', () => {
  it('drops only exact repeats — same title, artist, album AND year', () => {
    const out = dedupeSearchResults([
      r('One More Time', 'Daft Punk', 'Discovery', '2001'),
      r('One More Time', 'Daft Punk', 'Discovery', '2001'), // exact repeat
      r('One More Time', 'Daft Punk', 'Alive 2007', '2007'),
    ]);
    expect(out.map(x => x.album)).toEqual(['Discovery', 'Alive 2007']);
  });

  it('keeps different releases of the same song — that is the point when tagging', () => {
    const out = dedupeSearchResults([
      r('Song', 'A', 'Album', '2001'),
      r('Song', 'A', 'Single', '2001'),      // different album
      r('Song', 'A', 'Album', '2015'),       // reissue, different year
      r('Song', 'B', 'Album', '2001'),       // different artist (cover)
    ]);
    expect(out).toHaveLength(4);
  });

  it('keeps the FIRST occurrence, preserving the APIs relevance ranking', () => {
    const out = dedupeSearchResults([
      r('Song', 'A', 'Album', '2001', { source: 'first' }),
      r('Song', 'A', 'Album', '2001', { source: 'second' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('first');
  });

  it('never reorders', () => {
    const input = [r('C', 'x', 'p', '1'), r('A', 'x', 'q', '2'), r('B', 'x', 'r', '3')];
    expect(dedupeSearchResults(input).map(x => x.title)).toEqual(['C', 'A', 'B']);
  });

  // The bug this ordering exists to prevent: de-duplicating an already-sliced
  // list of 10 would leave fewer than 10, quietly undoing the raised limit.
  it('fills up to the cap from a pool full of duplicates', () => {
    const pool = [];
    for (let i = 0; i < 40; i++) {
      pool.push(r(`Song ${i}`, 'A', 'Album', String(2000 + i)));
      pool.push(r(`Song ${i}`, 'A', 'Album', String(2000 + i))); // every entry duplicated
    }
    const out = dedupeSearchResults(pool);
    expect(out).toHaveLength(SEARCH_MAX_RESULTS);
    expect(new Set(out.map(x => x.title)).size).toBe(SEARCH_MAX_RESULTS);
    expect(out[0].title).toBe('Song 0'); // still relevance-ordered
  });

  it('caps at 10 by default', () => {
    const pool = Array.from({ length: 50 }, (_, i) => r(`S${i}`, 'A', 'Al', '2000'));
    expect(dedupeSearchResults(pool)).toHaveLength(10);
    expect(SEARCH_MAX_RESULTS).toBe(10);
  });

  it('respects an explicit cap', () => {
    const pool = Array.from({ length: 50 }, (_, i) => r(`S${i}`, 'A', 'Al', '2000'));
    expect(dedupeSearchResults(pool, 3)).toHaveLength(3);
  });

  it('returns fewer than the cap when the pool is smaller', () => {
    expect(dedupeSearchResults([r('A', 'x', 'y', '1')])).toHaveLength(1);
  });

  it('treats case and surrounding whitespace as the same entry', () => {
    const out = dedupeSearchResults([
      r('Song', 'Artist', 'Album', '2001'),
      r('  song ', 'ARTIST', ' album', '2001'),
    ]);
    expect(out).toHaveLength(1);
  });

  it('does not let adjacent fields bleed into each other', () => {
    // Naive join(' ') would make these collide: "a b"+"c" vs "a"+"b c".
    const out = dedupeSearchResults([
      r('a b', 'c', 'x', '1'),
      r('a', 'b c', 'x', '1'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('handles missing fields and empty input', () => {
    expect(dedupeSearchResults([])).toEqual([]);
    expect(dedupeSearchResults(null)).toEqual([]);
    expect(dedupeSearchResults(undefined)).toEqual([]);
    const out = dedupeSearchResults([
      r('Song', undefined, null, ''),
      r('Song', undefined, null, ''),
    ]);
    expect(out).toHaveLength(1);
  });
});
