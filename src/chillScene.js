// Chill mode's scene geometry (ChillScene.jsx) — pure numbers and maths, kept
// out of the component so they can be unit-tested and so the one place that
// knows about the photo is this file.
//
// The scene is a photo of a turntable (assets/chill/turntable.jpg, 2752x1536).
// The song's artwork becomes the record: a square element, rotated about its
// own centre, whose PARENT carries a perspective transform (a homography)
// mapping that square onto the record's tilted ellipse in the photo. Because
// the photo and the disc live in one box that is scaled as a unit, the disc
// stays glued to the record at every window size.
//
// Everything below was measured from THIS photo: HOMOGRAPHY by a
// least-squares fit of 23 hand-read points on the record's edge plus the
// spindle's base (rms ≈ 0.03 of the record's radius, i.e. ~10px on a 760px
// record); the polygons by tracing the tonearm/pin on 4-5x zooms. A different
// photo needs all of it redone.

export const SCENE_W = 2752;
export const SCENE_H = 1536;

// The disc element is DISC_PX square; its edge sits at DISC_RADIUS in the
// fitted plane (1 = the record's outer edge in the photo), a hair over 1 so
// the photo's own bright rim bevel never peeks out around the artwork.
export const DISC_PX = 1000;
export const DISC_RADIUS = 1.012;

// Plane (unit circle = the record) -> photo pixels.
export const HOMOGRAPHY = [
  [0.2645496507413516, -0.10310711867723925, 1.0136679384494862],
  [0.0026760994886825037, -0.0009961689189970863, 0.6201442078873741],
  [0.000007561064118762655, -0.00007967970143273437, 0.000692195497284045],
];

// The photo's own tonearm + headshell and spindle pin, traced (photo px).
// ChillScene draws a second copy of the photo clipped to these OVER the disc,
// so the arm and pin stay in front of the artwork with no image editing.
export const ARM_POLYGON = [
  [1415, 946], [1417, 940], [1420, 934], [1430, 930], [1470, 930], [1484, 932], [1560, 934], [1562, 940],
  [1606, 939], [1715, 936], [1790, 927], [1840, 921], [1880, 913], [1880, 938], [1840, 947], [1790, 957],
  [1720, 960], [1690, 962], [1606, 960], [1606, 976], [1564, 977], [1546, 978], [1480, 976], [1478, 1013],
  [1413, 1013], [1413, 954],
];
export const PIN_POLYGON = [[1455, 880], [1457, 872], [1464, 869], [1471, 872], [1472, 880], [1472, 898], [1455, 898]];
// Soft contact shadows the real photo's record had and the artwork disc lacks.
export const ARM_SHADOW_POLYGON = [
  [1430, 950], [1560, 952], [1606, 958], [1715, 954], [1790, 946], [1850, 938], [1860, 952], [1800, 972],
  [1720, 980], [1606, 990], [1560, 996], [1490, 1002], [1430, 1008],
];
export const PIN_SHADOW = { cx: 1463, cy: 899, rx: 11, ry: 4 };

// One turn every 2.8s (~21 rpm) — a real record is 33⅓ rpm (1800ms), which
// read as too fast on screen, so this is deliberately a calmer, "chill" pace.
export const SPIN_MS = 2800;

import { computeFraming } from './chillGeometry.js';
export { polygonClipPath } from './chillGeometry.js';

// CSS matrix3d for the disc element: local px (0..DISC_PX) -> photo px, with
// transform-origin 0 0. A homography [[a b c][d e f][g h i]] is
// matrix3d(a,d,0,g, b,e,0,h, 0,0,1,0, c,f,0,i).
export function discMatrix3d() {
  const s = DISC_RADIUS / (DISC_PX / 2);
  const o = DISC_PX / 2;
  const S = [[s, 0, -o * s], [0, s, -o * s], [0, 0, 1]];
  const M = HOMOGRAPHY.map((r) => [0, 1, 2].map((j) => r[0] * S[0][j] + r[1] * S[1][j] + r[2] * S[2][j]));
  const n = M[2][2];
  for (const r of M) for (let j = 0; j < 3; j++) r[j] /= n;
  return `matrix3d(${M[0][0]},${M[1][0]},0,${M[2][0]},${M[0][1]},${M[1][1]},0,${M[2][1]},0,0,1,0,${M[0][2]},${M[1][2]},0,${M[2][2]})`;
}

// ── Framing ────────────────────────────────────────────────────────────────
// How the turntable photo is placed in a window of any shape (the generic maths
// and the rules are in chillGeometry.js `computeFraming`): the record is ~45% of
// the width, the record + tonearm base are kept in frame, the photo is never
// magnified past 1.6 device px per photo px unless covering the window demands
// it, and the record sits a little above the middle so the bar stays clear.
export const TURNTABLE_FRAMING = {
  sceneW: SCENE_W,
  sceneH: SCENE_H,
  keep: { x0: 1060, y0: 780, x1: 2000, y1: 1040 }, // record + tonearm base
  focus: { size: 765, axis: 'w', fraction: 0.45 }, // the record is ~765px wide in the photo
  maxUpscale: 1.6,
  focusY: 0.44,
};

export const computeTurntableFraming = (width, height, dpr = 1) => computeFraming(width, height, dpr, TURNTABLE_FRAMING);
