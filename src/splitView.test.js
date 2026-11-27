import { describe, it, expect } from 'vitest';
import { splitFits, splitColumnFit } from './splitView.js';

describe('split view', () => {
  it('only splits above 900px wide', () => {
    expect(splitFits(900)).toBe(false);
    expect(splitFits(901)).toBe(true);
  });

  it("a half-window list's columns follow half the window", () => {
    expect(splitColumnFit(1000)).toBe(0);  // 500px: title + time only
    expect(splitColumnFit(1728)).toBe(1);  // 864px: + album
    expect(splitColumnFit(2400)).toBe(3);  // 1200px: every column
  });
});
