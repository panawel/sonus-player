import { createTypingClock, breathAt, lightningAt, FLASH_GLSL } from './chillRoom.js';
import { parseLyrics, createLyricsClock } from './chillLyrics.js';

// The study-room scene's effects for the shared animated-photo engine
// (ChillLivingPhoto.jsx). The mask (scripts/make-chill-room-mask.py): R window glass, G the
// string-light column, B her back and shoulders.
//
//  * Rain running down the glass: three layers of drops, each in its own columns. A drop
//    GROWS as it slides (it collects water), moves stop-and-go (a monotone curve with
//    near-plateaus: it hangs, then lurches), leaves a thin wet trail and a few beads,
//    and shows the world behind the glass inverted and compressed, as a real drop does.
//    They are sized like the photo's own painted drops (a few px), not bigger.
//    The photo's own painted drops stay as the still, beaded ones.
//  * Rain falling OUTSIDE: faint slanted streaks over the yard, behind the drops.
//  * The coffee's steam: a plume rising from the mug on a scrolling, curling noise field.
//  * Lightning: every so often a soft flash, as a change of EXPOSURE — the picture's own
//    colours brighten (about +30% at the peak, a little more toward the window) with a soft
//    highlight roll-off. Not a white overlay: nothing is mixed toward white.
//  * Breathing: her back and shoulders rise and fall a pixel or two.
//  * The fairy lights twinkle: only the bright bulbs, not the wall around them.
//  * (Her typing is not here: warping the fingers read as wiggling, not typing, so it was
//    removed. She types on the laptop's screen — ChillLaptopScreen — where the text grows
//    while she types and holds still while she stops, which does read.)
export const ROOM_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPhoto;
uniform sampler2D uMask;
uniform float uTime;
uniform float uBreath;      // -1 .. 1
uniform float uFlash;       // 0 .. 1, lightning

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return 0.55 * vnoise(p) + 0.30 * vnoise(p * 2.1 + 7.3) + 0.15 * vnoise(p * 4.3 + 3.1); }

// The coffee's steam: a plume rising from the mug's opening (centre ~(1881, 1026) in photo px).
// Wisps are carried UP by a scrolling noise field, drift sideways on a slow wind that grows with
// height, widen as they rise (the plume is a cone), and fade in near the cup and out near the
// top. Returns 0..1 density. Cheap: it is only evaluated in a small box around the mug.
float steam(vec2 po, float t) {
  float v = (1030.0 - po.y) / 130.0;                       // 0 at the rim -> 1 at the top of the plume
  if (v < -0.1 || v > 1.05) return 0.0;
  float vc = clamp(v, 0.0, 1.0);
  // two slow lazy S-curves of drift (different periods) so it never looks like a clean sine
  float drift = (sin(vc * 4.2 - t * 0.55) * 9.0 + sin(vc * 7.3 - t * 0.9 + 1.7) * 4.0) * (0.25 + vc);
  vec2 q = vec2((po.x - 1881.0 - drift) / 34.0, vc * 3.2 - t * 0.42);
  // domain warp: the wisps curl instead of rising in straight columns
  q.x += (fbm(vec2(q.y * 0.9 + 3.0, t * 0.12)) - 0.5) * 1.6;
  float width = 0.55 + 1.05 * vc;                          // the cone widens with height
  float cone = exp(-pow(q.x / width, 2.0));
  float wisps = smoothstep(0.38, 0.78, fbm(q * vec2(1.6, 1.0) + vec2(0.0, 5.0)));
  float life = smoothstep(-0.02, 0.16, v) * (1.0 - smoothstep(0.50, 1.0, v));
  // near the rim the steam stays inside the opening; it never paints over the mug's body
  float over = smoothstep(1040.0, 1018.0, po.y);
  return clamp(cone * wisps * life * over * 1.15, 0.0, 1.0);
}
${FLASH_GLSL}

