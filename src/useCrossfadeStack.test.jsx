import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useCrossfadeStack from './useCrossfadeStack.js';

const key = (c) => c;
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] }));
afterEach(() => vi.useRealTimers());
const frames = (n = 3) => act(() => { vi.advanceTimersByTime(16 * n); });

describe('useCrossfadeStack', () => {
  it('starts with the first value already shown (no fade at startup)', () => {
    const { result } = renderHook(({ v }) => useCrossfadeStack(v, key), { initialProps: { v: 'red' } });
    expect(result.current.map((l) => [l.value, l.shown])).toEqual([['red', true]]);
  });

  it('a new value gets its own layer: added hidden, shown a frame later, the old one fades and is removed', () => {
    const { result, rerender } = renderHook(({ v }) => useCrossfadeStack(v, key, { fadeMs: 1000 }), { initialProps: { v: 'red' } });
    rerender({ v: 'blue' });
    expect(result.current.map((l) => [l.value, l.shown])).toEqual([['red', false], ['blue', false]]);
    frames();
    expect(result.current.map((l) => [l.value, l.shown])).toEqual([['red', false], ['blue', true]]);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(result.current.map((l) => [l.value, l.shown])).toEqual([['blue', true]]);
  });

  it('never holds more than `max` layers when values change quickly', () => {
    const { result, rerender } = renderHook(({ v }) => useCrossfadeStack(v, key, { max: 3 }), { initialProps: { v: 'a' } });
    for (const v of ['b', 'c', 'd', 'e']) { rerender({ v }); frames(1); }
    expect(result.current.length).toBeLessThanOrEqual(3);
    frames();
    expect(result.current[result.current.length - 1]).toMatchObject({ value: 'e', shown: true });
  });

  it('the same key again does nothing', () => {
    const { result, rerender } = renderHook(({ v }) => useCrossfadeStack(v, key), { initialProps: { v: 'red' } });
    const before = result.current;
    rerender({ v: 'red' });
    expect(result.current).toBe(before);
  });

  it('going to no value fades everything out, then empties', () => {
    const { result, rerender } = renderHook(({ v }) => useCrossfadeStack(v, key, { fadeMs: 500 }), { initialProps: { v: 'red' } });
    rerender({ v: null });
    expect(result.current.map((l) => l.shown)).toEqual([false]);
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current).toEqual([]);
  });

  it('the same value coming back while it fades out gets a fresh layer that fades in again', () => {
    const { result, rerender } = renderHook(({ v }) => useCrossfadeStack(v, key), { initialProps: { v: 'red' } });
    rerender({ v: null });
    rerender({ v: 'red' });
    frames();
    const cur = result.current[result.current.length - 1];
    expect(cur).toMatchObject({ value: 'red', shown: true, gone: false });
  });

  it('a value arriving after none fades in', () => {
    const { result, rerender } = renderHook(({ v }) => useCrossfadeStack(v, key), { initialProps: { v: null } });
    expect(result.current).toEqual([]);
    rerender({ v: 'red' });
    expect(result.current.map((l) => [l.value, l.shown])).toEqual([['red', false]]);
    frames();
    expect(result.current.map((l) => [l.value, l.shown])).toEqual([['red', true]]);
  });
});
