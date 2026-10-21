// The study-room scene (assets/chill/room.jpg, 2752x1536): a girl at a desk by a rainy
// window, headphones on, typing on a laptop, posters and polaroids on the walls.
// Chill mode makes it alive (chillRoomFx.js, masks from scripts/make-chill-room-mask.py):
// rain running down the glass and falling outside, her typing — and stopping — her
// breathing, twinkling string lights; and draws the song's artwork onto some of the
// posters (ChillPosters.jsx) and a live document onto the laptop's screen
// (ChillLaptopScreen.jsx). Everything here was measured from THIS photo on 1.0-1.6x
// zooms; a different photo needs it redone.

export const ROOM_W = 2752;
export const ROOM_H = 1536;

// How the photo is framed (chillGeometry.js `computeFraming`): a wide composition, so
// show nearly all of it — covering the window wins — and keep the window and the girl
// in frame (`must`) when the window is too tall for the whole width.
export const ROOM_FRAMING = {
  sceneW: ROOM_W,
  sceneH: ROOM_H,
  // vertically, what matters is the window's top (y 40) down to the hands on the keys
  // (y ~1130): an ultrawide window can't show the whole height, and loses floor, not window
  keep: { x0: 150, y0: 40, x1: 2650, y1: 1140 },
  must: { x0: 880, y0: 40, x1: 2300, y1: 1140 },
  focus: { size: 2752, axis: 'w', fraction: 1 },
  maxUpscale: 1.6,
  focusY: 0.5,
};

// ── Posters that show the song's artwork ───────────────────────────────────
// The spots live in chillRoomPosters.json (quads in photo px, [TL, TR, BR, BL], measured
// against the original photo at 2-6x zoom — an earlier, coarser pass left the art not
// quite filling its print — plus a `look` each, so the wall isn't one image pasted 25
// times). `light` is refreshed by scripts/make-chill-room-mask.py from the room's own
// lighting around each print, so the artwork takes on the room's colour and dimness.
// Looks: `full` the whole cover cropped to the print's shape; `mono` a black-and-white
// print, like most of the wall; `detail` a zoomed-in part of the cover (`zoom`, `at` in %).
import postersData from './chillRoomPosters.json';
// Only prints whose fit passed (scripts/fit-chill-room-posters.py: every side measured against
// the photo's real edge) get artwork; a print that could not be fitted keeps its original.
export const ALL_POSTERS = postersData.posters;
export const POSTERS = ALL_POSTERS.filter((p) => p.fit && p.fit.ok);
export const POSTER_LOCAL_W = 240;
// A poster's local height follows its own shape (the quad's average aspect).
export function posterLocalSize(quad) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const w = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2;
  const h = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2;
  return { w: POSTER_LOCAL_W, h: Math.max(40, Math.round(POSTER_LOCAL_W * h / w)) };
}

// ── The laptop's screen ────────────────────────────────────────────────────
// The display's four corners [TL, TR, BR, BL] in photo px; the document is drawn in a
// 480x330 local space and mapped onto it, as the phone's screen is in the hammock scene.
// Measured on 6x crops of each corner: the lit glass ends at the dock's lower edge, a hair
// outside the quad that was first used (which let the photo's own dock peek out).
export const LAPTOP_SCREEN_QUAD = [[1527.5, 852.5], [1803.5, 877], [1765.2, 1086.5], [1491, 1041.5]];
export const LAPTOP_LOCAL_W = 480;
export const LAPTOP_LOCAL_H = 330;

// ── Typing, and stopping ───────────────────────────────────────────────────
// She types for a few seconds, then stops for a couple, over and over; the lengths vary
// but are fixed (a hash of the segment's index), so it is testable. The clock only
// advances while she is "on": pausing the music makes her stop (the gate eases down over
// ~0.35s, the schedule freezes where it was) and playing resumes it.
export const TYPING = { typeMin: 3.2, typeVar: 4.2, restMin: 1.8, restVar: 1.8, attackS: 0.25, releaseS: 0.35, charsPerS: 6.5, gateTauS: 0.35 };

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

export function typingSegment(i) {
  return { type: TYPING.typeMin + TYPING.typeVar * hash(i * 2 + 1), rest: TYPING.restMin + TYPING.restVar * hash(i * 2 + 2) };
}

export function createTypingClock() {
  let seg = 0;      // which type+rest segment we are in
  let u = 0;        // seconds into it
  let gate = 0;     // 1 while she is on (music playing), eased
  let chars = 0;    // characters "typed" so far (drives the laptop's document)
  return {
    step(dt, playing) {
      gate += ((playing ? 1 : 0) - gate) * (1 - Math.exp(-dt / TYPING.gateTauS));
      let adv = dt * gate;
      while (adv > 0) {
        const s = typingSegment(seg);
        const remain = s.type + s.rest - u;
        if (adv < remain) { u += adv; adv = 0; } else { adv -= remain; seg += 1; u = 0; }
      }
      const s = typingSegment(seg);
      const e = u < s.type ? smooth(0, TYPING.attackS, u) * (1 - smooth(s.type - TYPING.releaseS, s.type, u)) : 0;
      const env = e * gate;
      chars += dt * TYPING.charsPerS * env;
      return { env, chars, gate, typing: env > 0.05, seg, u };
    },
  };
}

