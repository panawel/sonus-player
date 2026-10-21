// Her typing the song's lyrics (study-room scene): the laptop's page fills with the current
// track's own lyrics, at the same pace as the generic typing, resting only at the end of a VERSE
// (a blank line in the lyrics) — within a verse she types straight on from line to line, with just
// the beat of pressing Enter. Lyrics with no blank lines at all would never rest, so every
// RUN_LINES lines she takes a short breath. Not synced to the song. Pure and deterministic (no randomness beyond a hash of
// the line's index), so it is unit-tested (chillLyrics.test.js).
//
// parseLyrics(text)  -> { lines: [{ text, breakAfter }] } or null (no usable lyrics: the scene
//                       keeps its generic typing)
// createLyricsClock(script).step(dt, playing) -> { env, typing, gate, lineIndex, partial, cycle }
//   * `env` 0..1 is the same eased "she is typing" envelope the generic clock reports;
//   * lines [0, lineIndex) are fully typed, line `lineIndex` has `partial` characters typed;
//   * pausing the music gates the clock to a stop (the schedule freezes where it was) and
//     playing resumes it — exactly like the generic typing;
//   * when the lyrics are done the page rests, then CLEARS and starts again (`cycle` counts the
//     loops), so she keeps working for the whole song.
import { TYPING } from './chillRoom.js';

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

export const LYRIC_TYPING = {
  charsPerS: TYPING.charsPerS,   // the same speed as the generic typing
  minLineS: 0.9,                 // even "Oh" takes a moment
  enterS: 0.14,                  // the beat of pressing Enter between lines of one verse
  RUN_LINES: 6,                  // lyrics with no verse breaks: a short breath every this many lines
  runRestS: 1.1,
  endRestS: 5.0,                 // after the last line, before the page clears and she starts again
  maxLineChars: 140,             // a runaway line is cut (it would be a wall of text on a 275px screen)
  maxLines: 400,
};

// Embedded lyrics are sometimes LRC (timestamped): "[00:12.34]text" and "[ar:Artist]" tags. We
// don't sync, so only the words are kept.
const LRC_TIME = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g;
const LRC_META = /^\s*\[[a-z]{2,6}:[^\]]*\]\s*$/i;

export function parseLyrics(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lines = [];
  let run = 0;   // lines typed since the last rest
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (LRC_META.test(raw)) continue;
    const t = raw.replace(LRC_TIME, '').replace(/\s+/g, ' ').trim();
    if (!t) { if (lines.length) { lines[lines.length - 1].breakAfter = true; run = 0; } continue; }   // a blank line ends a verse
    lines.push({ text: t.length > LYRIC_TYPING.maxLineChars ? t.slice(0, LYRIC_TYPING.maxLineChars - 1).trimEnd() + '…' : t, breakAfter: false, runBreak: false });
    run += 1;
    if (run >= LYRIC_TYPING.RUN_LINES) { lines[lines.length - 1].runBreak = true; run = 0; }
    if (lines.length >= LYRIC_TYPING.maxLines) break;
  }
  if (!lines.length) return null;
  // "words" with no letters or digits at all (a lone "♪" or "---") are not lyrics
  if (!lines.some((l) => /[\p{L}\p{N}]/u.test(l.text))) return null;
  return { lines };
}

// How long line i takes to type, and how long she rests after it. Only a verse break (a blank
// line), the end of a long run, or the end of the lyrics is a real rest; between lines of one verse
// it is just the beat of Enter. `stop` says whether the rest is a real stop (the typing envelope
// eases out and back in) or she types straight on.
export function lineTimes(script, i) {
  const l = script.lines[i];
  const typeS = Math.max(LYRIC_TYPING.minLineS, l.text.length / LYRIC_TYPING.charsPerS);
  const last = i === script.lines.length - 1;
  let restS, stop = true;
  if (last) restS = LYRIC_TYPING.endRestS;
  else if (l.breakAfter) restS = TYPING.restMin + TYPING.restVar * hash(i * 7 + 3);   // "a couple of seconds", like the generic typing
  else if (l.runBreak) restS = LYRIC_TYPING.runRestS;
  else { restS = LYRIC_TYPING.enterS; stop = false; }
  return { typeS, restS, stop };
}

export function createLyricsClock(script) {
  let seg = 0;      // which line
  let u = 0;        // seconds into its type + rest
  let gate = 0;     // 1 while the music plays, eased
  let cycle = 0;
  const n = script.lines.length;
  return {
    step(dt, playing) {
      gate += ((playing ? 1 : 0) - gate) * (1 - Math.exp(-dt / TYPING.gateTauS));
      let adv = dt * gate;
      while (adv > 0) {
        const { typeS, restS } = lineTimes(script, seg);
        const remain = typeS + restS - u;
        if (adv < remain) { u += adv; adv = 0; }
        else { adv -= remain; u = 0; seg += 1; if (seg >= n) { seg = 0; cycle += 1; } }
      }
      const { typeS } = lineTimes(script, seg);
      const typingNow = u < typeS;
      // she eases in only after a real stop and out only before one; straight on within a verse
      const prevStop = seg === 0 ? true : lineTimes(script, seg - 1).stop;
      const stopsAfter = lineTimes(script, seg).stop;
      const attack = prevStop ? smooth(0, TYPING.attackS, u) : 1;
      const release = stopsAfter ? 1 - smooth(typeS - TYPING.releaseS, typeS, u) : 1;
      const e = typingNow ? attack * release : (stopsAfter ? 0 : 1);
      const env = e * gate;
      const len = script.lines[seg].text.length;
      const partial = typingNow ? Math.min(len, Math.floor(u * LYRIC_TYPING.charsPerS)) : len;
      return { env, typing: env > 0.05, gate, lineIndex: seg, partial, cycle, typeS, u };
    },
  };
}

// The text as laid out on the page: the fully typed lines, then the one being typed (cut at
// `partial`), with an empty row after a verse break. Plain strings, one per paragraph; wrapping to
// the page's width is the canvas's job (it can measure the font).
export function pageParagraphs(script, lineIndex, partial) {
  const out = [];
  for (let i = 0; i <= lineIndex && i < script.lines.length; i++) {
    const l = script.lines[i];
    out.push(i < lineIndex ? l.text : l.text.slice(0, partial));
    if (i < lineIndex && l.breakAfter) out.push('');
  }
  return out;
}
