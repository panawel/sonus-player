import { describe, it, expect } from 'vitest';
import {
  artistCredits, pickBestRecording, pickBestArtist,
  matchSongsToLibrary, matchArtistsToLibrary, mergeArtistNames, buildMix,
} from './mixMatch.js';

const track = (title, artist, filePath, extra = {}) => ({ title, artist, filePath: filePath ?? `/lib/${artist}-${title}.mp3`, ...extra });

describe('artistCredits', () => {
  it('matches a plain single artist, case/whitespace-insensitive', () => {
    expect(artistCredits('Daft Punk', 'daft punk')).toBe(true);
    expect(artistCredits('  Daft Punk  ', 'Daft Punk')).toBe(true);
  });

  it('matches one credited artist inside a multi-artist tag', () => {
    expect(artistCredits('Daft Punk & Pharrell Williams', 'Pharrell Williams')).toBe(true);
    expect(artistCredits('Daft Punk feat. Pharrell Williams', 'Daft Punk')).toBe(true);
  });

  it('does not match an unrelated artist', () => {
    expect(artistCredits('Daft Punk', 'Justice')).toBe(false);
  });

  it('handles missing values', () => {
    expect(artistCredits('', 'Daft Punk')).toBe(false);
    expect(artistCredits('Daft Punk', '')).toBe(false);
    expect(artistCredits(null, null)).toBe(false);
  });
});

describe('pickBestRecording', () => {
  it('prefers a result with no disambiguation over a live/alternate one', () => {
    const recordings = [
      { id: 'live-1', disambiguation: 'live, 2003' },
      { id: 'studio', disambiguation: '' },
      { id: 'live-2', disambiguation: 'DJ mix' },
    ];
    expect(pickBestRecording(recordings).id).toBe('studio');
  });

  it('falls back to the top (already relevance-ranked) result when every candidate has one', () => {
    const recordings = [
      { id: 'top', disambiguation: 'live, 2003' },
      { id: 'second', disambiguation: 'live, 2005' },
    ];
    expect(pickBestRecording(recordings).id).toBe('top');
  });

  it('handles empty input', () => {
    expect(pickBestRecording([])).toBeNull();
    expect(pickBestRecording(null)).toBeNull();
  });
});

describe('pickBestArtist', () => {
  it('takes the first (top-scored) result', () => {
    expect(pickBestArtist([{ id: 'a' }, { id: 'b' }]).id).toBe('a');
  });
  it('handles empty input', () => {
    expect(pickBestArtist([])).toBeNull();
    expect(pickBestArtist(undefined)).toBeNull();
  });
});

describe('matchSongsToLibrary', () => {
  const library = [
    track('Don’t Start Now', 'Dua Lipa'),
    track('Levitating', 'Dua Lipa'),
    track('Blinding Lights', 'The Weeknd'),
  ];

  it('matches by artist AND title, case-insensitively', () => {
    const results = [{ artist_credit_name: 'dua lipa', recording_name: 'levitating', score: 100 }];
    const out = matchSongsToLibrary(results, library);
    expect(out).toHaveLength(1);
    expect(out[0].track.title).toBe('Levitating');
    expect(out[0].score).toBe(100);
  });

  it('skips a title match with the wrong artist', () => {
    const results = [{ artist_credit_name: 'Someone Else', recording_name: 'Levitating', score: 100 }];
    expect(matchSongsToLibrary(results, library)).toHaveLength(0);
  });

  it('skips results the library has nothing for', () => {
    const results = [{ artist_credit_name: 'Unknown', recording_name: 'Unknown Song', score: 50 }];
    expect(matchSongsToLibrary(results, library)).toHaveLength(0);
  });

  it('handles empty input', () => {
    expect(matchSongsToLibrary([], library)).toEqual([]);
    expect(matchSongsToLibrary(null, library)).toEqual([]);
  });
});

describe('matchArtistsToLibrary', () => {
  const library = [
    track('S1', 'Nirvana'), track('S2', 'Nirvana'), track('S3', 'Nirvana'),
    track('S4', 'Nirvana'), track('S5', 'Nirvana'),
    track('S6', 'Muse'),
    track('S7', 'Radiohead'), // the seed's own artist
  ];

  it('pulls in every library track by a similar artist', () => {
    const out = matchArtistsToLibrary(['Muse'], library);
    expect(out.map(t => t.title)).toEqual(['S6']);
  });

  it('caps how many tracks come from any single similar artist', () => {
    const out = matchArtistsToLibrary(['Nirvana'], library, { perArtistCap: 2 });
    expect(out).toHaveLength(2);
  });

  it('excludes the seed track’s own artist even if it appears in the similar-artists list', () => {
    const out = matchArtistsToLibrary(['Radiohead', 'Muse'], library, { excludeArtist: 'Radiohead' });
    expect(out.map(t => t.title)).toEqual(['S6']);
  });

  it('handles an artist with nothing in the library', () => {
    expect(matchArtistsToLibrary(['Some Unowned Artist'], library)).toEqual([]);
  });
});

describe('mergeArtistNames', () => {
  it('de-duplicates case-insensitively across lists, keeping first-seen casing', () => {
    const out = mergeArtistNames(['Nirvana', 'Muse'], ['muse', 'Coldplay']);
    expect(out).toEqual(['Nirvana', 'Muse', 'Coldplay']);
  });

  it('handles empty/missing lists', () => {
    expect(mergeArtistNames([], undefined, null)).toEqual([]);
    expect(mergeArtistNames(['A'])).toEqual(['A']);
  });
});

describe('buildMix', () => {
  const seed = track('Seed Song', 'Seed Artist');
  const songA = track('Song A', 'Similar Artist 1');
  const songB = track('Song B', 'Similar Artist 1');
  const artistTrack1 = track('Artist Track 1', 'Similar Artist 2');

  it('ranks song-level matches by score, descending, ahead of artist-level ones', () => {
    const out = buildMix({
      seedTrack: seed,
      songMatches: [{ track: songA, score: 10 }, { track: songB, score: 90 }],
      artistMatches: [artistTrack1],
    });
    expect(out.map(t => t.title)).toEqual(['Song B', 'Song A', 'Artist Track 1']);
  });

  it('excludes the seed track even if it somehow appears in a match list', () => {
    const out = buildMix({ seedTrack: seed, songMatches: [{ track: seed, score: 100 }], artistMatches: [artistTrack1] });
    expect(out.map(t => t.title)).toEqual(['Artist Track 1']);
  });

  it('de-duplicates a track that shows up in both tiers', () => {
    const out = buildMix({
      seedTrack: seed,
      songMatches: [{ track: songA, score: 50 }],
      artistMatches: [songA, artistTrack1],
    });
    expect(out.map(t => t.title)).toEqual(['Song A', 'Artist Track 1']);
  });

  it('caps the total', () => {
    const many = Array.from({ length: 10 }, (_, i) => track(`T${i}`, 'X', `/lib/t${i}.mp3`));
    const out = buildMix({ seedTrack: seed, artistMatches: many, cap: 4 });
    expect(out).toHaveLength(4);
  });

  it('handles a mix with no matches at all', () => {
    expect(buildMix({ seedTrack: seed })).toEqual([]);
  });
});
