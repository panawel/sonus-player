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

import { stripBand, stripBounds, stripDropBounds, stripBoundsAt, clampStripPosition, stripCapsuleHeight, stripWindowWidth, STRIP_FREE_HEIGHT, STRIP_EDGE_GAP, STRIP_SNAP } from './windowModes.mjs';

// This Mac: 1728x1117, the usable area ends at 1066 (a 51px Dock band below it).
const dockBottom = { bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 33, width: 1728, height: 1033 } };
const bigDock = { bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 33, width: 1728, height: 993 } };
const tinyDock = { bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 33, width: 1728, height: 1060 } };
const autoHide = { bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 33, width: 1728, height: 1084 } };
const dockLeft = { bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 70, y: 33, width: 1658, height: 1084 } };
const second = { bounds: { x: 1728, y: -200, width: 2560, height: 1440 }, workArea: { x: 1728, y: -175, width: 2560, height: 1340 } };
const W = stripWindowWidth();

describe('strip mode geometry', () => {
  it('finds the Dock band below the usable area, as tall as the Dock', () => {
    expect(stripBand(dockBottom)).toEqual({ y: 1066, height: 51 });
    expect(stripBand(bigDock)).toEqual({ y: 1026, height: 91 });
  });

  it('sees no band when the Dock auto-hides, is tiny, or sits on a side', () => {
    expect(stripBand(autoHide)).toBeNull();
    expect(stripBand(tinyDock)).toBeNull();
    expect(stripBand(dockLeft)).toBeNull();
  });

  it('starts at the right end of the band, filling its height', () => {
    expect(stripBounds(dockBottom)).toEqual({ x: 1728 - W - STRIP_EDGE_GAP, y: 1066, width: W, height: 51 });
    expect(stripBounds(bigDock)).toEqual({ x: 1728 - W - STRIP_EDGE_GAP, y: 1026, width: W, height: 91 });
  });

  it('starts in the bottom-right corner of the usable area when there is no band', () => {
    for (const d of [autoHide, tinyDock, dockLeft]) {
      const b = stripBounds(d);
      expect(b.height).toBe(STRIP_FREE_HEIGHT);
      expect(b.x).toBe(1728 - W - STRIP_EDGE_GAP);
      expect(b.y + b.height).toBe(d.workArea.y + d.workArea.height - STRIP_EDGE_GAP);
    }
  });

  it('goes back where the user left it, in the band or anywhere else', () => {
    expect(stripBounds(dockBottom, { x: 200, y: 1066, inBand: true })).toEqual({ x: 200, y: 1066, width: W, height: 51 });
    expect(stripBounds(dockBottom, { x: 300, y: 400, inBand: false })).toEqual({ x: 300, y: 400, width: W, height: STRIP_FREE_HEIGHT });
  });

  it('a remembered spot is kept whole on the display and below the menu bar', () => {
    expect(stripBounds(dockBottom, { x: -50, y: -20, inBand: false })).toMatchObject({ x: 0, y: 33 });
    expect(stripBounds(dockBottom, { x: 99999, y: 99999, inBand: false })).toMatchObject({ x: 1728 - W, y: 1117 - STRIP_FREE_HEIGHT });
  });

  it('a band spot whose band has gone falls back to the corner, keeping its x', () => {
    const b = stripBounds(autoHide, { x: 200, y: 1066, inBand: true });
    expect(b).toEqual({ x: 200, y: 1117 - STRIP_EDGE_GAP - STRIP_FREE_HEIGHT, width: W, height: STRIP_FREE_HEIGHT });
  });

  it('ignores a malformed remembered spot', () => {
    expect(stripBounds(dockBottom, 200)).toEqual(stripBounds(dockBottom));
    expect(stripBounds(dockBottom, { x: 'a' })).toEqual(stripBounds(dockBottom));
  });

  it('let go near the band, it snaps in; further up, it stays where it was dropped', () => {
    const near = stripDropBounds(dockBottom, { x: 500, y: 1066 - STRIP_SNAP - 20, width: W, height: STRIP_FREE_HEIGHT });
    expect(near.bounds).toEqual({ x: 500, y: 1066, width: W, height: 51 });
    expect(near.saved).toEqual({ x: 500, y: 1066, inBand: true });
    const far = stripDropBounds(dockBottom, { x: 500, y: 600, width: W, height: 51 });
    expect(far.bounds).toEqual({ x: 500, y: 600, width: W, height: STRIP_FREE_HEIGHT }); // same middle, free height
    expect(far.saved).toEqual({ x: 500, y: 600, inBand: false });
  });

  it('with no band, a drop at the bottom just stays on screen', () => {
    const d = stripDropBounds(autoHide, { x: 500, y: 1100, width: W, height: STRIP_FREE_HEIGHT });
    expect(d.bounds).toEqual({ x: 500, y: 1117 - STRIP_FREE_HEIGHT, width: W, height: STRIP_FREE_HEIGHT });
  });

  it('shrinking a window into the strip puts it where the window was', () => {
    const at = stripBoundsAt(dockBottom, { x: 400, y: 300, width: 380, height: 150 });
    expect(at.bounds).toEqual({ x: 400 + Math.round((380 - W) / 2), y: 375 - STRIP_FREE_HEIGHT / 2, width: W, height: STRIP_FREE_HEIGHT });
    expect(at.saved.inBand).toBe(false);
    // a window shrunk right above the Dock snaps into the band
    expect(stripBoundsAt(dockBottom, { x: 400, y: 1000, width: 380, height: 120 }).bounds).toMatchObject({ y: 1066, height: 51 });
  });

  it('works on a second display with its own origin', () => {
    expect(stripBand(second)).toEqual({ y: 1165, height: 75 });
    expect(stripBounds(second).x).toBe(1728 + 2560 - W - STRIP_EDGE_GAP);
    expect(clampStripPosition(second, 0, -500)).toEqual({ x: 1728, y: -175 });
  });

  it('keeps the capsule between its minimum and maximum height', () => {
    expect(stripCapsuleHeight(51)).toBe(40);
    expect(stripCapsuleHeight(91)).toBe(40);
    expect(stripCapsuleHeight(38)).toBe(32);
  });
});
