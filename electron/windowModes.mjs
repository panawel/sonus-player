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
