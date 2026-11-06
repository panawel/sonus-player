import { describe, it, expect } from 'vitest';
import { solveSpring, bubbleSpring, bubbleExitMs, BUBBLE } from './bubbleMotion.js';

describe('solveSpring', () => {
  it('overshoots by the textbook amount for a damped spring', () => {
    // zeta = c / (2 sqrt(k)); overshoot = exp(-pi zeta / sqrt(1 - zeta^2))
    const k = 400, c = 24;
    const zeta = c / (2 * Math.sqrt(k));
    const expected = Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)) * 100;
    expect(solveSpring(k, c).overshootPct).toBeCloseTo(expected, 0);
  });

  it('does not overshoot when critically damped or more', () => {
    expect(solveSpring(400, 2 * Math.sqrt(400)).overshootPct).toBeLessThan(0.5);
    expect(solveSpring(400, 60).overshootPct).toBeLessThan(0.5);
  });

  it('is bouncier when damping drops and quicker when it stiffens', () => {
    expect(solveSpring(320, 16).overshootPct).toBeGreaterThan(solveSpring(400, 24).overshootPct);
    expect(solveSpring(900, 36).durationMs).toBeLessThan(solveSpring(200, 18).durationMs);
  });

  it('produces a linear() easing that starts at 0, ends exactly at 1, and passes 1 on the way', () => {
    const { easing } = solveSpring(400, 24);
    const nums = /^linear\((.*)\)$/.exec(easing)[1].split(',').map(Number);
    expect(nums[0]).toBe(0);
    expect(nums[nums.length - 1]).toBe(1);
    expect(Math.max(...nums)).toBeGreaterThan(1.03);
    expect(nums.length).toBe(37);
  });

  it('settles in a sensible time and caches', () => {
    const a = bubbleSpring();
    expect(a.durationMs).toBeGreaterThan(300);
    expect(a.durationMs).toBeLessThan(900);
    expect(bubbleSpring()).toBe(a);
  });

  it('exits faster than it enters, never below the floor', () => {
    expect(bubbleExitMs()).toBeLessThan(bubbleSpring().durationMs);
    expect(bubbleExitMs()).toBeGreaterThanOrEqual(BUBBLE.exitMinMs);
  });
});
