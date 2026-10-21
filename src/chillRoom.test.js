import { describe, it, expect } from 'vitest';
import { applyHomography, homographyFromQuad } from './chillGeometry.js';
import {
  ROOM_W, ROOM_H, POSTERS, ALL_POSTERS, posterLocalSize, LAPTOP_SCREEN_QUAD, LAPTOP_LOCAL_W, LAPTOP_LOCAL_H,
  TYPING, typingSegment, createTypingClock, breathAt, LIGHTNING, lightningAt, lightningEvent, FLASH, FLASH_GLSL, flashWeight, flashGain,
} from './chillRoom.js';

// Run a clock for `seconds` in 1/30s steps; returns the samples.
const run = (clock, seconds, playing = true) => Array.from({ length: Math.round(seconds * 30) }, () => clock.step(1 / 30, playing));

describe('the study-room typing clock', () => {
  it('has segments whose lengths vary but stay within the stated ranges, and are fixed', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const s = typingSegment(i);
      expect(s.type).toBeGreaterThanOrEqual(TYPING.typeMin);
      expect(s.type).toBeLessThan(TYPING.typeMin + TYPING.typeVar);
      expect(s.rest).toBeGreaterThanOrEqual(TYPING.restMin);
      expect(s.rest).toBeLessThan(TYPING.restMin + TYPING.restVar);
      expect(typingSegment(i)).toEqual(s); // deterministic
      seen.add(s.type.toFixed(3));
    }
    expect(seen.size).toBeGreaterThan(150); // genuinely varied
  });

  it('types for a few seconds, stops for a couple, over and over', () => {
    const samples = run(createTypingClock(), 90);
    // collect the lengths of typing and still runs
    const runs = [];
    for (const s of samples) {
      const kind = s.env > 0.5 ? 'type' : s.env < 0.02 ? 'still' : null;
      if (!kind) continue;
      if (runs.length && runs[runs.length - 1].kind === kind) runs[runs.length - 1].n += 1; else runs.push({ kind, n: 1 });
    }
    const typing = runs.filter(r => r.kind === 'type').map(r => r.n / 30);
    const still = runs.filter(r => r.kind === 'still').map(r => r.n / 30);
    expect(typing.length).toBeGreaterThanOrEqual(8);
    expect(still.length).toBeGreaterThanOrEqual(8);
    for (const t of typing.slice(0, -1)) { expect(t).toBeGreaterThan(2.4); expect(t).toBeLessThan(8); }   // "a few seconds" (minus the ramps)
    for (const t of still.slice(1, -1)) { expect(t).toBeGreaterThan(1.8); expect(t).toBeLessThan(4.8); }  // "a couple of seconds"
  });

  it('eases in and out, never jumping', () => {
    const samples = run(createTypingClock(), 60);
    for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i].env - samples[i - 1].env)).toBeLessThan(0.2);
    expect(Math.max(...samples.map(s => s.env))).toBeCloseTo(1, 1);
    expect(Math.min(...samples.map(s => s.env))).toBe(0);
  });

  it('stops typing when the music is paused, and resumes where it was when it plays again', () => {
    const c = createTypingClock();
    run(c, 1.5); // part-way through the first typing spell
    const before = c.step(1 / 30, true);
    expect(before.env).toBeGreaterThan(0.9);
    const paused = run(c, 2, false);
    expect(paused[paused.length - 1].env).toBeLessThan(0.01);
    const charsWhenStopped = paused[paused.length - 1].chars;
    const stillPaused = run(c, 5, false);
    expect(stillPaused.every(s => s.env < 0.01)).toBe(true);        // stays stopped
    expect(stillPaused[stillPaused.length - 1].chars - charsWhenStopped).toBeLessThan(0.05); // types nothing visible (the gate's tail is a few thousandths of a character)
    const resumed = run(c, 1, true);
    expect(resumed[resumed.length - 1].env).toBeGreaterThan(0.5);   // and carries on
  });

  it('types characters only while typing', () => {
    const c = createTypingClock();
    const samples = run(c, 40);
    for (let i = 1; i < samples.length; i++) {
      const dChars = samples[i].chars - samples[i - 1].chars;
      expect(dChars).toBeGreaterThanOrEqual(0);
      if (samples[i].env < 0.01) expect(dChars).toBeLessThan(0.003); // the easing tail only
    }
    expect(samples[samples.length - 1].chars).toBeGreaterThan(40); // ~6.5 chars/s while typing
  });

  it('survives a long frame (a stalled tab) by walking whole segments', () => {
    const c = createTypingClock();
    const s = c.step(0.25, true);
    expect(Number.isFinite(s.env) && Number.isFinite(s.chars)).toBe(true);
    expect(() => { for (let i = 0; i < 2000; i++) c.step(0.25, true); }).not.toThrow();
  });
});

