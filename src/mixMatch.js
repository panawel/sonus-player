// Pure helpers for the "Start Mix" feature — cross-referencing similarity
// results from MusicBrainz/ListenBrainz/Deezer against the local library.
// Kept out of useMix.js/App.jsx so this logic is unit-testable on its own,
// same rationale as tagSearch.js for the Tag Editor's Search Online.

import { splitArtists } from './audioUtils.js';

const norm = (s) => (s || '').trim().toLowerCase();

// True when `libraryArtist` (possibly multi-artist: "A & B", "A feat. B")
// credits `targetArtist` as one of its artists.
export function artistCredits(libraryArtist, targetArtist) {
  const target = norm(targetArtist);
  if (!target) return false;
  return splitArtists(libraryArtist).some(a => norm(a) === target);
}

// Best MusicBrainz recording match for the seed track. Prefers a result with
// no disambiguation — live recordings, DJ-mix inclusions, remasters and the
// like are always annotated one, so this favors a canonical studio version
// when both are returned. Falls through to the top (already relevance-
// ranked by MusicBrainz) result if every candidate carries one.
export function pickBestRecording(recordings) {
  if (!recordings || recordings.length === 0) return null;
  const clean = recordings.filter(r => !r.disambiguation);
  return (clean[0] ?? recordings[0]) ?? null;
}

export function pickBestArtist(artists) {
  return artists?.[0] ?? null;
}

// Tier 1: exact artist+title matches from song-level similarity results.
// `results` — [{ artist_credit_name, recording_name, score }]. Returns
// {track, score} pairs (score carried through for buildMix's ranking).
export function matchSongsToLibrary(results, library) {
  const out = [];
  for (const r of results ?? []) {
    const title = norm(r.recording_name);
    if (!title) continue;
    const track = library.find(t => norm(t.title) === title && artistCredits(t.artist, r.artist_credit_name));
    if (track) out.push({ track, score: r.score ?? 0 });
  }
  return out;
}

// Tier 2: any library track by one of these artist names (song-level nuance
// lost, but this is the reliable fallback/widener). `perArtistCap` keeps one
// deep-catalog similar artist from dominating the whole mix. `excludeArtist`
// is the seed's own artist — it can turn up in a similar-artists list, but
// its tracks are either already the seed or belong in tier 1, not here.
export function matchArtistsToLibrary(artistNames, library, { excludeArtist, perArtistCap = 4 } = {}) {
  const out = [];
  for (const name of artistNames ?? []) {
    if (!name || (excludeArtist && norm(name) === norm(excludeArtist))) continue;
    out.push(...library.filter(t => artistCredits(t.artist, name)).slice(0, perArtistCap));
  }
  return out;
}

// Case-insensitive de-dup across two artist-name lists (ListenBrainz +
// Deezer), keeping first-seen casing and each source's own relevance order
// (ListenBrainz's list first, so an artist both sources agree on keeps its
// — generally more conservative — ListenBrainz-side position).
export function mergeArtistNames(...lists) {
  const seen = new Map();
  for (const list of lists) {
    for (const name of list ?? []) {
      const key = norm(name);
      if (key && !seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()];
}

// Combines tier 1 (song-level) + tier 2 (artist-level), de-duplicates, drops
// the seed track itself, and caps the total. Tier 1 is sorted here by its
// own score, descending; tier 2 keeps the order it arrived in (already
// relevance-ranked by ListenBrainz/Deezer, and by matchArtistsToLibrary's
// per-artist grouping).
export function buildMix({ seedTrack, songMatches = [], artistMatches = [], cap = 40 }) {
  const seen = new Set(seedTrack?.filePath ? [seedTrack.filePath] : []);
  const out = [];
  const add = (track) => {
    if (!track || seen.has(track.filePath)) return;
    seen.add(track.filePath);
    out.push(track);
  };
  for (const { track } of [...songMatches].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
    add(track);
    if (out.length >= cap) return out;
  }
  for (const track of artistMatches) {
    add(track);
    if (out.length >= cap) return out;
  }
  return out;
}
