import { describe, it, expect } from 'vitest';
import { computeTurntableFraming as computeFraming, discMatrix3d, polygonClipPath, SCENE_W, SCENE_H, HOMOGRAPHY, DISC_PX, DISC_RADIUS } from './chillScene.js';

// Project a point through the same maths the browser applies to the disc.
const project = (u, v) => {
  const H = HOMOGRAPHY;
  const w = H[2][0] * u + H[2][1] * v + H[2][2];
  return [(H[0][0] * u + H[0][1] * v + H[0][2]) / w, (H[1][0] * u + H[1][1] * v + H[1][2]) / w];
};

describe('computeFraming', () => {
  const sizes = [
    [560, 421], [640, 480], [800, 600], [1000, 700], [1280, 720], [1440, 900], [1600, 900],
    [1920, 1080], [2560, 1440], [3440, 1440], [1000, 1000], [900, 1200],
  ];
  for (const dpr of [1, 2]) {
    for (const [w, h] of sizes) {
      it(`covers the container with no empty edges (${w}x${h} @${dpr}x)`, () => {
        const { k, tx, ty } = computeFraming(w, h, dpr);
        expect(tx).toBeLessThanOrEqual(1e-9);
        expect(ty).toBeLessThanOrEqual(1e-9);
        expect(tx + SCENE_W * k).toBeGreaterThanOrEqual(w - 1e-6);
        expect(ty + SCENE_H * k).toBeGreaterThanOrEqual(h - 1e-6);
      });
    }
  }

  it('keeps the record and tonearm fully in frame at ordinary window shapes', () => {
    for (const dpr of [1, 2]) {
      for (const [w, h] of [[560, 421], [800, 600], [1000, 700], [1280, 720], [1600, 900], [1920, 1080], [2560, 1440], [3440, 1440], [1000, 1000]]) {
        const { k, tx, ty } = computeFraming(w, h, dpr);
        const x0 = 1060 * k + tx, x1 = 2000 * k + tx, y0 = 780 * k + ty, y1 = 1040 * k + ty;
        expect(x0).toBeGreaterThanOrEqual(-1);
        expect(x1).toBeLessThanOrEqual(w + 1);
        expect(y0).toBeGreaterThanOrEqual(-1);
        expect(y1).toBeLessThanOrEqual(h + 1);
      }
    }
  });

  it('sizes the record to about 45% of the width where the photo resolution allows it', () => {
    const { k } = computeFraming(1600, 900, 1);
    expect((765 * k) / 1600).toBeCloseTo(0.45, 2);
  });

  it('does not magnify past the resolution cap unless covering demands it', () => {
    // 1600x900 @2x: 0.45 target would be 0.94, the cap is 1.6/2 = 0.8
    expect(computeFraming(1600, 900, 2).k).toBeCloseTo(0.8, 5);
    // A big Retina window must still be covered, whatever the cap says
    const big = computeFraming(2560, 1440, 2);
    expect(big.k).toBeCloseTo(Math.max(2560 / SCENE_W, 1440 / SCENE_H), 5);
  });

  it('keeps the record above the lower bar (centre a little above the middle)', () => {
    const { k, ty } = computeFraming(1600, 900, 1);
    const recordCentreY = 910 * k + ty;
    expect(recordCentreY).toBeLessThan(900 * 0.5);
  });

  it('survives a degenerate size', () => {
    const f = computeFraming(0, 0, 0);
    expect(Number.isFinite(f.k) && Number.isFinite(f.tx) && Number.isFinite(f.ty)).toBe(true);
  });
});

describe('disc geometry', () => {
  it('maps the disc centre onto the spindle and the rim onto the record edge', () => {
    const [cx, cy] = project(0, 0);
    expect(Math.hypot(cx - 1462, cy - 894)).toBeLessThan(6);
    // the record's extreme points in the photo (read by eye): left tip ~1085, right tip ~1847
    const left = project(-1, 0)[0];
    const right = project(1, 0)[0];
    expect(Math.abs(left - 1085)).toBeLessThan(25);
    expect(Math.abs(right - 1847)).toBeLessThan(25);
  });

  it('produces a well-formed matrix3d whose centre lands on the spindle', () => {
    const m = discMatrix3d();
    expect(m.startsWith('matrix3d(')).toBe(true);
    const n = m.slice(9, -1).split(',').map(Number);
    expect(n).toHaveLength(16);
    expect(n.every(Number.isFinite)).toBe(true);
    // local (500,500) is the disc centre; apply the matrix as CSS does
    const x = 500, y = 500;
    const w = n[3] * x + n[7] * y + n[15];
    const px = (n[0] * x + n[4] * y + n[12]) / w, py = (n[1] * x + n[5] * y + n[13]) / w;
    expect(Math.hypot(px - 1462, py - 894)).toBeLessThan(6);
    expect(DISC_PX).toBe(1000);
    expect(DISC_RADIUS).toBeGreaterThan(1);
  });

  it('builds clip-path polygons in photo pixels', () => {
    expect(polygonClipPath([[1, 2], [3, 4], [5, 6]])).toBe('polygon(1px 2px, 3px 4px, 5px 6px)');
  });
});
