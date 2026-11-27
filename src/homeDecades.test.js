import { describe, it, expect } from 'vitest';
import { decadesOf, decadeLabel, filterByDecade } from './homeDecades.js';

const lib = [{ year: 1995 }, { year: '2003-05-01' }, { year: 2024 }, { year: 2021 }, { year: '' }, { year: 'n/a' }, {}];

describe('homeDecades', () => {
  it('lists the decades that have songs, newest first, ignoring missing or bad years', () => {
    expect(decadesOf(lib)).toEqual([2020, 2000, 1990]);
  });
  it('labels them with four digits (no 1900s / 2000s clash)', () => {
    expect(decadeLabel(2000)).toBe('2000s');
    expect(decadeLabel(1900)).toBe('1900s');
  });
  it('filters to one decade, or keeps everything for none', () => {
    expect(filterByDecade(lib, 2020).map((t) => t.year)).toEqual([2024, 2021]);
    expect(filterByDecade(lib, 2000)).toHaveLength(1);
    expect(filterByDecade(lib, null)).toBe(lib);
  });
});
