// The title strip's "bubble" motion: a real damped spring, not a cubic-bezier.
//
// A spring's step response is sampled into a CSS `linear()` easing, which Chromium
// (Electron 41) supports; it is played with the Web Animations API (see Bubble.jsx).
// Entrances use the spring and overshoot a little; exits are a faster, quiet ease
// with no overshoot (Apple's items leave quickly). The three numbers worth retuning
// by feel are STIFFNESS, DAMPING and STAGGER_MS.

export const BUBBLE = {
  stiffness: 400,       // higher = snappier
  damping: 24,          // lower = bouncier (24 at stiffness 400 is ~10% overshoot)
  exitFactor: 0.55,     // an exit lasts this fraction of an entrance
  exitMinMs: 180,
  staggerMs: 45,        // delay between elements entering together
  startScale: 0.3,
  exitScale: 0.35,
  slidePx: 14,          // enters from this far toward its neighbours, then separates
  blurPx: 8,
  rimAlpha: 0.7,        // the entrance's bright inner rim (the glass catching light)
  exitEase: 'cubic-bezier(0.4, 0, 1, 1)',
  widthExitEase: 'cubic-bezier(0.4, 0, 0.2, 1)',
};

const SAMPLES = 36;
const cache = new Map();

// Unit-mass damped spring from 0 towards 1:  x'' = -k (x - 1) - c x'.
// Returns the CSS easing, how long it takes to settle, and the overshoot (%).
export function solveSpring(stiffness = BUBBLE.stiffness, damping = BUBBLE.damping) {
  const key = `${stiffness}/${damping}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const dt = 1 / 480;
  const MAX_T = 3;
  const HOLD = 60; // steps the response must stay inside the tolerance to count as settled
  let x = 0, v = 0, t = 0, calm = 0, peak = 0;
  const pts = [0];
  while (t < MAX_T && calm < HOLD) {
    v += (-stiffness * (x - 1) - damping * v) * dt; // semi-implicit Euler: stable for springs
    x += v * dt;
    t += dt;
    if (x > peak) peak = x;
    calm = Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.02 ? calm + 1 : 0;
    pts.push(x);
  }
  const usable = pts.length - 1 - (calm >= HOLD ? HOLD : 0);
  const samples = [];
  for (let i = 0; i <= SAMPLES; i++) samples.push(pts[Math.min(pts.length - 1, Math.round((i / SAMPLES) * usable))]);
  samples[SAMPLES] = 1; // land exactly, whatever the last sample was
  const result = {
    easing: `linear(${samples.map((s) => s.toFixed(4)).join(', ')})`,
    durationMs: Math.max(250, Math.round(usable * dt * 1000)),
    overshootPct: Math.max(0, (peak - 1) * 100),
  };
  cache.set(key, result);
  return result;
}

export const bubbleSpring = () => solveSpring(BUBBLE.stiffness, BUBBLE.damping);
export const bubbleExitMs = () => Math.max(BUBBLE.exitMinMs, Math.round(bubbleSpring().durationMs * BUBBLE.exitFactor));
