// Is the mouse pointer over a window? Answered from OUTSIDE the page, by
// comparing the OS cursor position with the window's bounds on a timer.
//
// Why not just listen for mouse events in the renderer: the mini player's card
// is a `-webkit-app-region: drag` area (so it can be dragged anywhere), and
// Electron gives those areas to the OS — the page never sees the pointer over
// them, only over the no-drag controls. Polling from the main process has no
// such blind spot, and also works while the window isn't focused.
//
// Electron-free on purpose (cursor, bounds, clock and timers are all injected)
// so it is unit-tested directly — see pointerTracker.test.mjs.
//
// Entering is reported on the next tick; leaving only after the pointer has
// stayed out for hideDelayMs, so grazing the window's edge doesn't flicker.

export function pointInBounds(p, b) {
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

export function createPointerTracker({
  getCursor, getBounds, onChange,
  intervalMs = 100, hideDelayMs = 500,
  now = Date.now, setIntervalFn = setInterval, clearIntervalFn = clearInterval,
}) {
  let timer = null;
  let inside = false;
  let outSince = null;

  const sample = () => pointInBounds(getCursor(), getBounds());

  const tick = () => {
    if (sample()) {
      outSince = null;
      if (!inside) { inside = true; onChange(true); }
      return;
    }
    if (!inside) return;
    if (outSince === null) outSince = now();
    if (now() - outSince >= hideDelayMs) {
      inside = false;
      outSince = null;
      onChange(false);
    }
  };

  return {
    // Reports the starting state immediately (no hide delay on the way in), so
    // whoever is listening never has to guess the initial value.
    start() {
      if (timer !== null) return;
      inside = sample();
      outSince = null;
      onChange(inside);
      timer = setIntervalFn(tick, intervalMs);
    },
    // Does not report: whoever stops tracking decides what state to leave things in.
    stop() {
      if (timer !== null) clearIntervalFn(timer);
      timer = null;
      inside = false;
      outSince = null;
    },
    isInside: () => inside,
  };
}
