import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useChillChrome, { CHILL_IDLE_MS, CHILL_LIGHTS_DELAY_MS, CHILL_PAUSE_GRACE_MS } from './useChillChrome.js';

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
    advance(CHILL_PAUSE_GRACE_MS + 100);   // a pause counts once it has lasted the grace period
    expect(result.current.visible).toBe(true);
    advance(CHILL_IDLE_MS * 3);
    expect(result.current.visible).toBe(true); // paused stays up
    rerender({ active: true, playing: true, hold: false });
    advance(CHILL_IDLE_MS + 100);
    expect(result.current.visible).toBe(false); // resuming restarts the quiet clock
  });

  describe('the gap between two songs', () => {
    it('does not bring the chrome back: "paused" then "playing" again within the grace period changes nothing', () => {
      const { result, rerender } = mount();
      advance(CHILL_IDLE_MS + 100);
      expect(result.current.visible).toBe(false);
      rerender({ active: true, playing: false, hold: false });   // the song ended
      advance(CHILL_PAUSE_GRACE_MS - 300);
      expect(result.current.visible).toBe(false);
      rerender({ active: true, playing: true, hold: false });    // the next one started
      expect(result.current.visible).toBe(false);
      advance(CHILL_IDLE_MS * 3);
      expect(result.current.visible).toBe(false);                // and it never flashed or re-armed the clock
    });

    it('does not restart the quiet clock either: hidden-to-visible never happens, and an already-running clock keeps its schedule', () => {
      const { result, rerender } = mount();
      advance(CHILL_IDLE_MS - 1000);                             // 2.5s into the quiet spell
      rerender({ active: true, playing: false, hold: false });
      advance(500);
      rerender({ active: true, playing: true, hold: false });    // gap of 0.5s
      advance(1000 + 50);                                        // the ORIGINAL deadline passes
      expect(result.current.visible).toBe(false);
    });

    it('a pause that lasts longer than the gap does show it, and resuming then restarts the quiet clock', () => {
      const { result, rerender } = mount();
      advance(CHILL_IDLE_MS + 100);
      rerender({ active: true, playing: false, hold: false });
      advance(CHILL_PAUSE_GRACE_MS + 100);
      expect(result.current.visible).toBe(true);                 // the last song ended: playback really stopped
      rerender({ active: true, playing: true, hold: false });
      expect(result.current.visible).toBe(true);                 // up at once...
      advance(CHILL_IDLE_MS - 100);
      expect(result.current.visible).toBe(true);
      advance(200);
      expect(result.current.visible).toBe(false);                // ...and fades after a full quiet spell
    });

    it('mounted already paused: visible straight away (nothing to wait for)', () => {
      expect(mount({ playing: false }).result.current.visible).toBe(true);
    });
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
