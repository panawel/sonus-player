export const STANDARD_TIERS = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];

// Returns true when RTL characters (Hebrew, Arabic) make up >30% of the letter
// content. Shared by App.jsx (Now Playing lyrics) and TagEditorWindow.jsx
// (lyrics textarea).
const RTL_RE = /[֐-׿؀-ۿ]/g;
const LETTER_RE = /\p{L}/gu;
export function isRTL(text) {
  if (!text) return false;
  const rtlCount = (text.match(RTL_RE) || []).length;
  const letterCount = (text.match(LETTER_RE) || []).length;
  return letterCount > 0 && rtlCount / letterCount > 0.3;
}

export function detectScript(title) {
  if (!title) return 'English';
  const counts = { Hebrew: 0, Arabic: 0, Cyrillic: 0, CJK: 0, English: 0 };
  for (const c of title) {
    if (!/\p{L}/u.test(c)) continue;
    const cp = c.codePointAt(0);
    if (cp >= 0x0590 && cp <= 0x05FF) counts.Hebrew++;
    else if (cp >= 0x0600 && cp <= 0x06FF) counts.Arabic++;
    else if (cp >= 0x0400 && cp <= 0x04FF) counts.Cyrillic++;
    else if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3040 && cp <= 0x30FF) || (cp >= 0xAC00 && cp <= 0xD7AF)) counts.CJK++;
    else counts.English++;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return 'English';
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function splitArtists(str) {
  if (!str) return [];
  const tokens = str
    .split(/\s*,\s*|\s+&\s+|\s+and\s+|\s+feat\.?\s+|\s+ft\.?\s+|\s+x\s+/gi)
    .map(s => s.trim())
    .filter(Boolean);
  // If the split produced the same token twice (case-insensitive), the
  // separator is almost certainly part of the artist's *name* ("Years &
  // Years") — a real collab never lists the same artist twice. Treat the
  // whole string as a single artist: the displayed text then always matches
  // the tag verbatim, and grouping never invents phantom artists or
  // double-counts a track.
  const lower = tokens.map(t => t.toLowerCase());
  if (new Set(lower).size !== lower.length) return [str.trim()];
  return tokens;
}
const LOSSLESS_THRESHOLD = 400;

export function snapToTier(kbps) {
  if (kbps == null) return null;
  if (kbps > LOSSLESS_THRESHOLD) return 'Lossless';
  return STANDARD_TIERS.reduce((prev, curr) =>
    Math.abs(curr - kbps) < Math.abs(prev - kbps) ? curr : prev
  );
}

export function tierLabel(tier) {
  return tier === 'Lossless' ? 'Lossless' : `${tier} kbps`;
}
