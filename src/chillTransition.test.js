import { describe, it, expect } from 'vitest';
import { transitionReducer as reduce, initialTransition, isTransitionLoading, CHILL_FADE_MS, CHILL_FADE_REDUCED_MS, CHILL_LOAD_TIMEOUT_MS } from './chillTransition.js';

const run = (state, ...actions) => actions.reduce(reduce, state);
const ready = (s) => ({ type: 'ready', sceneId: s.target.sceneId, seq: s.target.seq });

// A state with `a` on screen and nothing loading.
const showing = (id = 'a') => run(initialTransition(id), ready(initialTransition(id)));

describe('the first scene', () => {
  it('starts loading with nothing on screen', () => {
    const s = initialTransition('turntable');
    expect(s.current).toBeNull();
    expect(s.target.sceneId).toBe('turntable');
    expect(isTransitionLoading(s)).toBe(true);
  });
  it('takes its place the moment it is ready, with no fade over nothing', () => {
    const s = run(initialTransition('a'), { type: 'ready', sceneId: 'a', seq: 1 });
    expect(s.current).toEqual({ sceneId: 'a', seq: 1 });
    expect(s.target).toBeNull();
    expect(s.fading).toBe(false);
    expect(isTransitionLoading(s)).toBe(false);
  });
});

describe('switching', () => {
  it('keeps the current scene on screen while the new one loads', () => {
    const s = reduce(showing('a'), { type: 'request', sceneId: 'b' });
    expect(s.current.sceneId).toBe('a');
    expect(s.target.sceneId).toBe('b');
    expect(s.fading).toBe(false);
    expect(isTransitionLoading(s)).toBe(true);
  });
  it('starts the crossfade only when the new scene reports ready, then makes it current when the fade ends', () => {
    let s = reduce(showing('a'), { type: 'request', sceneId: 'b' });
    s = reduce(s, ready(s));
    expect(s.fading).toBe(true);
    expect(s.current.sceneId).toBe('a');              // the old one is still under the fade
    expect(isTransitionLoading(s)).toBe(false);        // the spinner stops once it is ready
    s = reduce(s, { type: 'faded' });
    expect(s.current.sceneId).toBe('b');
    expect(s.target).toBeNull();
    expect(s.fading).toBe(false);
  });
  it('asking for the scene already shown or already loading changes nothing', () => {
    const s = showing('a');
    expect(reduce(s, { type: 'request', sceneId: 'a' })).toBe(s);
    const loading = reduce(s, { type: 'request', sceneId: 'b' });
    expect(reduce(loading, { type: 'request', sceneId: 'b' })).toBe(loading);
  });
  it('the last choice wins when you pick again before the first has loaded', () => {
    let s = reduce(showing('a'), { type: 'request', sceneId: 'b' });
    const oldTarget = s.target;
    s = reduce(s, { type: 'request', sceneId: 'c' });
    expect(s.target.sceneId).toBe('c');
    // b's late "ready" is ignored
    expect(reduce(s, { type: 'ready', sceneId: 'b', seq: oldTarget.seq })).toBe(s);
    s = reduce(s, ready(s));
    expect(s.fading).toBe(true);
    expect(reduce(s, { type: 'faded' }).current.sceneId).toBe('c');
  });
  it('going back to what is on screen cancels the load in progress', () => {
    let s = reduce(showing('a'), { type: 'request', sceneId: 'b' });
    const b = s.target;
    s = reduce(s, { type: 'request', sceneId: 'a' });
    expect(s.target).toBeNull();
    expect(s.current.sceneId).toBe('a');
    expect(isTransitionLoading(s)).toBe(false);
    expect(reduce(s, { type: 'ready', sceneId: 'b', seq: b.seq })).toBe(s);   // b finishing late does nothing
  });
  it('a request during a fade waits for it, then starts loading', () => {
    let s = reduce(showing('a'), { type: 'request', sceneId: 'b' });
    s = reduce(s, ready(s));
    s = reduce(s, { type: 'request', sceneId: 'c' });
    expect(s.target.sceneId).toBe('b');                // b keeps fading in
    expect(s.queued).toBe('c');
    s = reduce(s, { type: 'faded' });
    expect(s.current.sceneId).toBe('b');
    expect(s.target.sceneId).toBe('c');                // c loads now
    expect(s.fading).toBe(false);
    expect(s.queued).toBeNull();
  });
  it('a request during a fade for the scene that is fading in just clears any queued one', () => {
    let s = reduce(showing('a'), { type: 'request', sceneId: 'b' });
    s = reduce(s, ready(s));
    s = reduce(s, { type: 'request', sceneId: 'c' });
    s = reduce(s, { type: 'request', sceneId: 'b' });
    expect(s.queued).toBeNull();
    expect(reduce(s, { type: 'faded' }).target).toBeNull();
  });
  it('a queued request for the scene that just arrived is dropped', () => {
    let s = reduce(showing('a'), { type: 'request', sceneId: 'b' });
    s = reduce(s, ready(s));
    s = { ...s, queued: 'b' };
    expect(reduce(s, { type: 'faded' }).target).toBeNull();
  });
  it('asking for the same scene again later gets a fresh load (a new seq)', () => {
    let s = reduce(showing('a'), { type: 'request', sceneId: 'b' });
    const first = s.target.seq;
    s = reduce(s, { type: 'request', sceneId: 'a' });
    s = reduce(s, { type: 'request', sceneId: 'b' });
    expect(s.target.seq).toBeGreaterThan(first);
  });
});

describe('guards', () => {
  it('ignores a "ready" or "faded" that does not belong to what is happening', () => {
    const s = showing('a');
    expect(reduce(s, { type: 'ready', sceneId: 'a', seq: 99 })).toBe(s);
    expect(reduce(s, { type: 'faded' })).toBe(s);
    const loading = reduce(s, { type: 'request', sceneId: 'b' });
    expect(reduce(loading, { type: 'ready', sceneId: 'b', seq: 999 })).toBe(loading);
    expect(reduce(loading, { type: 'ready', sceneId: 'zzz', seq: loading.target.seq })).toBe(loading);
  });
  it('a duplicate "ready" while fading changes nothing', () => {
    let s = reduce(showing('a'), { type: 'request', sceneId: 'b' });
    const r = ready(s);
    s = reduce(s, r);
    expect(reduce(s, r)).toBe(s);
  });
  it('an unknown action is ignored', () => {
    const s = showing('a');
    expect(reduce(s, { type: 'nope' })).toBe(s);
  });
  it('the timings are sane: a brief reduced-motion fade, a normal one, a load limit far longer than both', () => {
    expect(CHILL_FADE_REDUCED_MS).toBeLessThan(CHILL_FADE_MS);
    expect(CHILL_LOAD_TIMEOUT_MS).toBeGreaterThan(CHILL_FADE_MS * 4);
  });
});
