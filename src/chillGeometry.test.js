import { describe, it, expect, afterEach, vi } from 'vitest';
import { computeFraming, homographyFromQuad, quadMatrix3d, applyHomography, polygonClipPath } from './chillGeometry.js';
import { PHONE_SCREEN_QUAD, PHONE_LOCAL_W, PHONE_LOCAL_H, BEACH_FRAMING, BEACH_W, BEACH_H, SWAY, SWAY_GLSL, swayAt, swayRampX, swayProfileY, PHONE_CENTER_X, PHONE_CENTER_Y } from './chillBeach.js';
import { CHILL_SCENES, DEFAULT_CHILL_SCENE, CHILL_SCENE_STORAGE_KEY, getChillScene, loadChillSceneId, saveChillSceneId } from './chillScenes.js';

describe('homographyFromQuad', () => {
  const quads = {
    'the hammock phone screen': PHONE_SCREEN_QUAD,
    'a skewed quad': [[10, 20], [310, 5], [330, 410], [-5, 380]],
    'an axis-aligned rectangle': [[100, 50], [400, 50], [400, 650], [100, 650]],
  };
  for (const [name, quad] of Object.entries(quads)) {
    it(`maps the rectangle's corners exactly onto ${name}`, () => {
      const H = homographyFromQuad(PHONE_LOCAL_W, PHONE_LOCAL_H, quad);
      const corners = [[0, 0], [PHONE_LOCAL_W, 0], [PHONE_LOCAL_W, PHONE_LOCAL_H], [0, PHONE_LOCAL_H]];
      corners.forEach(([x, y], i) => {
        const [u, v] = applyHomography(H, x, y);
        expect(u).toBeCloseTo(quad[i][0], 6);
        expect(v).toBeCloseTo(quad[i][1], 6);
      });
    });
  }

  it('maps the centre of the rectangle inside the quad', () => {
    const H = homographyFromQuad(PHONE_LOCAL_W, PHONE_LOCAL_H, PHONE_SCREEN_QUAD);
    const [cx, cy] = applyHomography(H, PHONE_LOCAL_W / 2, PHONE_LOCAL_H / 2);
    expect(cx).toBeGreaterThan(1313); expect(cx).toBeLessThan(1451);
    expect(cy).toBeGreaterThan(540); expect(cy).toBeLessThan(840);
  });

  it('produces a well-formed CSS matrix3d that agrees with the homography', () => {
    const m = quadMatrix3d(PHONE_LOCAL_W, PHONE_LOCAL_H, PHONE_SCREEN_QUAD);
    expect(m.startsWith('matrix3d(')).toBe(true);
    const n = m.slice(9, -1).split(',').map(Number);
    expect(n).toHaveLength(16);
    expect(n.every(Number.isFinite)).toBe(true);
    // the bottom-right local corner, applied the way CSS does
    const x = PHONE_LOCAL_W, y = PHONE_LOCAL_H;
    const w = n[3] * x + n[7] * y + n[15];
    expect((n[0] * x + n[4] * y + n[12]) / w).toBeCloseTo(PHONE_SCREEN_QUAD[2][0], 4);
    expect((n[1] * x + n[5] * y + n[13]) / w).toBeCloseTo(PHONE_SCREEN_QUAD[2][1], 4);
  });
});

describe('the hammock phone calibration', () => {
  it('is a near-rectangle of the size measured in the photo (~134.5 x 300 px)', () => {
    const [tl, tr, br, bl] = PHONE_SCREEN_QUAD;
    expect(Math.hypot(tr[0] - tl[0], tr[1] - tl[1])).toBeGreaterThan(130);
    expect(Math.hypot(tr[0] - tl[0], tr[1] - tl[1])).toBeLessThan(140);
    expect(Math.hypot(bl[0] - tl[0], bl[1] - tl[1])).toBeGreaterThan(295);
    expect(Math.hypot(bl[0] - tl[0], bl[1] - tl[1])).toBeLessThan(305);
    // and lies well inside the photo
    for (const [x, y] of [tl, tr, br, bl]) { expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(BEACH_W); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(BEACH_H); }
  });
  it('keeps the local layout space in the screen\'s aspect ratio', () => {
    expect(PHONE_LOCAL_W / PHONE_LOCAL_H).toBeCloseTo(134.5 / 300, 2);
  });
});

