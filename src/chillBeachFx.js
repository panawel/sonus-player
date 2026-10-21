import { swayAt, SWAY_GLSL } from './chillBeach.js';

// The hammock scene's effects for the shared animated-photo engine
// (ChillLivingPhoto.jsx): palms sway, the sea moves in waves, the shore washes up and
// back, the glitter twinkles, and the hammock + man + phone swing as one body. Masks:
// `mask` (scripts/make-chill-beach-mask.py): R palm weight, G sea weight, B shore
// weight; `body`: R the hammock + man + phone, G freely hanging ropes, B hang factor.
// The sea's depth is just a function of y, computed in the shader.
//
// The shader source below is the hammock's alone; what is generic lives in the engine.

export const BEACH_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPhoto;
uniform sampler2D uMask;
uniform sampler2D uBody;
uniform float uTime;
uniform vec2 uSway;           // the swing, in photo px at full weight (dx right, dy down)
uniform float uHang;          // extra sideways swing of the freely hanging ropes (lagged)
${SWAY_GLSL}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec4 m = texture2D(uMask, vUv);
  float palm = m.r, sea = m.g, shore = m.b;
  vec2 uv = vUv;
  float sx = vUv.x * 1.79;                       // x in the picture's own aspect, so noise isn't stretched

  // The swing: the hammock, the man and the phone move as one body (chillBeach.js
  // defines the motion and the two position weights; the phone's overlay applies the
  // same offset). Sideways grows toward the bottom of the frame, vertical peaks over
  // the man and fades to nothing at the anchor; the freely hanging ropes lag and swing
  // more at the tips. bd = (body, hanging weight, hang factor 0 attachment -> 1 tip).
  vec3 bd = texture2D(uBody, vUv).rgb;
  float xo = vUv.x * 2752.0;
  float yo = (1.0 - vUv.y) * 1536.0;
  uv.x -= (uSway.x * bd.r * swayRampX(yo) + uHang * bd.g * bd.b) / 2752.0;
  uv.y += (uSway.y * bd.r * swayProfileY(xo)) / 1536.0;

  // Palms: a slow wind sway plus a faster flutter, with a phase that varies
  // across the picture so neighbouring fronds don't move as one.
  float ph = vUv.x * 9.0 + vUv.y * 4.0;
  vec2 sway = vec2(sin(uTime * 0.85 + ph) * 0.0030 + sin(uTime * 2.1 + ph * 2.3) * 0.0011,
                   cos(uTime * 0.65 + ph * 1.4) * 0.0016);
  uv += sway * palm;

  // Sea: wave trains travelling toward the viewer. z is 0 at the horizon and 1 at
  // the shore (a function of y: the horizon is at ~340px, the shore at ~760px),
  // waves are finer and fainter far away, and the horizon itself stays still.
  float yTop = (1.0 - vUv.y) * 1536.0;
  float z = clamp((yTop - 340.0) / 420.0, 0.0, 1.0);
  float amp = sea * smoothstep(0.0, 0.35, z) * (0.35 + 0.65 * z);
  float warp = vnoise(vec2(sx * 5.0 - uTime * 0.06, z * 6.0)) * 2.4;      // breaks the rows up
  float phase = z * 46.0 - uTime * 1.05 + warp;
  float crest = sin(phase);
  float swell = sin(uTime * 0.42 + sx * 4.0 + z * 3.0);                    // a slow, broad lift
  uv.y += (crest * 0.0016 + swell * 0.0010) * amp;
  uv.x += cos(phase * 0.6 + sx * 9.0) * 0.00035 * amp;

  // Shore: the water washes up the sand and drains back. Each stretch of shore is
  // on its own beat; the advance is quick, the retreat slow.
  float w = fract(uTime / 6.8 + sx * 0.55 + vnoise(vec2(sx * 4.0, 1.7)) * 0.35);
  float surge = w < 0.38 ? smoothstep(0.0, 0.38, w) : 1.0 - smoothstep(0.38, 1.0, w);
  uv.y += surge * 0.0105 * shore;                                          // content slides down the beach

  vec4 c = texture2D(uPhoto, uv);

  // Wave crests catch a little more light, troughs a little less.
  c.rgb *= 1.0 + 0.06 * smoothstep(0.55, 1.0, crest) * amp - 0.04 * smoothstep(0.6, 1.0, -crest) * amp;
  // Lacy foam on the leading edge, never on dry sand; wet sand darkens as the water covers it.
  float sand = smoothstep(0.08, 0.20, c.r - c.b);
  // stretched ALONG the shore (a tall texture reads as vertical streaks)
  float lace = vnoise(vec2(sx * 70.0 + uTime * 0.05, vUv.y * 300.0 - uTime * 0.20));
  float foam = smoothstep(0.58, 0.82, lace) * shore * surge * (1.0 - sand);
  c.rgb = mix(c.rgb, vec3(0.97, 0.985, 0.97), foam * 0.30);
  c.rgb *= 1.0 - 0.07 * shore * sand * surge;

  // Sun glitter: only the water's bright SPECKS twinkle — pixels well above their
  // surroundings. (Keying on brightness alone made the whole nearly-white right-hand
  // side speckle like grain.)
  vec3 lw = vec3(0.299, 0.587, 0.114);
  float lum = dot(c.rgb, lw);
  vec2 px = vec2(1.0 / 2752.0, 1.0 / 1536.0) * 7.0;
  float around = 0.25 * (dot(texture2D(uPhoto, uv + vec2(px.x, 0.0)).rgb, lw) + dot(texture2D(uPhoto, uv - vec2(px.x, 0.0)).rgb, lw)
                       + dot(texture2D(uPhoto, uv + vec2(0.0, px.y)).rgb, lw) + dot(texture2D(uPhoto, uv - vec2(0.0, px.y)).rgb, lw));
  float spark = smoothstep(0.03, 0.12, lum - around) * sea;
  vec2 cell = floor(vUv * vec2(1100.0, 620.0));
  float tw = 0.5 + 0.5 * sin(uTime * (2.0 + hash(cell) * 3.0) + hash(cell + 7.0) * 6.2831);
  c.rgb += spark * tw * 0.10;
  c.rgb *= 1.0 - spark * (1.0 - tw) * 0.08;
  gl_FragColor = vec4(c.rgb, 1.0);
}`;

// The per-frame side: set the swing's uniforms and hand the values back, so the phone's
// overlay (DOM, not in the shader) can be given the same offset.
export function createBeachFx({ mask, body }) {
  return {
    frag: BEACH_FRAG,
    masks: [{ uniform: 'uMask', url: mask }, { uniform: 'uBody', url: body }],
    update(t, set) {
      const sw = swayAt(t);
      set.v2('uSway', sw.dx, sw.dy);
      set.f('uHang', sw.hang);
      return sw;
    },
  };
}
