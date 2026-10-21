import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pointInBounds, createPointerTracker } from './pointerTracker.mjs';

const bounds = { x: 100, y: 50, width: 400, height: 200 };

describe('pointInBounds', () => {
  it('is inclusive of the top-left edge and exclusive of the bottom-right', () => {
    expect(pointInBounds({ x: 100, y: 50 }, bounds)).toBe(true);
    expect(pointInBounds({ x: 499, y: 249 }, bounds)).toBe(true);
    expect(pointInBounds({ x: 500, y: 100 }, bounds)).toBe(false);
    expect(pointInBounds({ x: 200, y: 250 }, bounds)).toBe(false);
    expect(pointInBounds({ x: 99, y: 100 }, bounds)).toBe(false);
  });
});

describe('createPointerTracker', () => {
  let cursor, calls, tracker;
  beforeEach(() => {
    vi.useFakeTimers();
    cursor = { x: 0, y: 0 };
    calls = [];
    tracker = createPointerTracker({
      getCursor: () => cursor,
      getBounds: () => bounds,
      onChange: (v) => calls.push(v),
      intervalMs: 100,
      hideDelayMs: 500,
    });
  });
  afterEach(() => { tracker.stop(); vi.useRealTimers(); });

  it('reports the starting state immediately when the pointer is outside', () => {
    tracker.start();
    expect(calls).toEqual([false]);
  });

  it('reports the starting state immediately when the pointer is already inside', () => {
    cursor = { x: 200, y: 100 };
    tracker.start();
    expect(calls).toEqual([true]);
  });

  it('reports entering on the next tick, with no delay', () => {
    tracker.start();
    cursor = { x: 200, y: 100 };
    vi.advanceTimersByTime(100);
    expect(calls).toEqual([false, true]);
  });

  it('keeps reporting "inside" through a brief exit, and hides only after the delay', () => {
    cursor = { x: 200, y: 100 };
    tracker.start();
    cursor = { x: 0, y: 0 };
    vi.advanceTimersByTime(400);
    expect(calls).toEqual([true]);
    expect(tracker.isInside()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(calls).toEqual([true, false]);
    expect(tracker.isInside()).toBe(false);
  });

  it('a pointer that returns before the delay cancels the pending hide', () => {
    cursor = { x: 200, y: 100 };
    tracker.start();
    cursor = { x: 0, y: 0 };
    vi.advanceTimersByTime(300);
    cursor = { x: 300, y: 120 };
    vi.advanceTimersByTime(100);
    cursor = { x: 0, y: 0 };
    vi.advanceTimersByTime(400);
    expect(calls).toEqual([true]);
    vi.advanceTimersByTime(200);
    expect(calls).toEqual([true, false]);
  });

  it('does not repeat a state it already reported', () => {
    cursor = { x: 200, y: 100 };
    tracker.start();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([true]);
  });

  it('stop() ends polling and reports nothing further', () => {
    tracker.start();
    tracker.stop();
    cursor = { x: 200, y: 100 };
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([false]);
  });

  it('can be restarted after stopping, re-reporting the starting state', () => {
    cursor = { x: 200, y: 100 };
    tracker.start();
    tracker.stop();
    tracker.start();
    expect(calls).toEqual([true, true]);
  });

  it('follows the window when its bounds change', () => {
    let b = { ...bounds };
    const t = createPointerTracker({ getCursor: () => cursor, getBounds: () => b, onChange: (v) => calls.push(v), intervalMs: 100, hideDelayMs: 0 });
    cursor = { x: 600, y: 100 };
    t.start();
    expect(calls).toEqual([false]);
    b = { x: 550, y: 50, width: 400, height: 200 };
    vi.advanceTimersByTime(100);
    expect(calls).toEqual([false, true]);
    t.stop();
  });
});
