import { describe, it, expect } from 'vitest';
import { parseLyrics, createLyricsClock, lineTimes, pageParagraphs, LYRIC_TYPING } from './chillLyrics.js';
import { TYPING } from './chillRoom.js';

const run = (clock, seconds, playing = true, dt = 1 / 30) => Array.from({ length: Math.round(seconds / dt) }, () => clock.step(dt, playing));

const SONG = `Verse one line a
Verse one line b
Verse one line c

Chorus line a
Chorus line b`;

describe('parseLyrics', () => {
  it('returns null for nothing usable, so the scene keeps its generic typing', () => {
    for (const t of [undefined, null, '', '   \n \n', '♪', '---\n***', 42]) expect(parseLyrics(t)).toBe(null);
  });

  it('keeps the words, collapses whitespace, and marks a blank line as the end of a verse', () => {
    const s = parseLyrics(SONG);
    expect(s.lines.map(l => l.text)).toEqual(['Verse one line a', 'Verse one line b', 'Verse one line c', 'Chorus line a', 'Chorus line b']);
    expect(s.lines.map(l => l.breakAfter)).toEqual([false, false, true, false, false]);
    expect(parseLyrics('a   b \t c\r\nsecond').lines[0].text).toBe('a b c');
    expect(parseLyrics('one\r\n\r\n\r\ntwo').lines[0].breakAfter).toBe(true);   // several blank lines are still one break
  });

  it('strips LRC timestamps and metadata tags (it is not synced, only the words are kept)', () => {
    const s = parseLyrics('[ar:Someone]\n[ti:Song]\n[00:12.34]First line\n[01:02:5][01:05.00]Second line\n[length: 3:10]');
    expect(s.lines.map(l => l.text)).toEqual(['First line', 'Second line']);
  });

  it('cuts a runaway line and caps the number of lines', () => {
    const long = parseLyrics('x'.repeat(500)).lines[0].text;
    expect(long.length).toBeLessThanOrEqual(LYRIC_TYPING.maxLineChars);
    expect(long.endsWith('…')).toBe(true);
    expect(parseLyrics(Array.from({ length: 900 }, (_, i) => `line ${i}`).join('\n')).lines.length).toBe(LYRIC_TYPING.maxLines);
  });

  it('keeps Hebrew and Arabic lyrics (right-to-left text) intact', () => {
    const s = parseLyrics('שלום עולם\nكيف حالك');
    expect(s.lines.map(l => l.text)).toEqual(['שלום עולם', 'كيف حالك']);
  });

  it('breathes every RUN_LINES lines when the lyrics have no verse breaks at all', () => {
    const s = parseLyrics(Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'));
    const breaks = s.lines.map((l, i) => (l.runBreak ? i : -1)).filter(i => i >= 0);
    expect(breaks).toEqual([5, 11, 17]);
    expect(s.lines.some(l => l.breakAfter)).toBe(false);
  });
});

describe('lineTimes — she stops only at the end of a verse (or the lyrics)', () => {
  const s = parseLyrics(SONG);
  it('types at the same speed as the generic typing', () => {
    expect(LYRIC_TYPING.charsPerS).toBe(TYPING.charsPerS);
    const l = parseLyrics('x'.repeat(65));
    expect(lineTimes(l, 0).typeS).toBeCloseTo(65 / TYPING.charsPerS, 6);
    expect(lineTimes(parseLyrics('Oh'), 0).typeS).toBe(LYRIC_TYPING.minLineS);
  });
  it('only presses Enter between lines of one verse', () => {
    expect(lineTimes(s, 0)).toMatchObject({ restS: LYRIC_TYPING.enterS, stop: false });
    expect(lineTimes(s, 1)).toMatchObject({ restS: LYRIC_TYPING.enterS, stop: false });
    expect(lineTimes(s, 3)).toMatchObject({ restS: LYRIC_TYPING.enterS, stop: false });
  });
  it('stops for "a couple of seconds" at a verse break, like the generic typing', () => {
    const t = lineTimes(s, 2);
    expect(t.stop).toBe(true);
    expect(t.restS).toBeGreaterThanOrEqual(TYPING.restMin);
    expect(t.restS).toBeLessThan(TYPING.restMin + TYPING.restVar);
    expect(lineTimes(s, 2)).toEqual(lineTimes(s, 2));   // deterministic
  });
  it('rests for a while after the last line, before starting over', () => {
    expect(lineTimes(s, s.lines.length - 1)).toMatchObject({ restS: LYRIC_TYPING.endRestS, stop: true });
  });
});

describe('the lyrics clock', () => {
  it('types a line character by character, then the next, never skipping ahead', () => {
    const s = parseLyrics(SONG);
    const c = createLyricsClock(s);
    let prevLine = 0, prevPartial = 0;
    for (const f of run(c, 12)) {
      if (f.lineIndex === prevLine) expect(f.partial).toBeGreaterThanOrEqual(prevPartial);
      else expect(f.lineIndex).toBe(prevLine + 1);
      expect(f.partial).toBeLessThanOrEqual(s.lines[f.lineIndex].text.length);
      prevLine = f.lineIndex; prevPartial = f.partial;
    }
  });

  it('keeps typing straight through a verse and stops (env 0) only at its end', () => {
    const s = parseLyrics(SONG);
    const frames = run(createLyricsClock(s), 14);
    // while on lines 0..2 of verse one she is never stopped, apart from the opening ease-in
    const inVerse = frames.filter(f => f.lineIndex <= 2 && f.u > TYPING.attackS + 0.05 && f.lineIndex !== 2);
    expect(inVerse.length).toBeGreaterThan(30);
    expect(inVerse.every(f => f.typing)).toBe(true);
    // at the verse break (after line 2) there is a real stop: env falls to 0 for a couple of seconds
    const stopped = frames.filter(f => f.lineIndex === 2 && f.u > lineTimes(s, 2).typeS + 0.05);
    expect(stopped.length).toBeGreaterThan(40);
    expect(stopped.every(f => f.env < 0.01)).toBe(true);
    const stopLen = stopped.length / 30;
    expect(stopLen).toBeGreaterThan(TYPING.restMin - 0.2);
    expect(stopLen).toBeLessThan(TYPING.restMin + TYPING.restVar + 0.3);
    // ...and she is typing again in the chorus
    expect(frames.some(f => f.lineIndex === 3 && f.typing)).toBe(true);
  });

  it('eases in and out, never jumping', () => {
    const frames = run(createLyricsClock(parseLyrics(SONG)), 40);
    for (let i = 1; i < frames.length; i++) expect(Math.abs(frames[i].env - frames[i - 1].env)).toBeLessThan(0.2);
  });

  it('stops when the music is paused, stays stopped, and resumes exactly where it was', () => {
    const c = createLyricsClock(parseLyrics(SONG));
    run(c, 2.2);
    const before = c.step(1 / 30, true);
    const paused = run(c, 3, false);
    const last = paused[paused.length - 1];
    expect(last.env).toBeLessThan(0.01);
    expect(paused.every(f => f.partial === last.partial && f.lineIndex === last.lineIndex || f.lineIndex === before.lineIndex)).toBe(true);
    const frozen = run(c, 6, false);
    expect(frozen.every(f => f.lineIndex === last.lineIndex && f.partial === last.partial)).toBe(true);   // nothing typed while paused
    const resumed = run(c, 1.5, true);
    expect(resumed[resumed.length - 1].lineIndex * 100 + resumed[resumed.length - 1].partial).toBeGreaterThanOrEqual(last.lineIndex * 100 + last.partial);
    expect(resumed[resumed.length - 1].env).toBeGreaterThan(0.5);
  });

  it('finishes, rests, then clears and starts again (cycle counts the loops)', () => {
    const s = parseLyrics('Short one\nShort two');
    const c = createLyricsClock(s);
    const total = s.lines.reduce((a, _, i) => a + lineTimes(s, i).typeS + lineTimes(s, i).restS, 0);
    const frames = run(c, total * 2.6);
    expect(Math.max(...frames.map(f => f.cycle))).toBeGreaterThanOrEqual(2);
    // at the end of the last line the whole line is typed, and she is resting for ~endRestS
    const rest = frames.filter(f => f.cycle === 0 && f.lineIndex === 1 && f.u > lineTimes(s, 1).typeS + 0.1);
    expect(rest.length / 30).toBeGreaterThan(LYRIC_TYPING.endRestS - 0.5);
    expect(rest.every(f => f.partial === s.lines[1].text.length && f.env < 0.01)).toBe(true);
    // the next cycle starts again at the first line from nothing
    const second = frames.find(f => f.cycle === 1);
    expect(second.lineIndex).toBe(0);
    expect(second.partial).toBeLessThanOrEqual(1);
  });

  it('survives a long frame (a stalled tab) by walking whole lines', () => {
    const c = createLyricsClock(parseLyrics(SONG));
    expect(() => { for (let i = 0; i < 500; i++) { const f = c.step(0.25, true); expect(Number.isFinite(f.env)).toBe(true); } }).not.toThrow();
  });
});

describe('pageParagraphs — what is on the page', () => {
  const s = parseLyrics(SONG);
  it('shows the typed lines, the one being typed cut at `partial`, and a gap after a verse', () => {
    expect(pageParagraphs(s, 0, 0)).toEqual(['']);
    expect(pageParagraphs(s, 0, 5)).toEqual(['Verse']);
    expect(pageParagraphs(s, 2, 7)).toEqual(['Verse one line a', 'Verse one line b', 'Verse o']);
    expect(pageParagraphs(s, 3, 4)).toEqual(['Verse one line a', 'Verse one line b', 'Verse one line c', '', 'Chor']);
    expect(pageParagraphs(s, 4, s.lines[4].text.length).at(-1)).toBe('Chorus line b');
  });
  it('never reads past the end', () => {
    expect(() => pageParagraphs(s, 99, 99)).not.toThrow();
  });
});