describe('breathing', () => {
  it('stays within -1..1 and really goes both ways, slowly', () => {
    const v = Array.from({ length: 1200 }, (_, i) => breathAt(i * 0.05));
    expect(Math.max(...v)).toBeLessThanOrEqual(1.0001);
    expect(Math.min(...v)).toBeGreaterThanOrEqual(-1.0001);
    expect(Math.max(...v)).toBeGreaterThan(0.6);
    expect(Math.min(...v)).toBeLessThan(-0.6);
    for (let i = 1; i < v.length; i++) expect(Math.abs(v[i] - v[i - 1])).toBeLessThan(0.15); // smooth
  });
});

describe('the study-room calibration', () => {
  it('keeps every poster quad inside (or on the edge of) the photo, with a sane shape', () => {
    for (const p of POSTERS) {
      expect(p.quad).toHaveLength(4);
      // a corner may sit a few px outside the photo: a print cut by the frame continues past it
      for (const [x, y] of p.quad) { expect(x).toBeGreaterThanOrEqual(-8); expect(x).toBeLessThanOrEqual(ROOM_W + 8); expect(y).toBeGreaterThanOrEqual(-8); expect(y).toBeLessThanOrEqual(ROOM_H + 8); }
      const { w, h } = posterLocalSize(p.quad);
      expect(w).toBeGreaterThan(40); expect(h).toBeGreaterThan(40);
      // convex, clockwise (positive area in screen coordinates)
      let area = 0;
      for (let i = 0; i < 4; i++) { const [x1, y1] = p.quad[i], [x2, y2] = p.quad[(i + 1) % 4]; area += x1 * y2 - x2 * y1; }
      expect(area).toBeGreaterThan(5000);
      const H = homographyFromQuad(w, h, p.quad);
      const [cx, cy] = applyHomography(H, w / 2, h / 2);
      expect(Number.isFinite(cx) && Number.isFinite(cy)).toBe(true);
    }
  });

  it('only draws artwork on prints whose fit passed, and the fit data is complete and strict', () => {
    expect(ALL_POSTERS.length).toBeGreaterThanOrEqual(POSTERS.length);
    expect(POSTERS.every(p => p.fit && p.fit.ok === true)).toBe(true);
    expect(POSTERS.length).toBeGreaterThanOrEqual(18);        // most prints fit
    // the ones that could not be fitted are kept out rather than drawn wrongly
    expect(ALL_POSTERS.filter(p => !p.fit.ok).length).toBe(ALL_POSTERS.length - POSTERS.length);
    for (const p of ALL_POSTERS) {
      expect(p.seed).toHaveLength(4);
      expect(p.fit.blur).toBeGreaterThanOrEqual(0.4);          // measured from the print's own edge...
      expect(p.fit.blur).toBeLessThanOrEqual(5);               // ...and sane
      expect(p.fit.sides).toHaveLength(4);
      expect(Array.isArray(p.trust ?? [])).toBe(true);
    }
    for (const p of POSTERS) {
      for (const s of p.fit.sides) {
        if (s.frame) continue;
        expect(s.ok).toBe(true);
        expect(s.rms).toBeLessThanOrEqual(0.7);                // the side is a straight edge, measured to <0.7px
        expect(s.inlier).toBeGreaterThanOrEqual(0.6);
        expect(s.strength).toBeGreaterThanOrEqual(4);          // a real edge, not noise
        expect(Math.abs(s.peak)).toBeLessThanOrEqual(0.5);     // the gradient peaks on the fitted line
        // no dark trough + brighter frame edge just outside it: that is the signature of a fit sitting on an
        // INTERIOR edge (lettering, a dark border band) a few px inside the print's real edge
        expect(s.outer ?? null, `${p.id}: outer edge`).toBe(null);
      }
      // the fit stayed near its reviewed seed (it did not slide onto an unrelated edge)
      const shift = Math.max(...p.quad.map((q, i) => Math.hypot(q[0] - p.seed[i][0], q[1] - p.seed[i][1])));
      expect(shift).toBeLessThanOrEqual(p.fit.shift + 0.2);
      expect(p.fit.shift).toBeLessThanOrEqual(9.5);
    }
  });

  it('has many distinct posters in a variety of looks, with the room\'s lighting measured for each', () => {
    expect(new Set(POSTERS.map(p => p.id)).size).toBe(POSTERS.length);
    expect(POSTERS.length).toBeGreaterThanOrEqual(18);
    expect(POSTERS.length).toBeLessThanOrEqual(30);
    expect(new Set(POSTERS.map(p => p.look)).size).toBeGreaterThanOrEqual(3);
    for (const p of POSTERS.filter(q => q.look === 'detail')) { expect(p.zoom).toBeGreaterThanOrEqual(1.5); expect(p.zoom).toBeLessThanOrEqual(2.2); expect(p.at).toHaveLength(2); }
    for (const p of POSTERS) {
      expect(p.light, `light for ${p.id}`).toBeTruthy();
      expect(p.light.tint).toHaveLength(3);
      expect(Math.max(...p.light.tint)).toBe(255);
      for (const side of [p.light.left, p.light.right]) { expect(side).toHaveLength(3); for (const v of side) { expect(v).toBeGreaterThan(0.4); expect(v).toBeLessThanOrEqual(1); } }
      expect(p.light.dim).toBeGreaterThanOrEqual(0.58);
      expect(p.light.dim).toBeLessThanOrEqual(0.9);
    }
    // the wall near the fairy lights is warm: its prints are redder than the cool far-left ones
    const warm = POSTERS.find(p => p.id === 'knicky').light.tint, cool = POSTERS.find(p => p.id === 'pola-3').light.tint;
    expect(warm[2]).toBeLessThan(cool[2]);
  });

  it('keeps posters off each other: no two quads overlap by more than a sliver', () => {
    // sample a grid of points across A (bilinear in its corners) and ask whether B contains them
    const inside = (q, [x, y]) => { let s = 0; for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; const c = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1); if (c < 0) s -= 1; else s += 1; } return Math.abs(s) === 4; };
    const at = (q, u, v) => [0, 1].map(k => (1 - v) * ((1 - u) * q[0][k] + u * q[1][k]) + v * ((1 - u) * q[3][k] + u * q[2][k]));
    for (let i = 0; i < POSTERS.length; i++) for (let j = 0; j < POSTERS.length; j++) {
      if (i === j) continue;
      let hit = 0, n = 0;
      for (let a = 0; a <= 20; a++) for (let b = 0; b <= 20; b++) { n += 1; if (inside(POSTERS[j].quad, at(POSTERS[i].quad, a / 20, b / 20))) hit += 1; }
      expect(hit / n, `${POSTERS[i].id} inside ${POSTERS[j].id}`).toBeLessThan(0.03);
    }
  });

  it('maps the laptop screen as a near-rectangle of a plausible size on the desk', () => {
    const [tl, tr, br, bl] = LAPTOP_SCREEN_QUAD;
    expect(Math.hypot(tr[0] - tl[0], tr[1] - tl[1])).toBeGreaterThan(240);
    expect(Math.hypot(tr[0] - tl[0], tr[1] - tl[1])).toBeLessThan(320);
    expect(Math.hypot(bl[0] - tl[0], bl[1] - tl[1])).toBeGreaterThan(160);
    expect(br[1]).toBeGreaterThan(tr[1]); expect(bl[1]).toBeGreaterThan(tl[1]);
    const H = homographyFromQuad(LAPTOP_LOCAL_W, LAPTOP_LOCAL_H, LAPTOP_SCREEN_QUAD);
    const [x, y] = applyHomography(H, LAPTOP_LOCAL_W, LAPTOP_LOCAL_H);
    expect(x).toBeCloseTo(br[0], 5); expect(y).toBeCloseTo(br[1], 5);
  });
});

