// Has the mouse pointer MOVED over a window? Same reason as pointerTracker.mjs
// for being answered from the main process: parts of the window are
// `-webkit-app-region: drag` areas (the title strip, the mini player's card),
// Electron gives those to the OS, and the page never receives mouse events over
// them. Chill mode hides its chrome after a quiet spell and has to bring it back
// when the pointer moves — including over exactly those areas — so it polls the
// OS cursor position instead.
//
// Reports once per tick in which the cursor changed position AND ended up inside
// the window; movement elsewhere on the desktop is none of the window's business.
// Electron-free (cursor, bounds and timers are injected) so it is unit-tested
// directly — see pointerMotion.test.mjs.
import { pointInBounds } from './pointerTracker.mjs';

export function createMotionTracker({
  getCursor, getBounds, onMove,
  intervalMs = 100,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval,
}) {
  let timer = null;
  let last = null;

  const tick = () => {
    const c = getCursor();
    const moved = last !== null && (c.x !== last.x || c.y !== last.y);
    last = { x: c.x, y: c.y };
    if (moved && pointInBounds(c, getBounds())) onMove();
  };

  return {
    start() {
      if (timer !== null) return;
      const c = getCursor();
      last = { x: c.x, y: c.y };
      timer = setIntervalFn(tick, intervalMs);
    },
    stop() {
      if (timer !== null) clearIntervalFn(timer);
      timer = null;
      last = null;
    },
  };
}
