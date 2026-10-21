// The hammock-on-the-beach scene (assets/chill/beach.jpg, 2752x1536): a man in a
// hammock holds a phone whose screen shows a music player. Chill mode redraws that
// screen live (ChillPhoneScreen.jsx) and gently animates the palms and the sea
// (ChillLivingPhoto.jsx, masks from scripts/make-chill-beach-mask.py).
//
// Everything here was measured from THIS photo on 4-5x zooms; a different photo
// needs it redone.

export const BEACH_W = 2752;
export const BEACH_H = 1536;

// The phone's screen, as the quadrilateral [TL, TR, BR, BL] in photo px. The phone
// is held almost face-on, so it is nearly a rectangle (134.5 x 300 px, ~0.4deg off).
export const PHONE_SCREEN_QUAD = [[1315.6, 540], [1450, 540], [1448.7, 840], [1313.8, 840]];

// Our screen UI is laid out in this local pixel space (2x the photo's, so text
// and icons have room) and mapped onto the quad by a homography.
export const PHONE_LOCAL_W = 270;
export const PHONE_LOCAL_H = 600;
// The screen's rounded corners (~12 photo px) and the notch (~59 x 12 photo px).
export const PHONE_CORNER_RADIUS = 26;
export const PHONE_NOTCH = { w: 118, h: 26 };

// How the photo is framed (see chillGeometry.js `computeFraming`). `keep` is the
// whole span we try to show — from the man's hammock on the left to the photo's
// right edge, where the sea, the sun glitter and the shore waves are — so the
// waves are actually on screen (an earlier framing centred on the man and the
// phone cropped everything right of x~2085 out of a 1600x900 window, shore
// included). The phone is ~300px tall and is sized to ~26% of the window's height
// when there is room, but fitting `keep` into the width usually wins (~22%).
// Where the window is too tall for that (a covering photo is narrower than
// `keep`), the view is centred on `keep` and the right edge is cropped first;
// `must` is what must stay in view even then: the man's head and headphones, the
// phone and the hammock's right side. (`must` is not used by computeFraming; the
// tests and docs hold the framing to it.) Covering the window always wins.
export const BEACH_FRAMING = {
  sceneW: BEACH_W,
  sceneH: BEACH_H,
  keep: { x0: 380, y0: 290, x1: 2752, y1: 900 },
  must: { x0: 600, y0: 290, x1: 1700, y1: 900 },
  focus: { size: 300, axis: 'h', fraction: 0.26 },
  maxUpscale: 1.6,
  focusY: 0.5,
};

// ── The swing ──────────────────────────────────────────────────────────────
// The hammock, the man and the phone sway together as ONE body (a mask of exactly
// that, beach-body.png), and ONE definition drives both halves of it so they cannot
// drift apart: the photo shader shifts the masked body by `swayAt(t)` weighted by
// position, and the phone's screen — a DOM overlay — is translated by the same
// amount at its own position, so it stays glued to the phone in the man's hands.
//
// What makes it read as a real hammock rather than a slide:
//  * A hammock hangs between two trees and swings across its axis, which from
//    here is partly toward the camera: the movement is a gentle ELLIPSE, not a
//    line. The sideways part (dx) grows with distance below the horizon (nothing
//    at the anchors, the most low in the frame); the vertical part (dy) is
//    strongest where the man is and fades to nothing toward the anchor on the right
//    trunk, a little less at the far left where the hammock runs out of frame. They
//    are a quarter-cycle out of phase.
//  * It never repeats mechanically: two incommensurate periods, a quiet third, and
//    an amplitude that drifts slowly over ~37s.
//  * The ropes that hang freely (the bundles, the tassel) lag the body by ~0.6s and
//    swing more at the tips, like the pendulums they are (`hang`).
// Amplitudes are in photo px at full weight.
export const SWAY = {
  ampX: 9, ampY: 6, ampHang: 7, hangLagS: 0.6,
  // sideways weight: 0 at the horizon -> 1 low in the frame
  y0: 340, y1: 1100,
  // vertical weight along the hammock: fades to 0 at the right-hand anchor (x anchorX),
  // peaks over the man (x midX..1500), and is leftFloor at the left edge of the frame
  anchorX: 2150, midX: 900, leftFloor: 0.55,
};

// The phone's screen centre, where the overlay samples those weights.
export const PHONE_CENTER_X = (PHONE_SCREEN_QUAD[0][0] + PHONE_SCREEN_QUAD[1][0] + PHONE_SCREEN_QUAD[2][0] + PHONE_SCREEN_QUAD[3][0]) / 4;
export const PHONE_CENTER_Y = (PHONE_SCREEN_QUAD[0][1] + PHONE_SCREEN_QUAD[3][1]) / 2;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
// GLSL's smoothstep (edge0 < edge1)
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// Sideways weight by height (orig px): 0 at the horizon, 1 low in the frame.
export const swayRampX = (y) => clamp01((y - SWAY.y0) / (SWAY.y1 - SWAY.y0));
// Vertical weight by x: 0 at the anchor, 1 over the man, leftFloor at the far left.
export const swayProfileY = (x) => (1 - smooth(1500, SWAY.anchorX, x)) * (SWAY.leftFloor + (1 - SWAY.leftFloor) * smooth(0, SWAY.midX, x));

// The same two weights as GLSL, built from the constants above so the shader and the
// phone overlay can never disagree about them.
const f = (n) => Number(n).toFixed(1);
export const SWAY_GLSL = `
float swayRampX(float y) { return clamp((y - ${f(SWAY.y0)}) / ${f(SWAY.y1 - SWAY.y0)}, 0.0, 1.0); }
float swayProfileY(float x) {
  return (1.0 - smoothstep(1500.0, ${f(SWAY.anchorX)}, x)) * (${SWAY.leftFloor.toFixed(3)} + ${(1 - SWAY.leftFloor).toFixed(3)} * smoothstep(0.0, ${f(SWAY.midX)}, x));
}`;

const TAU = 2 * Math.PI;
// the swing's rhythm: two incommensurate periods and a quiet third
const rhythm = (t) => Math.sin(TAU * t / 6.4) + 0.35 * Math.sin(TAU * t / 9.7 + 0.9) + 0.10 * Math.sin(TAU * t / 3.9 + 2.1);
// the same rhythm a quarter-cycle on (the other axis of the ellipse)
const rhythmQuad = (t) => Math.sin(TAU * t / 6.4 - 1.5) + 0.30 * Math.sin(TAU * t / 9.7 + 1.9);
// the amplitude drifts slowly: the swing is never quite the same twice
const drift = (t) => 0.82 + 0.18 * Math.sin(TAU * t / 37 + 1.1);

export function swayAt(tSec) {
  return {
    dx: SWAY.ampX * drift(tSec) * rhythm(tSec) / 1.45,
    dy: SWAY.ampY * drift(tSec) * rhythmQuad(tSec) / 1.3,
    // the hanging ropes: the same swing, a little late
    hang: SWAY.ampHang * drift(tSec - SWAY.hangLagS) * rhythm(tSec - SWAY.hangLagS) / 1.45,
  };
}