describe('lightning', () => {
  const samples = (from, to, dt = 0.01) => { const out = []; for (let t = from; t < to; t += dt) out.push([t, lightningAt(t)]); return out; };

  it('is dark until the first flash, and the first flash comes soon after the scene appears', () => {
    expect(lightningAt(0)).toBe(0);
    expect(lightningAt(LIGHTNING.first - 0.01)).toBe(0);
    const early = samples(LIGHTNING.first, LIGHTNING.first + 1.5);
    expect(Math.max(...early.map(s => s[1]))).toBeGreaterThan(0.7);
  });

  it('flashes every so often, with a gap in the stated range, and stays within 0..1', () => {
    const all = samples(0, 240, 0.02);
    for (const [, f] of all) { expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThanOrEqual(1); }
    const starts = [];
    let prev = 0;
    for (const [t, f] of all) { if (f > 0.3 && prev <= 0.3) starts.push(t); prev = f; }
    expect(starts.length).toBeGreaterThanOrEqual(7);
    const events = [];
    for (const t of starts) if (!events.length || t - events[events.length - 1] > 2) events.push(t);
    for (let i = 1; i < events.length; i++) { expect(events[i] - events[i - 1]).toBeGreaterThanOrEqual(LIGHTNING.minGap - 0.5); expect(events[i] - events[i - 1]).toBeLessThanOrEqual(LIGHTNING.minGap + LIGHTNING.varGap + 1); }
  });

  it('is SOFT: it rises over ~60ms (never a hard step), fades over a few tenths of a second, and is gone within two seconds', () => {
    for (const k of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const ev = lightningEvent(k);
      const run = samples(ev.start, ev.start + 2.2, 0.005).map(s => s[1]);
      // smooth: no jump between 5ms steps bigger than the attack allows
      for (let i = 1; i < run.length; i++) expect(Math.abs(run[i] - run[i - 1])).toBeLessThan(0.13);   // a 60ms smoothstep climbs at most ~0.125 per 5ms; a hard step would be ~1
      // the first 30ms is still climbing: it does not start at full strength
      expect(run[Math.round(0.03 / 0.005)]).toBeLessThan(0.75);
      // it rises to its peak over tens of ms, not instantly: the peak comes after at least 40ms
      expect(run.indexOf(Math.max(...run)) * 0.005).toBeGreaterThan(0.04);
      expect(run[run.length - 1]).toBeLessThan(0.02);
    }
  });

  it('is a flicker: a main pulse, a weaker echo, sometimes a faint third', () => {
    for (let k = 0; k < 12; k++) {
      const ev = lightningEvent(k);
      expect(ev.pulses.length).toBeGreaterThanOrEqual(2);
      expect(ev.pulses.length).toBeLessThanOrEqual(3);
      expect(ev.pulses[1].amp).toBeLessThan(ev.pulses[0].amp * 0.6); // the echo is at most about half the main pulse
      expect(ev.pulses[1].at).toBeGreaterThan(0.15);
    }
  });

  it('is deterministic', () => {
    for (const t of [3, 4.6, 4.7, 17.3, 55.5, 120.25, 301.8]) expect(lightningAt(t)).toBe(lightningAt(t));
    expect(lightningEvent(7)).toEqual(lightningEvent(7));
  });
});

