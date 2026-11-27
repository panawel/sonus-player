import { describe, it, expect } from 'vitest';
import { paletteFromPixels, rgbToHsl, FALLBACK_PALETTE, PALETTE_LIGHTNESS, PALETTE_SIZE } from './coverPalette.js';

// RGBA bytes for a sample made of the given colours, each `n` pixels
const sample = (...parts) => {
  const out = [];
  for (const [rgb, n] of parts) for (let i = 0; i < n; i++) out.push(...rgb, 255);
  return new Uint8ClampedArray(out);
};
const hueDist = (a, b) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

describe('coverPalette', () => {
  it('always gives four colours, never black and never too light for white text', () => {
    for (const data of [
      sample([[0, 0, 0], 1024]),
      sample([[255, 255, 255], 1024]),
      sample([[200, 30, 40], 300], [[20, 40, 90], 700], [[5, 5, 5], 24]),
    ]) {
      const p = paletteFromPixels(data);
      expect(p).toHaveLength(PALETTE_SIZE);
      for (const c of p) {
        const [, , l] = rgbToHsl(c);
        expect(l).toBeGreaterThanOrEqual(PALETTE_LIGHTNESS.min - 0.01);
        expect(l).toBeLessThanOrEqual(PALETTE_LIGHTNESS.max + 0.01);
      }
    }
  });

  it('a small colourful accent on a mostly black cover still leads the palette', () => {
    const p = paletteFromPixels(sample([[4, 4, 6], 900], [[190, 20, 30], 124]));
    const [h, s] = rgbToHsl(p[0]);
    expect(s).toBeGreaterThan(0.5);
    expect(hueDist(h, 0)).toBeLessThan(0.05); // red
  });

  it('keeps clearly different colours instead of several near-copies of one', () => {
    const p = paletteFromPixels(sample([[30, 50, 110], 300], [[28, 48, 104], 300], [[32, 54, 116], 200], [[210, 30, 40], 224]));
    const hues = p.map((c) => rgbToHsl(c)[0]);
    expect(hues.some((h) => hueDist(h, 0) < 0.05)).toBe(true);   // the red survives
    expect(hues.some((h) => hueDist(h, 0.62) < 0.06)).toBe(true); // and the navy
  });

  it('falls back to the app\'s own colours with no usable pixels', () => {
    expect(paletteFromPixels(new Uint8ClampedArray(0))).toEqual(FALLBACK_PALETTE);
  });
});

describe('palette cache', () => {
  it('gives back the same palette object, and forgets the least recently used past its size', async () => {
    const { createPaletteCache } = await import('./coverPalette.js');
    const c = createPaletteCache(2);
    const a = [[1, 2, 3]], b = [[4, 5, 6]], d = [[7, 8, 9]];
    c.set('a', a); c.set('b', b);
    expect(c.get('a')).toBe(a);      // 'a' is now the most recent
    c.set('d', d);                    // so 'b' goes
    expect(c.has('b')).toBe(false);
    expect(c.get('a')).toBe(a);
    expect(c.get('d')).toBe(d);
    expect(c.size).toBe(2);
  });
});
