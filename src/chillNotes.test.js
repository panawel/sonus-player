import { describe, it, expect } from 'vitest';
import { pickNotes, lyricVerses, fitVerse, visualLines, seedUnit, NOTE_FIT } from './chillNotes.js';

const SONG = `Verse one line one
Verse one line two
Verse one line three

Chorus line one is here
Chorus line two is here

Second verse starts now
and carries on a little
until it is done

Bridge goes up high
and comes down low`;

describe('lyricVerses', () => {
  it('splits on blank lines into verses of lines', () => {
    const v = lyricVerses(SONG);
    expect(v).toHaveLength(4);
    expect(v[0]).toEqual(['Verse one line one', 'Verse one line two', 'Verse one line three']);
  });
  it('strips LRC time stamps and tags, and drops wordless lines', () => {
    const v = lyricVerses('[ar:Someone]\n[00:01.00]Hello there\n[00:03.20]♪\n[00:05.00]General Kenobi');
    expect(v).toEqual([['Hello there', 'General Kenobi']]);
  });
  it('is empty without usable lyrics', () => {
    expect(lyricVerses('')).toEqual([]);
    expect(lyricVerses(null)).toEqual([]);
    expect(lyricVerses('♪ ♪\n---')).toEqual([]);
  });
});

describe('visualLines / fitVerse', () => {
  it('counts wrapped lines the way the paper wraps them', () => {
    expect(visualLines('short', 19)).toBe(1);
    expect(visualLines('a line that is quite a bit longer than nineteen', 19)).toBe(3);
    expect(visualLines('Supercalifragilisticexpialidocious', 10)).toBe(4);   // a word longer than a line is cut
  });
  it('keeps whole lines while they fit, never more than the rows the paper holds', () => {
    const verse = ['one two three four', 'five six seven', 'nine ten eleven', 'thirteen fourteen', 'fifteen'];
    const fit = fitVerse(verse, { cols: 19, rows: 3 });
    expect(fit).toEqual(['one two three four', 'five six seven', 'nine ten eleven']);
    expect(fit.reduce((n, l) => n + visualLines(l, 19), 0)).toBeLessThanOrEqual(3);
  });
  it('cuts one runaway line at a word boundary with an ellipsis', () => {
    const [cut] = fitVerse(['this single line is far longer than a small sticky note can possibly hold at all'], NOTE_FIT.yellow);
    expect(cut.endsWith('…')).toBe(true);
    expect(visualLines(cut, NOTE_FIT.yellow.cols)).toBeLessThanOrEqual(NOTE_FIT.yellow.rows);
    expect(cut.slice(0, -1).trim().split(' ').every((w) => 'this single line is far longer than a small sticky note can possibly hold at all'.split(' ').includes(w))).toBe(true);   // no word cut in half
  });
});

describe('pickNotes', () => {
  const pick = (seed = 'song-a', lyrics = SONG) => pickNotes(lyrics, seed, { title: 'Fine Line', artist: 'Harry Styles' });

  it('returns null for no usable lyrics, so the papers keep the photo\'s own writing', () => {
    expect(pickNotes('', 'k', { title: 't' })).toBeNull();
    expect(pickNotes(null, 'k', { title: 't' })).toBeNull();
  });

  it('is deterministic: the same song always gets the same verses', () => {
    expect(pick('song-a')).toEqual(pick('song-a'));
  });

  it('different songs (seeds) get different verses', () => {
    const picks = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(pick(`song-${i}`).white.lines)));
    expect(picks.size).toBeGreaterThan(1);
  });

  it('the white sheet gets a real verse from the song, the title as its heading and the artist as its sign-off', () => {
    const n = pick();
    const all = lyricVerses(SONG).flat();
    expect(n.white.lines.length).toBeGreaterThan(0);
    expect(n.white.lines.every((l) => all.includes(l))).toBe(true);
    expect(n.white.heading).toBe('Fine Line');
    expect(n.white.sign).toBe('— Harry Styles');
  });

  it('the yellow sticky gets a different verse from the white sheet', () => {
    for (let i = 0; i < 20; i += 1) {
      const n = pick(`seed-${i}`);
      expect(n.yellow.lines[0]).not.toBe(n.white.lines[0]);
    }
  });

  it('what is written fits the paper it is written on', () => {
    for (let i = 0; i < 20; i += 1) {
      const n = pick(`seed-${i}`);
      expect(n.white.lines.reduce((s, l) => s + visualLines(l, NOTE_FIT.white.cols), 0)).toBeLessThanOrEqual(NOTE_FIT.white.rows);
      expect(n.yellow.lines.reduce((s, l) => s + visualLines(l, NOTE_FIT.yellow.cols), 0)).toBeLessThanOrEqual(NOTE_FIT.yellow.rows);
    }
  });

  it('a long title and artist are shortened for the page', () => {
    const n = pickNotes(SONG, 'k', { title: 'An Exceedingly Long Song Title Indeed', artist: 'An Artist With A Very Long Name Too' });
    expect(n.white.heading.length).toBeLessThanOrEqual(NOTE_FIT.white.headingCols);
    expect(n.white.sign.length).toBeLessThanOrEqual(NOTE_FIT.white.signCols);
    expect(n.white.heading.endsWith('…')).toBe(true);
  });

  it('with one single verse the sticky takes its tail, the sheet its start', () => {
    const n = pickNotes('line one\nline two\nline three\nline four', 'k', { title: 'T' });
    expect(n.white.lines[0]).toBe('line one');
    expect(n.yellow.lines[0]).not.toBe('line one');
  });

  it('prefers fuller verses over a one-line "Oh, oh" when there are some', () => {
    const lyrics = 'Oh oh\n\nA real verse here\nwith a second line\n\nAnother real verse\nwith two lines too\n\nYeah';
    for (let i = 0; i < 15; i += 1) {
      const n = pickNotes(lyrics, `s${i}`, { title: 'T' });
      expect(n.white.lines.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('works for right-to-left lyrics (the text is just carried through)', () => {
    const n = pickNotes('שורה ראשונה\nשורה שנייה\n\nבית שני כאן\nוהמשך', 'k', { title: 'שיר', artist: 'אמן' });
    expect(n.white.lines[0]).toMatch(/[א-ת]/);
    expect(n.white.sign).toBe('— אמן');
  });

  it('seedUnit is stable and in range', () => {
    for (const k of ['a', 'bb', '/path/to/a song.mp3', '']) {
      const u = seedUnit(k, 1);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      expect(seedUnit(k, 1)).toBe(u);
    }
    expect(seedUnit('a', 1)).not.toBe(seedUnit('a', 2));
  });
});
