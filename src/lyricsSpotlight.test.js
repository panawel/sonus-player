import { describe, it, expect } from 'vitest';
import { toVerses, spotFor, bandAt, SPOT_LIT, SPOT_NEAR } from './lyricsSpotlight.js';

describe('toVerses', () => {
  it('splits on blank lines, whatever the line endings', () => {
    expect(toVerses('a\r\nb\r\n\r\nc\nd\n\n\ne')).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });
  it('drops LRC timestamps and tag lines, keeping the words', () => {
    expect(toVerses('[ar:Someone]\n[00:12.34]first line\n[00:15.00] second   line')).toEqual([['first line', 'second line']]);
  });
  it('gives nothing for no lyrics', () => {
    expect(toVerses('')).toEqual([]);
    expect(toVerses(null)).toEqual([]);
    expect(toVerses('\n \n')).toEqual([]);
  });
});

describe('spotFor', () => {
  it('lights the lines around the reading band, half-lights the next ones, dims the rest', () => {
    expect(spotFor(0)).toBe('lit');
    expect(spotFor(-(SPOT_LIT - 0.1))).toBe('lit');
    expect(spotFor(SPOT_LIT + 0.1)).toBe('near');
    expect(spotFor(SPOT_NEAR + 0.1)).toBe('dim');
  });
});

describe('bandAt', () => {
  const view = { max: 1000, height: 500, first: 60, last: 1400 }; // band place: 210
  it('starts on the first line, glides down to its place, and stays there', () => {
    expect(bandAt({ ...view, top: 0 })).toBe(60);
    expect(bandAt({ ...view, top: 75 })).toBeCloseTo(135);
    expect(bandAt({ ...view, top: 150 })).toBe(210);
    expect(bandAt({ ...view, top: 500 })).toBe(210);
  });
  it('glides on to the last line at the end', () => {
    expect(bandAt({ ...view, top: 1000 })).toBe(400); // last line's centre in the view at the end
    expect(bandAt({ ...view, top: 905 })).toBeCloseTo(305);
  });
  it('gives no band when everything fits', () => {
    expect(bandAt({ ...view, max: 0, top: 0 })).toBe(null);
  });
});
