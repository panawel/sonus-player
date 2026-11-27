// The four colours the liquid background (LiquidCover.jsx) flows between, taken from a cover's
// pixels: a k-means over a small sample, ranked so a colourful accent beats a large black or grey
// area, de-duplicated so the four are clearly different, then made vivid and never black (and
// never too light for white text). A cover with too few distinct colours gets shades of its main
// one; no cover at all gets the app's own violet.

export const PALETTE_SIZE = 4;
export const PALETTE_LIGHTNESS = { min: 0.26, max: 0.62 };
export const PALETTE_MIN_SATURATION = 0.35;
export const FALLBACK_PALETTE = [[107, 90, 142], [58, 44, 96], [140, 96, 170], [40, 30, 70]];

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

export function hslToRgb([h, s, l]) {
  const f = (n) => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

// The colour the liquid really shows: saturated enough to read as colour, never black, never too
// light under white text.
export function vivid([h, s, l]) {
  return hslToRgb([h, Math.min(1, Math.max(s * 1.25, PALETTE_MIN_SATURATION)), Math.min(PALETTE_LIGHTNESS.max, Math.max(l, PALETTE_LIGHTNESS.min))]);
}

// `data`: RGBA bytes (ImageData.data) of a small sample of the cover, e.g. 32x32.
export function paletteFromPixels(data) {
  const px = [];
  for (let i = 0; i + 3 < data.length; i += 4) if (data[i + 3] > 128) px.push([data[i], data[i + 1], data[i + 2]]);
  if (px.length < 8) return FALLBACK_PALETTE.map((c) => c.slice());

  // k-means, k = 5, seeded across the sample
  let centres = [0, 0.2, 0.45, 0.7, 0.95].map((q) => px[Math.floor(q * (px.length - 1))].slice());
  let label = [];
  for (let it = 0; it < 10; it++) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    label = px.map((p) => {
      let best = 0, bestD = Infinity;
      centres.forEach((c, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bestD) { bestD = d; best = i; } });
      const s = sum[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
      return best;
    });
    centres = centres.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
  }
  const count = centres.map((_, i) => label.filter((l) => l === i).length);
  // colourful clusters weigh more, near-black ones much less
  const ranked = centres
    .map((c, i) => { const [h, s, l] = rgbToHsl(c); return { h, s, l, score: count[i] * (0.35 + s) * (l < 0.06 ? 0.25 : 1) }; })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  // keep clearly different colours (a hue apart, for colours that have one, or a lightness apart)
  const far = (a, b) => {
    const dh = Math.min(Math.abs(a.h - b.h), 1 - Math.abs(a.h - b.h));
    return (dh > 0.07 && (a.s > 0.15 || b.s > 0.15)) || Math.abs(a.l - b.l) > 0.22;
  };
  const picked = [];
  for (const r of ranked) if (picked.every((q) => far(r, q))) picked.push(r);
  if (picked.length === 0) return FALLBACK_PALETTE.map((c) => c.slice());
  // too few: lighter / deeper / softer shades of the main colour (still one family)
  const base = picked[0];
  const shades = [
    { h: (base.h + 0.03) % 1, s: base.s, l: base.l + 0.2 },
    { h: (base.h + 0.97) % 1, s: base.s, l: Math.max(0.12, base.l - 0.14) },
    { h: base.h, s: base.s * 0.6, l: base.l + 0.1 },
  ];
  for (let i = 0; picked.length < PALETTE_SIZE; i++) picked.push(shades[i] || base);
  return picked.slice(0, PALETTE_SIZE).map(({ h, s, l }) => vivid([h, s, l]));
}

// Colours already worked out, by cover URL, shared by every background (Now Playing, the pages'
// calm one, a freshly mounted mini player): a background that appears gets its cover's colours on
// its first frame instead of the fallback violet and a fade. The same palette object comes back
// each time (the renderer compares by identity). Least recently used goes first past `max`.
export function createPaletteCache(max = 200) {
  const map = new Map();
  return {
    get(key) { if (!map.has(key)) return undefined; const v = map.get(key); map.delete(key); map.set(key, v); return v; },
    set(key, value) { map.delete(key); map.set(key, value); while (map.size > max) map.delete(map.keys().next().value); },
    has(key) { return map.has(key); },
    get size() { return map.size; },
  };
}
export const paletteCache = createPaletteCache();
