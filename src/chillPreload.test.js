import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { decodeImage, preloadChillScene, sceneImageUrls, _clearPreloadCache } from './chillPreload.js';

describe('chillPreload', () => {
  const RealImage = window.Image;
  let made;
  beforeEach(() => {
    _clearPreloadCache();
    made = [];
    // jsdom loads no images: a stand-in that "decodes" (or fails) on demand.
    window.Image = class {
      constructor() { made.push(this); this.decodeCalls = 0; }
      set src(v) { this._src = v; }
      get src() { return this._src; }
      decode() { this.decodeCalls += 1; return this.src.includes('bad') ? Promise.reject(new Error('bad')) : Promise.resolve(); }
    };
    globalThis.Image = window.Image;
  });
  afterEach(() => { window.Image = RealImage; globalThis.Image = RealImage; vi.restoreAllMocks(); });

  it('lists every picture a scene draws: photo, glare, effect masks', () => {
    expect(sceneImageUrls({ photo: '/p.jpg', glare: '/g.png', fx: { masks: [{ url: '/m1.png' }, { url: '/m2.png' }] } })).toEqual(['/p.jpg', '/g.png', '/m1.png', '/m2.png']);
    expect(sceneImageUrls({ photo: '/p.jpg' })).toEqual(['/p.jpg']);
  });

  it('decodes an image once, however often it is asked for', async () => {
    const a = decodeImage('/p.jpg');
    const b = decodeImage('/p.jpg');
    expect(a).toBe(b);
    await a;
    expect(made).toHaveLength(1);
    expect(made[0].decodeCalls).toBe(1);
  });

  it('resolves, never rejects, for an image that fails to decode', async () => {
    await expect(decodeImage('/bad.jpg')).resolves.toBeTruthy();
  });

  it('resolves to null for no url', async () => {
    await expect(decodeImage(undefined)).resolves.toBeNull();
  });

  it('preloads a whole scene and resolves even when one of its images is broken', async () => {
    await expect(preloadChillScene({ photo: '/p.jpg', glare: '/bad.png', fx: { masks: [{ url: '/m.png' }] } })).resolves.toHaveLength(3);
    expect(made).toHaveLength(3);
  });

  it('ignores the test-only load delay unless the page was opened with ?test=1', async () => {
    window.__sonusChillLoadDelayMs = 400;
    const started = Date.now();
    await decodeImage('/delay.jpg');
    expect(Date.now() - started).toBeLessThan(300);
    delete window.__sonusChillLoadDelayMs;
  });
});