describe('computeFraming — every bundled scene', () => {
  const sizes = [[560, 421], [640, 480], [800, 600], [1000, 700], [1280, 720], [1440, 900], [1600, 900], [1920, 1080], [2560, 1440], [3440, 1440], [1000, 1000]];
  for (const scene of CHILL_SCENES) {
    for (const dpr of [1, 2]) {
      for (const [w, h] of sizes) {
        it(`${scene.id}: covers a ${w}x${h} window @${dpr}x with no empty edges`, () => {
          const f = scene.framing;
          const { k, tx, ty } = computeFraming(w, h, dpr, f);
          expect(tx).toBeLessThanOrEqual(1e-9);
          expect(ty).toBeLessThanOrEqual(1e-9);
          expect(tx + f.sceneW * k).toBeGreaterThanOrEqual(w - 1e-6);
          expect(ty + f.sceneH * k).toBeGreaterThanOrEqual(h - 1e-6);
        });
      }
    }
    it(`${scene.id}: keeps its must-show region in frame at ordinary window shapes`, () => {
      const f = scene.framing;
      const must = f.must || f.keep;
      for (const dpr of [1, 2]) {
        for (const [w, h] of [[560, 421], [800, 600], [1000, 700], [1280, 720], [1600, 900], [1920, 1080], [2560, 1440], [3440, 1440]]) {
          const { k, tx, ty } = computeFraming(w, h, dpr, f);
          expect(must.x0 * k + tx).toBeGreaterThanOrEqual(-1);
          expect(must.x1 * k + tx).toBeLessThanOrEqual(w + 1);
          expect(must.y0 * k + ty).toBeGreaterThanOrEqual(-1);
          expect(must.y1 * k + ty).toBeLessThanOrEqual(h + 1);
        }
      }
    });
  }

  it('hammock: shows the whole right side — sea, glitter and shore waves — in ordinary landscape windows', () => {
    for (const dpr of [1, 2]) {
      for (const [w, h] of [[1280, 720], [1440, 810], [1600, 900], [1920, 1080], [2560, 1440], [3440, 1440]]) {
        const { k, tx } = computeFraming(w, h, dpr, BEACH_FRAMING);
        // the shore waves live around x 2100-2750 of the photo
        expect(2750 * k + tx).toBeLessThanOrEqual(w + 1);
        expect(2100 * k + tx).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it('hammock: the phone is ~20-30% of the window height in ordinary landscape windows', () => {
    for (const [w, h] of [[1280, 720], [1600, 900], [1920, 1080]]) {
      const { k } = computeFraming(w, h, 1, BEACH_FRAMING);
      expect((300 * k) / h).toBeGreaterThan(0.19);
      expect((300 * k) / h).toBeLessThan(0.3);
    }
  });
  it('hammock: never magnifies past the resolution cap unless covering demands it', () => {
    // 2000x1200 @2x: the phone-height target would be 1.04, the cap is 1.6/2 = 0.8 (cover is 0.781)
    expect(computeFraming(2000, 1200, 2, BEACH_FRAMING).k).toBeCloseTo(0.8, 5);
    const big = computeFraming(2560, 1440, 2, BEACH_FRAMING);
    expect(big.k).toBeCloseTo(Math.max(2560 / BEACH_W, 1440 / BEACH_H), 5);
  });
  it('survives a degenerate size', () => {
    for (const s of CHILL_SCENES) {
      const f = computeFraming(0, 0, 0, s.framing);
      expect(Number.isFinite(f.k) && Number.isFinite(f.tx) && Number.isFinite(f.ty)).toBe(true);
    }
  });
});

describe('the hammock swing', () => {
  const samples = (n, dt, f) => Array.from({ length: n }, (_, i) => f(i * dt));

  it('is bounded by its amplitudes', () => {
    for (const s of samples(4000, 0.05, swayAt)) {
      expect(Math.abs(s.dx)).toBeLessThanOrEqual(SWAY.ampX + 1e-9);
      expect(Math.abs(s.dy)).toBeLessThanOrEqual(SWAY.ampY + 1e-9);
      expect(Math.abs(s.hang)).toBeLessThanOrEqual(SWAY.ampHang + 1e-9);
    }
  });

  it('is smooth: no jumps between 50ms steps', () => {
    let prev = swayAt(0);
    for (let t = 0.05; t < 120; t += 0.05) {
      const s = swayAt(t);
      expect(Math.abs(s.dx - prev.dx)).toBeLessThan(1);
      expect(Math.abs(s.dy - prev.dy)).toBeLessThan(1);
      expect(Math.abs(s.hang - prev.hang)).toBeLessThan(1);
      prev = s;
    }
  });

  it('never repeats mechanically: not periodic at its main period, and its amplitude drifts', () => {
    const a = swayAt(1.7), b = swayAt(1.7 + 6.4), c = swayAt(1.7 + 12.8);
    expect(Math.abs(a.dx - b.dx) + Math.abs(a.dx - c.dx)).toBeGreaterThan(0.2);
    const peak = (from) => Math.max(...samples(130, 0.05, (t) => Math.abs(swayAt(from + t).dx)));
    const peaks = [0, 6.4, 12.8, 19.2, 25.6, 32.0].map(peak);
    expect(Math.max(...peaks) - Math.min(...peaks)).toBeGreaterThan(0.3);
  });

  it('swings both ways, by a visible but gentle amount', () => {
    const xs = samples(4000, 0.05, (t) => swayAt(t).dx);
    expect(Math.min(...xs)).toBeLessThan(-SWAY.ampX * 0.6);
    expect(Math.max(...xs)).toBeGreaterThan(SWAY.ampX * 0.6);
  });

  it('moves in an ellipse, not along a line: the two axes are not in phase', () => {
    const n = 4800;
    const xs = samples(n, 0.05, (t) => swayAt(t).dx), ys = samples(n, 0.05, (t) => swayAt(t).dy);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    expect(Math.abs(sxy / Math.sqrt(sxx * syy))).toBeLessThan(0.5);
  });

  it('lets the hanging ropes follow the body by the lag, scaled to their own amplitude', () => {
    for (const t of [0, 3.3, 11.9, 40.2, 77.7]) {
      expect(swayAt(t + SWAY.hangLagS).hang).toBeCloseTo(swayAt(t).dx * SWAY.ampHang / SWAY.ampX, 9);
    }
  });

  it('weights the sideways swing by height: nothing at the horizon, everything low in the frame', () => {
    expect(swayRampX(0)).toBe(0);
    expect(swayRampX(SWAY.y0)).toBe(0);
    expect(swayRampX(SWAY.y1)).toBe(1);
    expect(swayRampX(5000)).toBe(1);
    let prev = 0;
    for (let y = 0; y <= 1536; y += 16) { const r = swayRampX(y); expect(r).toBeGreaterThanOrEqual(prev); prev = r; }
  });

  it('weights the vertical swing along the hammock: none at the anchor, full over the man, a floor at the far left', () => {
    expect(swayProfileY(SWAY.anchorX)).toBeCloseTo(0, 9);
    expect(swayProfileY(2700)).toBeCloseTo(0, 9);
    expect(swayProfileY(0)).toBeCloseTo(SWAY.leftFloor, 9);
    for (const x of [SWAY.midX, 1100, 1300, 1500]) expect(swayProfileY(x)).toBeCloseTo(1, 9);
    // rises over the left part, falls toward the anchor, never leaves 0..1
    let prev = swayProfileY(0);
    for (let x = 0; x <= SWAY.midX; x += 20) { const v = swayProfileY(x); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
    prev = 1;
    for (let x = 1500; x <= SWAY.anchorX; x += 20) { const v = swayProfileY(x); expect(v).toBeLessThanOrEqual(prev + 1e-12); prev = v; }
    for (let x = 0; x <= BEACH_W; x += 25) { const v = swayProfileY(x); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('gives the shader the same two weights, built from the same constants', () => {
    expect(SWAY_GLSL).toContain('float swayRampX(float y)');
    expect(SWAY_GLSL).toContain('float swayProfileY(float x)');
    expect(SWAY_GLSL).toContain(`${SWAY.anchorX.toFixed(1)}`);
    expect(SWAY_GLSL).toContain(`${SWAY.leftFloor.toFixed(3)}`);
    expect(SWAY_GLSL).toContain(`${SWAY.y0.toFixed(1)}`);
  });

  it('samples the phone overlay\'s weights at the screen\'s own position (what the hands holding it get)', () => {
    expect(PHONE_CENTER_X).toBeGreaterThan(PHONE_SCREEN_QUAD[0][0]);
    expect(PHONE_CENTER_X).toBeLessThan(PHONE_SCREEN_QUAD[1][0]);
    expect(PHONE_CENTER_Y).toBeGreaterThan(PHONE_SCREEN_QUAD[0][1]);
    expect(PHONE_CENTER_Y).toBeLessThan(PHONE_SCREEN_QUAD[3][1]);
    expect(swayRampX(PHONE_CENTER_Y)).toBeGreaterThan(0.2);
    expect(swayRampX(PHONE_CENTER_Y)).toBeLessThan(0.8);
    expect(swayProfileY(PHONE_CENTER_X)).toBeCloseTo(1, 9);
  });
});

describe('polygonClipPath', () => {
  it('builds clip-path polygons in photo pixels', () => {
    expect(polygonClipPath([[1, 2], [3, 4], [5, 6]])).toBe('polygon(1px 2px, 3px 4px, 5px 6px)');
  });
});

describe('the scene registry', () => {
  afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); });

  it('has unique ids, a default that exists, and everything a scene needs', () => {
    const ids = CHILL_SCENES.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_CHILL_SCENE);
    for (const s of CHILL_SCENES) {
      expect(typeof s.label).toBe('string');
      expect(['turntable', 'beach', 'room']).toContain(s.kind);
      expect(s.photo).toBeTruthy();
      expect(s.thumb).toBeTruthy();
      expect(s.framing.sceneW).toBeGreaterThan(0);
    }
    expect(getChillScene('beach').kind).toBe('beach');
    const beach = CHILL_SCENES.find(s => s.kind === 'beach');
    expect(beach.fx).toBeTruthy(); // the living photo needs its effects...
    expect(beach.fx.masks.map(m => m.uniform)).toEqual(['uMask', 'uBody']); // ...with the palm/sea/shore masks and the body mask for the swing
    expect(beach.fx.masks.every(m => m.url)).toBe(true);
  });

  it('falls back to the first scene for an unknown id', () => {
    expect(getChillScene('nope')).toBe(CHILL_SCENES[0]);
    expect(getChillScene(undefined)).toBe(CHILL_SCENES[0]);
  });

  it('remembers the choice, and ignores a stored id that no longer exists', () => {
    expect(loadChillSceneId()).toBe(DEFAULT_CHILL_SCENE);
    saveChillSceneId('beach');
    expect(window.localStorage.getItem(CHILL_SCENE_STORAGE_KEY)).toBe('beach');
    expect(loadChillSceneId()).toBe('beach');
    window.localStorage.setItem(CHILL_SCENE_STORAGE_KEY, 'deleted-scene');
    expect(loadChillSceneId()).toBe(DEFAULT_CHILL_SCENE);
  });

  it('survives storage that throws (private windows, cleared site data)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadChillSceneId()).toBe(DEFAULT_CHILL_SCENE);
    expect(() => saveChillSceneId('beach')).not.toThrow();
  });
});