describe('the flash is a change of exposure, not a white overlay', () => {
  it('brightens by about 30% at full strength, and by nothing at zero', () => {
    expect(FLASH.gain).toBeCloseTo(0.30, 5);
    expect(flashGain(0, 1500)).toBe(1);
    expect(flashGain(1, 1650)).toBeGreaterThan(1.27);   // around the laptop the weight is ~1
    expect(flashGain(1, 1650)).toBeLessThan(1.33);
    expect(flashGain(1, 3000)).toBeLessThanOrEqual(1 + FLASH.gain * (FLASH.weightBase + FLASH.weightWindow) + 1e-9);
  });
  it('lights the window side a little more than the far wall, smoothly', () => {
    expect(flashWeight(0)).toBeCloseTo(FLASH.weightBase, 5);
    expect(flashWeight(5000)).toBeCloseTo(FLASH.weightBase + FLASH.weightWindow, 5);
    let prev = 0;
    for (let x = 0; x <= 2752; x += 25) { const w = flashWeight(x); expect(w).toBeGreaterThanOrEqual(prev - 1e-12); prev = w; }
    expect(flashWeight(300)).toBeLessThan(flashWeight(1650));
  });
  it('gives the shader the same model, with a highlight roll-off and no mixing toward white', () => {
    expect(FLASH_GLSL).toContain('vec3 flashExposure(vec3 c, float flash, float x)');
    expect(FLASH_GLSL).toContain(FLASH.gain.toFixed(3));
    expect(FLASH_GLSL).toContain(FLASH.rollFrom.toFixed(3));
    expect(FLASH_GLSL).toContain('exp(');          // the soft roll-off
    expect(FLASH_GLSL).toContain('flashRoll(v) - flashRoll(c)'); // applied to the increase only
    expect(FLASH_GLSL).toContain('(1.0 - c)');                  // and scaled so a highlight never reaches white
    expect(FLASH_GLSL).not.toContain('mix(');      // never mixed toward white
  });
  it('the soft roll-off in the model never exceeds 1, never darkens, and never dips at a weak flash', () => {
    // the same maths as the GLSL, in JS
    const roll = (v) => Math.min(v, FLASH.rollFrom) + (1 - FLASH.rollFrom) * (1 - Math.exp(-Math.max(v - FLASH.rollFrom, 0) / FLASH.rollSoft));
    const expo = (c, f, x) => c + (roll(c * (1 + FLASH.gain * f * flashWeight(x))) - roll(c)) * (1 - c) / Math.max(1 - roll(c), 0.0001);
    for (let c = 0; c <= 1.0001; c += 0.01) {
      let prev = c;
      for (const f of [0, 0.05, 0.1, 0.25, 0.6, 1]) {
        const o = expo(Math.min(c, 1), f, 2000);
        expect(o).toBeLessThanOrEqual(1);
        expect(o).toBeGreaterThanOrEqual(prev - 1e-9);   // monotone in the flash: it only ever brightens, from the very first instant
        prev = o;
      }
    }
    expect(expo(0.5, 0, 2000)).toBeCloseTo(0.5, 9);      // no flash, no change
    // a highlight is lifted less than a mid-tone is (proportionally): no flat clipping
    expect(expo(0.92, 1, 2000) / 0.92).toBeLessThan(expo(0.4, 1, 2000) / 0.4);
    // a highlight is lifted toward white but never clipped to it, and white itself does not move
    for (const f of [0.5, 1]) { expect(expo(0.97, f, 3000)).toBeLessThan(1); expect(expo(0.99, f, 3000)).toBeLessThan(1); }
    expect(expo(1, 1, 3000)).toBeCloseTo(1, 9);
    // mid-tones get the full gain
    expect(expo(0.4, 1, 1650)).toBeCloseTo(0.4 * (1 + FLASH.gain * flashWeight(1650)), 6);
  });
});
