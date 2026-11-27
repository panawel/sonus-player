// The lyrics view's pure parts (LyricsSpotlight.jsx): the text split into verses, and how lit a
// line is by its distance from the reading band.
import { LRC_TIME, LRC_META } from './chillLyrics.js';

// Verses (arrays of lines) from plain lyrics: a blank line ends a verse; LRC timestamps and tag
// lines ("[ar:Artist]") are dropped, since the words are all we show.
export function toVerses(text) {
  if (typeof text !== 'string') return [];
  const verses = [];
  let cur = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (LRC_META.test(raw)) continue;
    const t = raw.replace(LRC_TIME, '').replace(/\s+/g, ' ').trim();
    if (!t) { if (cur.length) { verses.push(cur); cur = []; } continue; }
    cur.push(t);
  }
  if (cur.length) verses.push(cur);
  return verses;
}

// The reading band sits this far down the view; lines within LIT rows of it are lit, within NEAR
// rows half lit, the rest dim. A "row" is one line's height, so a wrapped line counts by its centre.
export const SPOT_BAND = 0.42;
export const SPOT_LIT = 2.1;
export const SPOT_NEAR = 3.6;
export function spotFor(distanceInRows) {
  const d = Math.abs(distanceInRows);
  return d < SPOT_LIT ? 'lit' : d < SPOT_NEAR ? 'near' : 'dim';
}

// Where the reading band sits in the view (px from the scroller's top) at a scroll position. The
// lyrics start at the top, so at rest the band is on the first line; while scrolling it glides
// down to its place (SPOT_BAND of the height) and stays there; near the end it glides on to the
// last line, which can't scroll up to the band. `first` / `last`: the first and last lines' centres
// in content px; `top` scrollTop; `max` the largest scrollTop; `height` the view's height.
export function bandAt({ top, max, height, first, last }) {
  const B = height * SPOT_BAND;
  if (max <= 0) return null;                       // everything fits: no band, all lit
  const y0 = Math.min(first, B);                   // the first line, at rest
  const yEnd = Math.max(last - max, B);            // the last line, at the end
  let a = B - y0, b = yEnd - B;                    // scroll spans over which the band glides
  if (a + b > max) { const k = max / (a + b); a *= k; b *= k; }
  if (top < a) return y0 + (B - y0) * (top / a);
  if (b > 0 && top > max - b) return B + (yEnd - B) * ((top - (max - b)) / b);
  return B;
}