// ── Breathing ──────────────────────────────────────────────────────────────
// A slow ~4.8s breath, a little uneven (a faint second harmonic, a slow drift in depth).
// -1 (out) .. +1 (in).
export function breathAt(t) {
  const TAU = 2 * Math.PI;
  return (Math.sin(TAU * t / 4.8) + 0.18 * Math.sin(TAU * t / 2.4 + 0.7)) * (0.85 + 0.15 * Math.sin(TAU * t / 19)) / 1.18;
}

// ── Lightning ──────────────────────────────────────────────────────────────
// A storm flash is a change of EXPOSURE, not a white overlay: for a moment the room's own
// colours get brighter, as they would under a real flash, and settle back. `lightningAt(t)`
// is the flash's strength 0..1; `FLASH.gain` is how much brighter the picture is at 1
// (+30%: soft). It is deterministic (a hash of the event's index), so it is testable: the
// first flash comes soon after the scene appears (so you see it), the next ones 11-26s
// apart. Each is a soft flicker — a main pulse that rises over ~60ms and fades over ~0.3s,
// then a weaker echo ~0.25s later, sometimes a faint third.
export const LIGHTNING = { first: 4.5, minGap: 11, varGap: 15 };

// The exposure model, shared by the photo's shader and the DOM overlays (posters, laptop) so
// everything brightens by the same amount: gain = 1 + FLASH.gain * flash * weight(x), where
// weight rises a little toward the window (the source) and is 1.0 around the laptop.
export const FLASH = { gain: 0.30, weightBase: 0.82, weightWindow: 0.28, x0: 500, x1: 2200, rollFrom: 0.78, rollSoft: 0.22 };
export const flashWeight = (x) => FLASH.weightBase + FLASH.weightWindow * smooth(FLASH.x0, FLASH.x1, x);
export const flashGain = (flash, x) => 1 + FLASH.gain * flash * flashWeight(x);
// The same, as GLSL, built from the constants so the shader cannot disagree with the DOM.
// The soft roll-off keeps highlights from flat-clipping to white: above `rollFrom` the
// curve bends toward 1.0. It is applied to the INCREASE only (out = c + (roll(v) - roll(c))
// scaled by (1-c)/(1-roll(c))), never to the colour itself — rolling the colour would darken
// a highlight at a weak flash, a dip at the start of every flash. The scale means a bright
// pixel is lifted toward white but never clipped to it, and white itself does not move.
const g1 = (n) => Number(n).toFixed(3);
export const FLASH_GLSL = `
float flashWeight(float x) { return ${g1(FLASH.weightBase)} + ${g1(FLASH.weightWindow)} * smoothstep(${g1(FLASH.x0)}, ${g1(FLASH.x1)}, x); }
vec3 flashRoll(vec3 v) {
  vec3 over = max(v - ${g1(FLASH.rollFrom)}, 0.0);
  return min(v, vec3(${g1(FLASH.rollFrom)})) + ${g1(1 - FLASH.rollFrom)} * (1.0 - exp(-over / ${g1(FLASH.rollSoft)}));
}
vec3 flashExposure(vec3 c, float flash, float x) {
  vec3 v = c * (1.0 + ${g1(FLASH.gain)} * flash * flashWeight(x));
  // the increase, scaled so a highlight approaches white but never reaches it: (1-c)/(1-roll(c))
  return c + (flashRoll(v) - flashRoll(c)) * (1.0 - c) / max(1.0 - flashRoll(c), 0.0001);
}`;

const lightningStarts = [LIGHTNING.first];
function lightningStart(k) {
  while (lightningStarts.length <= k) {
    const n = lightningStarts.length;
    lightningStarts.push(lightningStarts[n - 1] + LIGHTNING.minGap + LIGHTNING.varGap * hash(n * 3 + 5));
  }
  return lightningStarts[k];
}

export function lightningEvent(k) {
  const pulses = [{ at: 0, amp: 1, tau: 0.28 }, { at: 0.22 + 0.08 * hash(k * 5 + 1), amp: 0.38 + 0.14 * hash(k * 5 + 2), tau: 0.25 }];
  if (hash(k * 5 + 3) > 0.55) pulses.push({ at: 0.62 + 0.16 * hash(k * 5 + 4), amp: 0.22 + 0.10 * hash(k * 5 + 5), tau: 0.30 });
  return { start: lightningStart(k), scale: 0.82 + 0.18 * hash(k * 5 + 6), pulses };
}

export function lightningAt(t) {
  if (t < LIGHTNING.first) return 0;
  let k = 0;
  while (lightningStart(k + 1) <= t) k += 1;
  const ev = lightningEvent(k);
  const u = t - ev.start;
  let f = 0;
  for (const p of ev.pulses) {
    const d = u - p.at;
    if (d < 0) continue;
    f = Math.max(f, p.amp * smooth(0, 0.06, d) * Math.exp(-d / p.tau));
  }
  return clamp01(f * ev.scale);
}
