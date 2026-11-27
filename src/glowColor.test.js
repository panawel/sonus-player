import { describe, it, expect } from 'vitest';
import { glowRgb, GLOW_DEFAULT, GLOW_MIN_LIGHTNESS } from './glowColor.js';

const parse = (s) => s.split(',').map((n) => Number(n.trim()));
const lightness = ([r, g, b]) => (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;

describe('glowRgb', () => {
  it('is a soft white with no artwork', () => {
    expect(glowRgb(null)).toBe(GLOW_DEFAULT);
    expect(glowRgb({ r: NaN, g: 0, b: 0 })).toBe(GLOW_DEFAULT);
  });

  it('a grey cover glows white (there is no hue to lift)', () => {
    expect(glowRgb({ r: 40, g: 40, b: 42 })).toBe(GLOW_DEFAULT);
  });

  it('lifts a dark cover until it can glow, keeping its hue', () => {
    const [r, g, b] = parse(glowRgb({ r: 60, g: 10, b: 30 })); // a dark wine red
    expect(lightness([r, g, b])).toBeGreaterThanOrEqual(GLOW_MIN_LIGHTNESS - 0.01);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it('leaves a bright, colourful cover as it is', () => {
    expect(glowRgb({ r: 236, g: 96, b: 170 })).toBe('236, 96, 170');
  });

  it('always returns three numbers in 0-255', () => {
    for (const c of [{ r: 0, g: 0, b: 255 }, { r: 255, g: 255, b: 0 }, { r: 3, g: 80, b: 2 }]) {
      const v = parse(glowRgb(c));
      expect(v).toHaveLength(3);
      for (const n of v) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(255); }
    }
  });
});
