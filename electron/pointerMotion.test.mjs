import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMotionTracker } from './pointerMotion.mjs';

const bounds = { x: 100, y: 50, width: 400, height: 200 };

describe('createMotionTracker', () => {
  let cursor, moves, tracker;
  beforeEach(() => {
    vi.useFakeTimers();
    cursor = { x: 200, y: 100 };
    moves = 0;
    tracker = createMotionTracker({ getCursor: () => cursor, getBounds: () => bounds, onMove: () => { moves++; }, intervalMs: 100 });
  });
  afterEach(() => { tracker.stop(); vi.useRealTimers(); });

  it('stays quiet while the cursor is still', () => {
    tracker.start();
    vi.advanceTimersByTime(1000);
    expect(moves).toBe(0);
  });

  it('reports a tick in which the cursor moved inside the window', () => {
    tracker.start();
    cursor = { x: 210, y: 100 };
    vi.advanceTimersByTime(100);
    expect(moves).toBe(1);
    vi.advanceTimersByTime(300); // still again
    expect(moves).toBe(1);
  });

  it('reports each moving tick, once per tick however far it moved', () => {
    tracker.start();
    cursor = { x: 220, y: 110 }; vi.advanceTimersByTime(100);
    cursor = { x: 300, y: 150 }; vi.advanceTimersByTime(100);
    expect(moves).toBe(2);
  });

  it('ignores movement outside the window, and the move that leaves it', () => {
    tracker.start();
    cursor = { x: 900, y: 900 }; vi.advanceTimersByTime(100);
    cursor = { x: 950, y: 900 }; vi.advanceTimersByTime(100);
    expect(moves).toBe(0);
  });

  it('reports the move that enters the window', () => {
    cursor = { x: 900, y: 900 };
    tracker.start();
    cursor = { x: 200, y: 100 }; vi.advanceTimersByTime(100);
    expect(moves).toBe(1);
  });

  it('does not count the starting position as movement, and stop() ends the polling', () => {
    tracker.start();
    vi.advanceTimersByTime(100);
    expect(moves).toBe(0);
    tracker.stop();
    cursor = { x: 300, y: 100 };
    vi.advanceTimersByTime(500);
    expect(moves).toBe(0);
  });

  it('start() twice does not double the polling', () => {
    tracker.start(); tracker.start();
    cursor = { x: 250, y: 100 };
    vi.advanceTimersByTime(100);
    expect(moves).toBe(1);
  });
});
