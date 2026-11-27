// The players' glow (seek lines, the play disc): the song's artwork colour, made bright enough
// to glow. A cover's average colour is often dark or grey (a black-and-white photo, a dark sleeve),
// and a glow in that colour would be invisible on the dark glass, so the lightness and
// saturation are lifted to a floor while the hue is kept. No artwork: a soft white.
// Published as the CSS variable --art-rgb ("r, g, b"), used as rgba(var(--art-rgb), a).
export const GLOW_MIN_LIGHTNESS = 0.62;
export const GLOW_MIN_SATURATION = 0.45;
export const GLOW_DEFAULT = '255, 255, 255';

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map((v) => Math.round(v * 255));
}

// rgb: { r, g, b } (0-255) or null. Returns "r, g, b".
export function glowRgb(rgb) {
  if (!rgb || ![rgb.r, rgb.g, rgb.b].every(Number.isFinite)) return GLOW_DEFAULT;
  const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
  // a grey cover has no hue to lift: it glows soft white
  if (s < 0.08) return GLOW_DEFAULT;
  const [r, g, b] = hslToRgb(h, Math.max(s, GLOW_MIN_SATURATION), Math.max(l, GLOW_MIN_LIGHTNESS));
  return `${r}, ${g}, ${b}`;
}
