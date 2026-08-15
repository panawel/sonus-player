// Pure helpers for the Tag Editor's "Search Online" lookup. Kept out of
// TagEditorWindow.jsx so the component file only exports a component (Fast
// Refresh requires that) and so this logic is unit-testable on its own.

// Pool fetched from the API, before de-duplication. Deliberately larger than
// what's displayed — see dedupeSearchResults. (Verified ceilings, in case this
// is ever raised: iTunes caps at 200, MusicBrainz at 100 per request.)
export const SEARCH_FETCH_LIMIT = 50;

// Shown to the user, after de-duplication.
export const SEARCH_MAX_RESULTS = 10;

// Both APIs return the same song many times over — the album, the single, a
// live cut, and several compilations. Only *exact* repeats (identical title,
// artist, album AND year) are dropped: genuinely different releases are kept,
// because picking the right album is the whole point when tagging.
//
// Two things this must get right:
//   1. It runs BEFORE the list is truncated. De-duplicating an already-sliced
//      list of 10 would leave fewer than 10 and quietly undo the larger limit.
//   2. It keeps the FIRST occurrence of each repeat, so the APIs' own relevance
//      ranking survives — most relevant first, untouched.
export function dedupeSearchResults(results, max = SEARCH_MAX_RESULTS) {
  const seen = new Set();
  const out = [];
  for (const r of results ?? []) {
    const key = [r.title, r.artist, r.album, r.year]
      .map(v => String(v ?? '').trim().toLowerCase())
      .join('\u0000'); // NUL can't appear in a tag, so fields can't bleed together
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}
