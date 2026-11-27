// Fixed window sizes behind File > Filled Screen / Narrow / Mini Mode. Pure
// geometry, so it is unit-tested without Electron.
//
// "Narrow" and "mini" are not states anywhere in the app: the renderer derives
// them from the window's size (under NARROW_LAYOUT_BREAKPOINT wide, at or under
// MINI_LAYOUT_HEIGHT_BREAKPOINT tall — src/trackUtils.js). A menu item
// therefore only has to resize the window, and the shell restructures itself
// exactly as it does when the user drags an edge. The sizes below sit well
// inside those breakpoints (440 < 560, 200 <= 420).

export const NARROW_WIDTH = 440;
// Narrow Now Playing and the Library need roughly this much height to fit
// without cutting anything off (same figure as the mini player's expand).
// A fixed size, deliberately NOT "at least": keeping a taller window's height
// made Narrow Mode land on a different size from Filled Screen than from Mini.
export const NARROW_HEIGHT = 760;
export const MINI_WIDTH = 380;
export const MINI_HEIGHT = 200;

export const WINDOW_MODES = ['filled', 'narrow', 'mini'];

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// cur: the window's current bounds. workArea: its display's usable area (menu
// bar and Dock excluded). minSize: [minWidth, minHeight] of the window.
// Returns the bounds to apply. The top-left corner is kept and nudged only as
// far as needed to stay on the display, so the window doesn't jump around.
export function modeBounds(mode, cur, workArea, minSize = [0, 0]) {
  if (!WINDOW_MODES.includes(mode)) throw new Error(`unknown window mode: ${mode}`);
  if (mode === 'filled') {
    return { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };
  }

  let width;
  let height;
  if (mode === 'narrow') {
    width = NARROW_WIDTH;
    height = NARROW_HEIGHT;
  } else {
    width = MINI_WIDTH;
    height = MINI_HEIGHT;
  }
  width = clamp(width, minSize[0], workArea.width);
  height = clamp(height, minSize[1], workArea.height);

  return {
    x: clamp(cur.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(cur.y, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  };
}

// ── Strip mode: an ultra-slim player, at home beside the macOS Dock ──
// The strip is its own small window (main.js); this is only where it goes.
//
// The Dock's band is the strip of screen below the display's usable area: macOS reserves it
// across the full width when the Dock sits at the bottom and doesn't auto-hide, and its height
// follows the Dock's size. In the band the window takes the band's full height with the capsule
// centred in it. The Dock's WIDTH is not knowable here (no Electron API; reading the Dock itself
// needs Accessibility permission), so the strip starts at the band's right end. Where there is
// no band (auto-hide, a small Dock, the Dock on a side) it starts in the bottom-right corner of
// the usable area instead.
//
// After that the user drags it anywhere, like any window, and it is remembered per display. Let
// go near the band and it snaps into it (STRIP_SNAP), so nobody has to aim pixel by pixel.
export const STRIP_CAPSULE_WIDTH = 340;
export const STRIP_CAPSULE_MAX_HEIGHT = 40;
export const STRIP_CAPSULE_MIN_HEIGHT = 32;
export const STRIP_PAD_X = 8;          // window margin left/right of the capsule (its shadow)
export const STRIP_EDGE_GAP = 10;      // the default spot's distance from the screen's edge
export const STRIP_FREE_HEIGHT = 52;   // window height anywhere outside the Dock band
export const STRIP_MIN_BAND = 30;      // a band shorter than this is not a Dock band
export const STRIP_SNAP = 28;          // dropped with its middle this close above the band: snaps in

export function stripBand(display) {
  const b = display.bounds;
  const wa = display.workArea;
  const below = (b.y + b.height) - (wa.y + wa.height);
  return below >= STRIP_MIN_BAND ? { y: wa.y + wa.height, height: below } : null;
}

export function stripWindowWidth() {
  return STRIP_CAPSULE_WIDTH + 2 * STRIP_PAD_X;
}

// Anywhere on the display, whole, and never under the menu bar.
export function clampStripPosition(display, x, y, height = STRIP_FREE_HEIGHT) {
  const b = display.bounds;
  const w = stripWindowWidth();
  const top = display.workArea.y;
  return {
    x: clamp(Math.round(x), b.x, Math.max(b.x, b.x + b.width - w)),
    y: clamp(Math.round(y), top, Math.max(top, b.y + b.height - height)),
  };
}

function inBandBounds(display, band, x) {
  return { x: clampStripPosition(display, x, band.y, band.height).x, y: band.y, width: stripWindowWidth(), height: band.height };
}
function freeBounds(display, x, y) {
  return { ...clampStripPosition(display, x, y), width: stripWindowWidth(), height: STRIP_FREE_HEIGHT };
}
function defaultBounds(display) {
  const b = display.bounds;
  const x = b.x + b.width - stripWindowWidth() - STRIP_EDGE_GAP;
  const band = stripBand(display);
  if (band) return inBandBounds(display, band, x);
  const wa = display.workArea;
  return freeBounds(display, x, wa.y + wa.height - STRIP_FREE_HEIGHT - STRIP_EDGE_GAP);
}

// saved: { x, y, inBand } — where the user last left it on this display — or null.
export function stripBounds(display, saved = null) {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return defaultBounds(display);
  if (saved.inBand) {
    const band = stripBand(display);
    // The band has gone (the Dock moved or hides now): the default spot, at the same x.
    if (!band) return { ...defaultBounds(display), x: clampStripPosition(display, saved.x, 0).x };
    return inBandBounds(display, band, saved.x);
  }
  return freeBounds(display, saved.x, saved.y);
}

// Where a dragged strip settles when it's let go, and what to remember.
export function stripDropBounds(display, bounds) {
  const band = stripBand(display);
  const middle = bounds.y + bounds.height / 2;
  if (band && middle >= band.y - STRIP_SNAP) {
    const b = inBandBounds(display, band, bounds.x);
    return { bounds: b, saved: { x: b.x, y: b.y, inBand: true } };
  }
  const b = freeBounds(display, bounds.x, Math.round(middle - STRIP_FREE_HEIGHT / 2));
  return { bounds: b, saved: { x: b.x, y: b.y, inBand: false } };
}

// Shrinking the mini player below its minimum (MINI_MIN_HEIGHT, 180: its content needs it) turns
// it into the strip, right where the window was: the window may now be made as short as
// STRIP_RESIZE_MIN_HEIGHT, and below MINI_MIN_HEIGHT the renderer previews the strip in place
// (trackUtils.js has the same 180) and main.js switches when the resize ends.
export const MINI_MIN_HEIGHT = 180;
export const STRIP_RESIZE_MIN_HEIGHT = 120;

// The strip centred where a window was (then kept on screen, snapping into the band when near it).
export function stripBoundsAt(display, windowBounds) {
  const w = stripWindowWidth();
  return stripDropBounds(display, {
    x: Math.round(windowBounds.x + (windowBounds.width - w) / 2),
    y: Math.round(windowBounds.y + windowBounds.height / 2 - STRIP_FREE_HEIGHT / 2),
    width: w,
    height: STRIP_FREE_HEIGHT,
  });
}

// The capsule's height inside a strip window of the given height.
export function stripCapsuleHeight(windowHeight) {
  return clamp(windowHeight - 10, STRIP_CAPSULE_MIN_HEIGHT, STRIP_CAPSULE_MAX_HEIGHT);
}
