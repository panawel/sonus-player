import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useChillChrome, { CHILL_IDLE_MS, CHILL_LIGHTS_DELAY_MS } from './useChillChrome.js';

describe('useChillChrome', () => {
  let api, movedCb, unsubscribed;
  beforeEach(() => {
    vi.useFakeTimers();
    movedCb = null; unsubscribed = false;
    api = {
      setChillChromeTracking: vi.fn(),
      onPointerMoved: vi.fn((cb) => { movedCb = cb; return () => { unsubscribed = true; }; }),
      setWindowButtonsVisible: vi.fn(),
    };
    window.electronAPI = api;
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete window.electronAPI; document.body.innerHTML = ''; });

  const mount = (props = {}) => renderHook((p) => useChillChrome(p), { initialProps: { active: true, playing: true, hold: false, ...props } });
  const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

  it('is visible at first, and hides after a quiet spell while playing', () => {
    const { result } = mount();
    expect(result.current.visible).toBe(true);
    advance(CHILL_IDLE_MS - 100);
    expect(result.current.visible).toBe(true);
    advance(200);
    expect(result.current.visible).toBe(false);
  });

  it('is always visible while inactive (nothing to hide) or paused', () => {
    expect(mount({ active: false }).result.current.visible).toBe(true);
    const { result, rerender } = mount();
    advance(CHILL_IDLE_MS + 100);
    expect(result.current.visible).toBe(false);
    rerender({ active: true, playing: false, hold: false });
    expect(result.current.visible).toBe(true);
    advance(CHILL_IDLE_MS * 3);
    expect(result.current.visible).toBe(true); // paused stays up
    rerender({ active: true, playing: true, hold: false });
    advance(CHILL_IDLE_MS + 100);
    expect(result.current.visible).toBe(false); // resuming restarts the quiet clock
  });

  it('is held up while something is open over it (search panel, menu, dialog, picker)', () => {
    const { result, rerender } = mount();
    rerender({ active: true, playing: true, hold: true });
    advance(CHILL_IDLE_MS * 3);
    expect(result.current.visible).toBe(true);
    rerender({ active: true, playing: true, hold: false });
    advance(CHILL_IDLE_MS + 100);
    expect(result.current.visible).toBe(false);
  });

  it('wakes on mouse move, press, key and wheel, and restarts the quiet clock', () => {
    for (const make of [() => new MouseEvent('mousemove'), () => new MouseEvent('mousedown'), () => new KeyboardEvent('keydown', { key: 'a' }), () => new WheelEvent('wheel')]) {
      const { result, unmount } = mount();
      advance(CHILL_IDLE_MS + 100);
      expect(result.current.visible).toBe(false);
      act(() => { window.dispatchEvent(make()); });
      expect(result.current.visible).toBe(true);
      advance(CHILL_IDLE_MS - 200);
      expect(result.current.visible).toBe(true);
      advance(400);
      expect(result.current.visible).toBe(false);
      unmount();
    }
  });

  it('wakes on cursor movement reported by the main process (the title strip is a drag area the page never sees)', () => {
    const { result } = mount();
    advance(CHILL_IDLE_MS + 100);
    expect(result.current.visible).toBe(false);
    act(() => { movedCb(); });
    expect(result.current.visible).toBe(true);
  });

  it('is held up while the pointer REALLY rests on the chrome (asked of the browser: :hover)', () => {
    const el = document.createElement('div'); el.setAttribute('data-chill-chrome', ''); document.body.appendChild(el);
    let hovered = el;
    const real = document.querySelector.bind(document);
    vi.spyOn(document, 'querySelector').mockImplementation((sel) => (String(sel).includes(':hover') ? hovered : real(sel)));
    const { result } = mount();
    advance(CHILL_IDLE_MS * 3 + 100);
    expect(result.current.visible).toBe(true); // re-armed each time, never hides
    hovered = null; // the pointer moves off
    advance(CHILL_IDLE_MS + 100);
    expect(result.current.visible).toBe(false);
  });

  it('is NOT held up by a stale earlier move over the chrome (regression: the pointer left with no event to say so)', () => {
    // Over the chrome: a real mousemove whose target is a chrome element...
    const el = document.createElement('div'); el.setAttribute('data-chill-chrome', ''); document.body.appendChild(el);
    const { result } = mount();
    act(() => { el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); });
    expect(result.current.visible).toBe(true);
    // ...then the window resizes away from a parked cursor / the user tabs away: no further
    // event. jsdom never matches :hover, which is exactly "the pointer is not on it".
    advance(CHILL_IDLE_MS + 100);
    expect(result.current.visible).toBe(false);
  });

  it('drives the main process: tracking on/off, lights shown at once and hidden only after the fade', () => {
    const { result, unmount } = mount();
    expect(api.setChillChromeTracking).toHaveBeenLastCalledWith(true);
    expect(api.setWindowButtonsVisible).toHaveBeenLastCalledWith(true);
    advance(CHILL_IDLE_MS + 10);
    expect(result.current.visible).toBe(false);
    expect(api.setWindowButtonsVisible).not.toHaveBeenCalledWith(false); // not yet: the fade is still running
    advance(CHILL_LIGHTS_DELAY_MS + 10);
    expect(api.setWindowButtonsVisible).toHaveBeenLastCalledWith(false);
    act(() => { movedCb(); });
    expect(api.setWindowButtonsVisible).toHaveBeenLastCalledWith(true); // back at once with the chrome
    unmount();
    expect(api.setChillChromeTracking).toHaveBeenLastCalledWith(false);
    expect(unsubscribed).toBe(true);
  });

  it('does nothing to the main process while inactive', () => {
    mount({ active: false });
    expect(api.setChillChromeTracking).not.toHaveBeenCalled();
    expect(api.setWindowButtonsVisible).not.toHaveBeenCalled();
  });
});