// One layer of running drops. Photo px in, (body, trail, bead) masks out; the drop's
// centre and radius come back for the lens.
vec3 dropLayer(vec2 po, float t, float colW, float seed, float cross, float rMin, float rMax, out vec2 centre, out float radius) {
  float col = floor(po.x / colW);
  float n1 = hash(vec2(col, seed));
  float n2 = hash(vec2(col, seed + 7.0));
  float n3 = hash(vec2(col, seed + 13.0));
  float active = 0.30 + 0.55 * n3;                 // the share of its cycle this column has a drop on the glass
  float T = cross * (0.75 + 0.8 * n1);             // seconds for one pass down the glass
  float s = fract(t / T + n2);
  float life = s / active;
  float on = step(life, 1.0);
  float g = clamp(life, 0.0, 1.0);
  float k = 4.0 + floor(n3 * 5.0);
  float gm = g + 0.95 * sin(6.2831853 * k * g) / (6.2831853 * k);      // stop-and-go: monotone, nearly flat k times
  float x = (col + 0.5) * colW + (n1 - 0.5) * colW * 0.45 + sin(gm * 7.0 + n2 * 6.28) * 1.6;
  float y = 40.0 + gm * 960.0;
  radius = mix(rMin, rMax, smoothstep(0.0, 1.0, gm));                  // it collects water as it goes
  centre = vec2(x, y);
  vec2 d = po - centre;
  float body = (1.0 - smoothstep(0.82, 1.0, length(vec2(d.x, d.y * 0.80)) / radius)) * on * smoothstep(0.0, 0.04, g);
  float above = centre.y - po.y;
  float tw = radius * (0.14 + 0.10 * n1);
  float trail = on * step(0.0, above) * (1.0 - smoothstep(0.0, 300.0, above)) * (1.0 - smoothstep(tw * 0.5, tw, abs(d.x))) * (1.0 - smoothstep(0.82, 1.0, g));
  // a few beads left behind along the path
  float by = floor(po.y / 17.0);
  float bh = hash(vec2(col + seed * 3.0, by));
  vec2 bc = vec2((col + 0.5) * colW + (n1 - 0.5) * colW * 0.45 + (bh - 0.5) * 3.0, by * 17.0 + 17.0 * hash(vec2(by, col)));
  float behind = centre.y - bc.y;
  float beadOn = step(0.62, bh) * step(0.0, behind) * (1.0 - smoothstep(0.0, 380.0, behind)) * on;
  float bead = beadOn * (1.0 - smoothstep(0.8, 1.6, length(po - bc) / (1.1 + 1.6 * bh)));
  return vec3(body, trail, bead);
}

// Rain falling outside: thin slanted streaks, a few cells in a grid, drifting down.
float rainStreak(vec2 po, float t, float scale, float speed, float len) {
  vec2 q = vec2(po.x + po.y * 0.18, po.y) / scale;
  q.y -= t * speed;
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float h = hash(cell);
  float w = 0.05 + 0.04 * hash(cell + 3.0);
  float xin = 1.0 - smoothstep(0.0, w, abs(f.x - (0.2 + 0.6 * h)));
  float yin = smoothstep(0.0, 0.1, f.y) * (1.0 - smoothstep(len, len + 0.25, f.y));
  return xin * yin * step(0.55, h);
}

vec3 world(vec2 po) { return texture2D(uPhoto, vec2(po.x / 2752.0, 1.0 - po.y / 1536.0)).rgb; }

// What one drop shows: the world behind the glass, inverted and compressed; a darker rim; a highlight.
vec3 lens(vec2 po, vec2 centre, float radius) {
  vec2 d = po - centre;
  vec3 refr = world(centre - d * 1.7);
  float rim = smoothstep(0.55, 0.98, length(vec2(d.x, d.y * 0.8)) / radius);
  float spec = 1.0 - smoothstep(0.0, 0.42, length(d / radius - vec2(-0.32, -0.38)));
  return refr * (1.0 - 0.28 * rim) + spec * 0.42;
}

