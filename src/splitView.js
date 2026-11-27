// Now Playing with a page beside it (App.jsx: npSplit): the song on the left half, exactly as it
// is beside its lyrics, and the page it was opened from (the Library, or an artist/album/... page)
// on the right half. Below SPLIT_MIN_WINDOW wide a half is too narrow for a song list, so the
// Library button shows the Library alone there (the lyrics still split, as they always have).
import { extraColumnFitCount, ULTRA_COMPACT_PANEL_BREAKPOINT, LIBRARY_YEAR_COL_BREAKPOINT, LIBRARY_GENRE_COL_BREAKPOINT } from './trackUtils.js';

export const SPLIT_MIN_WINDOW = 900;

export const splitFits = (windowWidth) => windowWidth > SPLIT_MIN_WINDOW;

// A song list in the right half gets about half the window: its extra columns (Album / Year /
// Genre) follow that width with the same thresholds the Library has always used.
export function splitColumnFit(windowWidth) {
  const w = windowWidth / 2;
  return extraColumnFitCount(w <= ULTRA_COMPACT_PANEL_BREAKPOINT, w <= LIBRARY_YEAR_COL_BREAKPOINT, w <= LIBRARY_GENRE_COL_BREAKPOINT);
}

// The right half is one glass sheet on the song's lit stage (App.jsx draws its glass in the Now
// Playing layer; the lyrics, or the page beside the song, fill it). Its inset in the card: below
// the title strip, from the midline, and from the card's right and bottom edges.
export const SPLIT_SHEET_TOP = 8;
export const SPLIT_SHEET_MID = 6;
export const SPLIT_SHEET_EDGE = 14;
export const SPLIT_SHEET_RADIUS = 22;
