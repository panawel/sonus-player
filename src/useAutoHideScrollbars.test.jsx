import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useAutoHideScrollbars, { SCROLLBAR_IDLE_MS } from './useAutoHideScrollbars.js';

let el;
beforeEach(() => { vi.useFakeTimers(); el = document.createElement('div'); document.body.appendChild(el); });
afterEach(() => { el.remove(); vi.useRealTimers(); });
const scroll = () => el.dispatchEvent(new Event('scroll')); // does not bubble, like a real scroll event

describe('useAutoHideScrollbars', () => {
  it('shows the bar while scrolling and hides it after the idle time', () => {
    renderHook(() => useAutoHideScrollbars(true));
    scroll();
    expect(el.classList.contains('sb-scrolling')).toBe(true);
    act(() => { vi.advanceTimersByTime(SCROLLBAR_IDLE_MS + 1); });
    expect(el.classList.contains('sb-scrolling')).toBe(false);
    expect(el.classList.contains('sb-fade')).toBe(true); // stays, so the fade-out transition runs
  });

  it('each scroll restarts the idle time', () => {
    renderHook(() => useAutoHideScrollbars(true));
    scroll();
    act(() => { vi.advanceTimersByTime(SCROLLBAR_IDLE_MS - 100); });
    scroll();
    act(() => { vi.advanceTimersByTime(SCROLLBAR_IDLE_MS - 100); });
    expect(el.classList.contains('sb-scrolling')).toBe(true);
  });

  it('does nothing when disabled, and cleans up when it stops being enabled', () => {
    const { rerender } = renderHook(({ on }) => useAutoHideScrollbars(on), { initialProps: { on: false } });
    scroll();
    expect(el.classList.contains('sb-scrolling')).toBe(false);
    rerender({ on: true });
    scroll();
    rerender({ on: false });
    expect(el.classList.contains('sb-scrolling')).toBe(false);
  });
});