void main() {
  vec2 po = vec2(vUv.x * 2752.0, (1.0 - vUv.y) * 1536.0);
  vec3 m = texture2D(uMask, vUv).rgb;
  vec2 uv = vUv;

  // Breathing: her back and shoulders rise and fall (strongest over the shoulder blades,
  // nothing at the neck or the waist), a hair of expansion with it.
  float wb = m.b * smoothstep(770.0, 900.0, po.y) * (1.0 - smoothstep(1100.0, 1300.0, po.y));
  uv.y -= uBreath * 1.8 * wb / 1536.0;
  uv.x -= (po.x - 1100.0) * 0.0006 * uBreath * wb / 2752.0;

  vec3 c = texture2D(uPhoto, uv).rgb;

  // The window: rain falling outside, then the running drops on the glass.
  float glass = m.r;
  if (glass > 0.01) {
    vec2 ca, cb, cc;
    float ra, rb, rc;
    vec3 la = dropLayer(po, uTime, 34.0, 1.0, 34.0, 2.9, 5.4, ca, ra);      // biggest, quick
    vec3 lb = dropLayer(po, uTime, 23.0, 11.0, 52.0, 2.0, 3.6, cb, rb);     // medium
    vec3 lc = dropLayer(po, uTime, 15.0, 23.0, 80.0, 1.3, 2.3, cc, rc);     // small, slow
    float body = max(la.x, max(lb.x, lc.x));
    // falling rain behind everything on the glass
    float streak = max(rainStreak(po, uTime, 46.0, 5.0, 0.7), rainStreak(po + 17.0, uTime, 70.0, 3.2, 0.8));
    c = mix(c, vec3(0.60, 0.65, 0.70), streak * 0.20 * glass * (1.0 - body));
    // wet trails catch a little light; beads are small bright specks
    c += vec3(0.04) * max(la.y, max(lb.y, lc.y)) * glass;
    c = mix(c, vec3(0.97), max(la.z, max(lb.z, lc.z)) * 0.45 * glass);
    // the drops themselves: a lens showing the world behind the glass, inverted and compressed
    if (la.x > 0.01) c = mix(c, lens(po, ca, ra), la.x * glass * 0.92);
    if (lb.x > 0.01) c = mix(c, lens(po, cb, rb), lb.x * glass * 0.92);
    if (lc.x > 0.01) c = mix(c, lens(po, cc, rc), lc.x * glass * 0.92);
  }

  // The coffee's steam, over everything behind the mug (the sill, the window's lower edge).
  if (po.x > 1790.0 && po.x < 1980.0 && po.y > 880.0 && po.y < 1042.0) {
    float st = steam(po, uTime);
    // a soft warm white; a little stronger where the background is dark (it catches the window light)
    float lum0 = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, vec3(0.97, 0.94, 0.90), st * (0.30 + 0.16 * (1.0 - lum0)));
  }

  // The fairy lights: only the bright bulbs twinkle (pixels well above their surroundings).
  float lw = m.g;
  if (lw > 0.01) {
    vec3 k = vec3(0.299, 0.587, 0.114);
    vec2 px = vec2(1.0 / 2752.0, 1.0 / 1536.0) * 9.0;
    float lum = dot(c, k);
    float around = 0.25 * (dot(texture2D(uPhoto, uv + vec2(px.x, 0.0)).rgb, k) + dot(texture2D(uPhoto, uv - vec2(px.x, 0.0)).rgb, k)
                         + dot(texture2D(uPhoto, uv + vec2(0.0, px.y)).rgb, k) + dot(texture2D(uPhoto, uv - vec2(0.0, px.y)).rgb, k));
    float peak = smoothstep(0.10, 0.28, lum - around) * lw;
    vec2 cell = floor(po / 22.0);
    float tw = 0.80 + 0.20 * sin(uTime * (1.1 + hash(cell) * 1.6) + hash(cell + 3.0) * 6.2831);
    c *= 1.0 + peak * (tw - 0.9) * 1.4;
    c += vec3(1.0, 0.62, 0.22) * peak * (tw - 0.85) * 0.12;
  }

  // Lightning: a change of exposure (the same gain the posters and the laptop get).
  if (uFlash > 0.001) c = flashExposure(c, uFlash, po.x);
  gl_FragColor = vec4(c, 1.0);
}`;

const TEST_MODE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test');

export function createRoomFx({ mask }) {
  return {
    frag: ROOM_FRAG,
    masks: [{ uniform: 'uMask', url: mask }],
    // state: the generic typing clock, plus a lyrics clock whenever the current track has lyrics
    create: () => ({ generic: createTypingClock(), lyricsKey: undefined, script: null, lyrics: null }),
    update(t, set, state, live, dt) {
      // the track's own lyrics, when it has some; otherwise the generic typing stays as it was
      if (live.lyrics !== state.lyricsKey) {
        state.lyricsKey = live.lyrics;
        state.script = parseLyrics(live.lyrics);
        state.lyrics = state.script ? createLyricsClock(state.script) : null;
      }
      const lyric = state.lyrics ? state.lyrics.step(dt, !!live.isPlaying) : null;
      const ty = lyric ? { env: lyric.env, typing: lyric.typing, chars: 0, gate: lyric.gate } : state.generic.step(dt, !!live.isPlaying);
      // `?test=1` only (smoke mode is the only thing that passes it): hold the flash at a
      // fixed strength, so a test can measure the exposure change deterministically instead
      // of racing the 0.3s fade.
      const held = window.__sonusFlashOverride;
      const flash = typeof held === 'number' && TEST_MODE ? held : lightningAt(t);
      set.f('uBreath', breathAt(t));
      set.f('uFlash', flash);
      // the laptop's document follows ty; the posters and the laptop flash with the room
      return { ...ty, flash, lyric: lyric ? { script: state.script, lineIndex: lyric.lineIndex, partial: lyric.partial, cycle: lyric.cycle } : null };
    },
  };
}
