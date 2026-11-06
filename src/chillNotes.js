// Choosing which lyrics go on the two papers on the study room's right-hand wall (the big white
// sheet and the small yellow sticky). Pure and deterministic - the same song always gets the same
// verses (so nothing changes under your eyes while it plays), a different song gets different ones -
// so it is unit-tested (chillNotes.test.js). Drawing them is ChillNotes.jsx's job.
//
//   pickNotes(lyricsText, seedKey, { title, artist }) ->
//     { white: { heading, lines, sign }, yellow: { lines } }       or null (no usable lyrics: the
//                                                                  papers keep the photo's own writing)
//
// A "paragraph" is a verse: the lines between blank lines (parseLyrics already knows them; LRC time
// stamps are stripped there). The white sheet gets one random verse under the song's title and signed
// with the artist; the yellow sticky gets a DIFFERENT verse's first lines. Each is cut to what fits on
// its paper, at a line boundary where it can be, otherwise at a word boundary with an ellipsis.
import { parseLyrics } from './chillLyrics.js';

// How much each paper holds, in characters of its handwriting: `cols` per visual line (a lyric line
// longer than that wraps to the next), `rows` visual lines of body text.
export const NOTE_FIT = {
  white: { cols: 19, rows: 7, headingCols: 20, signCols: 18 },
  yellow: { cols: 11, rows: 5 },
};

// A small string hash -> [0, 1): stable across runs and machines.
export function seedUnit(key, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i += 1) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const hasWords = (s) => /[\p{L}\p{N}]/u.test(s);
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…`);

// Verses of lyrics, each an array of lines (empty ones and wordless ones dropped).
export function lyricVerses(lyricsText) {
  const script = parseLyrics(lyricsText);
  if (!script) return [];
  const verses = [];
  let cur = [];
  for (const l of script.lines) {
    if (hasWords(l.text)) cur.push(l.text);
    if (l.breakAfter && cur.length) { verses.push(cur); cur = []; }
  }
  if (cur.length) verses.push(cur);
  return verses;
}

// How many visual lines `text` takes at `cols` characters a line, wrapping at spaces (a word longer than
// a line is cut, as the paper's own wrapping would).
export function visualLines(text, cols) {
  let n = 1, w = 0;
  for (const word of text.split(' ')) {
    const len = word.length;
    if (w === 0) { w = len; } else if (w + 1 + len <= cols) { w += 1 + len; } else { n += 1; w = len; }
    while (w > cols) { n += 1; w -= cols; }
  }
  return n;
}

// The first lines of a verse that fit `rows` visual lines of `cols`; a single line that alone is too long
// is cut at a word boundary with an ellipsis.
export function fitVerse(verse, { cols, rows }) {
  const out = [];
  let used = 0;
  for (const line of verse) {
    const v = visualLines(line, cols);
    if (used + v > rows) break;
    out.push(line);
    used += v;
  }
  if (out.length) return out;
  // the very first line alone is too long: cut it
  const words = verse[0].split(' ');
  let cut = '';
  for (const w of words) {
    const trial = cut ? `${cut} ${w}` : w;
    if (visualLines(`${trial}…`, cols) > rows) break;
    cut = trial;
  }
  return [`${cut || clip(verse[0], cols * rows - 1)}…`];
}

export function pickNotes(lyricsText, seedKey, { title = '', artist = '' } = {}) {
  const verses = lyricVerses(lyricsText);
  if (!verses.length) return null;
  const key = String(seedKey || title || 'x');
  // random verses, but a one-line verse ("Oh, oh") makes a poor note when there are fuller ones
  const fuller = verses.filter((v) => v.length >= 2);
  const pool = fuller.length >= 2 ? fuller : verses;
  const wi = Math.min(pool.length - 1, Math.floor(seedUnit(key, 1) * pool.length));
  const whiteVerse = pool[wi];
  let yellowVerse;
  if (pool.length > 1) {
    const yi = (wi + 1 + Math.min(pool.length - 2, Math.floor(seedUnit(key, 2) * (pool.length - 1)))) % pool.length;
    yellowVerse = pool[yi];
  } else {
    // one verse only: the sticky takes its tail, the paper its start
    yellowVerse = whiteVerse.length > 2 ? whiteVerse.slice(Math.ceil(whiteVerse.length / 2)) : whiteVerse;
  }
  return {
    white: {
      heading: clip(title.trim(), NOTE_FIT.white.headingCols),
      lines: fitVerse(whiteVerse, NOTE_FIT.white),
      sign: artist.trim() ? `— ${clip(artist.trim(), NOTE_FIT.white.signCols - 2)}` : '',
    },
    yellow: { lines: fitVerse(yellowVerse, NOTE_FIT.yellow) },
  };
}
