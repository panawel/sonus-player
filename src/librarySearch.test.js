import { describe, it, expect } from 'vitest';
import { searchWords, trackMatchesWords, highlightParts, foldText } from './librarySearch.js';

const t = (title, artist, album = '', year = '', genre = '') => ({ title, artist, album, year, genre });

describe('librarySearch', () => {
  it('matches every word, in any order, across title, artist, album, year and genre', () => {
    const song = t("I'm Coming for You", 'The Rasmus', 'Weirdo', 2024, 'Rock');
    expect(trackMatchesWords(song, searchWords('rasmus coming'))).toBe(true);
    expect(trackMatchesWords(song, searchWords('weirdo 2024'))).toBe(true);
    expect(trackMatchesWords(song, searchWords('rock you'))).toBe(true);
    expect(trackMatchesWords(song, searchWords('rasmus going'))).toBe(false);
  });
  it('ignores capitals, accents and Hebrew vowel marks', () => {
    expect(trackMatchesWords(t('Halo', 'Beyoncé'), searchWords('BEYONCE'))).toBe(true);
    expect(trackMatchesWords(t('Café de Flore', 'Élodie'), searchWords('cafe elodie'))).toBe(true);
    expect(trackMatchesWords(t('שָׁלוֹם', 'אמן'), searchWords('שלום'))).toBe(true);
    expect(foldText('Ünïcödé')).toBe('unicode');
  });
  it('an empty query matches everything', () => {
    expect(searchWords('   ')).toEqual([]);
    expect(trackMatchesWords(t('a', 'b'), [])).toBe(true);
  });
  it('marks every matched word where it really is, accents included', () => {
    expect(highlightParts('Beyoncé Knowles', searchWords('beyonce'))).toEqual([{ text: 'Beyoncé', hit: true }, { text: ' Knowles', hit: false }]);
    expect(highlightParts("I'm Coming for You", searchWords('coming you'))).toEqual([
      { text: "I'm ", hit: false }, { text: 'Coming', hit: true }, { text: ' for ', hit: false }, { text: 'You', hit: true },
    ]);
    expect(highlightParts('Plain', [])).toEqual([{ text: 'Plain', hit: false }]);
  });
});
