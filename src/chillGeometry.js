// Scene-independent geometry for Chill mode: how to frame a photo in a window of
// any shape, how to place a flat rectangle onto a quadrilateral in a photo, and
// CSS clip-path strings. Pure maths, unit-tested (chillGeometry.test.js); the
// per-scene numbers live in chillScene.js (turntable) and chillBeach.js (hammock).

export const polygonClipPath = (pts) => `polygon(${pts.map(([x, y]) => `${x}px ${y}px`).join(', ')})`;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ── Framing ────────────────────────────────────────────────────────────────
// Where to put a photo in a container of any size: scale and offset so that the
// image always covers the container (no empty edges), the "keep" region stays in
// frame, and the scene's focal object is a sensible size. `framing`:
//   sceneW, sceneH   the photo's pixel size
//   keep             region that must stay in frame (photo px: x0,y0,x1,y1)
//   focus            { size, axis: 'w'|'h', fraction } — size the focal object
//                    (size photo-px along `axis`) to `fraction` of the container's
//                    width/height
//   fitMargin        keep may use at most this share of the width (default .96)
//   maxUpscale       never magnify past this many DEVICE px per photo px — the
//                    photos are ~2752px wide, so past that they only get soft
//                    (default 1.6)
//   focusY           where the keep region's centre sits vertically (default .44)
// Covering the container wins over all of it: a big Retina window has to be
// filled even if that means upscaling.
export function computeFraming(width, height, dpr, framing) {
  const { sceneW, sceneH, keep, focus, fitMargin = 0.96, maxUpscale = 1.6, focusY = 0.44 } = framing;
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const cover = Math.max(w / sceneW, h / sceneH);
  const target = focus.axis === 'h' ? (focus.fraction * h) / focus.size : (focus.fraction * w) / focus.size;
  const fit = (fitMargin * w) / (keep.x1 - keep.x0);
  const res = maxUpscale / Math.max(0.5, dpr);
  const k = Math.max(cover, Math.min(target, fit, res));
  const fx = (keep.x0 + keep.x1) / 2;
  const fy = (keep.y0 + keep.y1) / 2;
  const tx = clamp(w * 0.5 - fx * k, w - sceneW * k, 0);
  const ty = clamp(h * focusY - fy * k, h - sceneH * k, 0);
  return { k, tx, ty };
}

// ── Quad → CSS matrix3d ────────────────────────────────────────────────────
// The homography taking a flat rectangle (0,0)-(w,h) onto the quadrilateral
// `quad` = [TL, TR, BR, BL] in photo px: the standard 8-unknown linear system
// (h33 fixed at 1), solved by Gaussian elimination. As CSS (transform-origin 0 0):
// a homography [[a b c][d e f][g h 1]] is matrix3d(a,d,0,g, b,e,0,h, 0,0,1,0, c,f,0,1).
export function homographyFromQuad(w, h, quad) {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = quad[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let m = i; m <= n; m++) M[k][m] -= f * M[i][m];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k];
    x[i] = s / M[i][i];
  }
  return [[x[0], x[1], x[2]], [x[3], x[4], x[5]], [x[6], x[7], 1]];
}

export function quadMatrix3d(w, h, quad) {
  const H = homographyFromQuad(w, h, quad);
  return `matrix3d(${H[0][0]},${H[1][0]},0,${H[2][0]},${H[0][1]},${H[1][1]},0,${H[2][1]},0,0,1,0,${H[0][2]},${H[1][2]},0,${H[2][2]})`;
}

// Apply a homography to a point (for tests and for checking calibrations).
export function applyHomography(H, x, y) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
}
