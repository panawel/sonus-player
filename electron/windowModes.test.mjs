import { describe, it, expect } from 'vitest';
import { modeBounds, NARROW_WIDTH, NARROW_HEIGHT, MINI_WIDTH, MINI_HEIGHT } from './windowModes.mjs';

const wa = { x: 0, y: 25, width: 1440, height: 875 };
const min = [380, 180];

describe('modeBounds', () => {
  it('filled covers the display work area exactly', () => {
    expect(modeBounds('filled', { x: 300, y: 200, width: 900, height: 700 }, wa, min)).toEqual(wa);
  });

  it('filled follows a work area that does not start at the origin (second display)', () => {
    const second = { x: 1440, y: 0, width: 1920, height: 1055 };
    expect(modeBounds('filled', { x: 1500, y: 100, width: 900, height: 700 }, second, min)).toEqual(second);
  });

  it('narrow is one fixed size, whatever the window was before', () => {
    const fromFilled = modeBounds('narrow', { x: 0, y: 25, width: 1440, height: 875 }, wa, min);
    const fromMini = modeBounds('narrow', { x: 0, y: 25, width: 380, height: 200 }, wa, min);
    const fromTall = modeBounds('narrow', { x: 100, y: 40, width: 1200, height: 820 }, wa, min);
    for (const b of [fromFilled, fromMini, fromTall]) {
      expect(b.width).toBe(NARROW_WIDTH);
      expect(b.height).toBe(NARROW_HEIGHT);
    }
  });

  it('narrow never exceeds the display height', () => {
    const small = { x: 0, y: 0, width: 1280, height: 700 };
    expect(modeBounds('narrow', { x: 0, y: 0, width: 1000, height: 650 }, small, min).height).toBe(700);
  });

  it('mini is the fixed small card', () => {
    const b = modeBounds('mini', { x: 100, y: 100, width: 1200, height: 800 }, wa, min);
    expect(b).toMatchObject({ width: MINI_WIDTH, height: MINI_HEIGHT });
  });

  it('keeps the window on its display: a window hanging off the bottom-right is pulled back in', () => {
    const b = modeBounds('mini', { x: 1400, y: 880, width: 1000, height: 700 }, wa, min);
    expect(b.x + b.width).toBeLessThanOrEqual(wa.x + wa.width);
    expect(b.y + b.height).toBeLessThanOrEqual(wa.y + wa.height);
    expect(b.x).toBeGreaterThanOrEqual(wa.x);
    expect(b.y).toBeGreaterThanOrEqual(wa.y);
  });

  it('respects the window minimum size', () => {
    expect(modeBounds('mini', { x: 0, y: 0, width: 800, height: 600 }, wa, [380, 260]).height).toBe(260);
  });

  it('rejects an unknown mode', () => {
    expect(() => modeBounds('huge', { x: 0, y: 0, width: 1, height: 1 }, wa)).toThrow(/unknown window mode/);
  });
});
