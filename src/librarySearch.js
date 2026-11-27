// The Library's search (the field in its column header, TrackListHeader.jsx): plain, forgiving
// matching. Every word of the query must appear somewhere in the song's title, artist, album,
// year or genre, in any order ("rasmus coming" finds "I'm Coming for You" by The Rasmus), ignoring
// capitals, accents ("beyonce" finds "Beyoncé") and Hebrew vowel marks.

const MARKS = /[̀-֑ͯ-ׇ]/g;

// Lower-case, accents and vowel marks removed. Removing a combining mark shortens the NFD string,
// so `foldWithMap` also returns, for each folded character, its index in the original text (for
// highlighting the words where they really are).
export function foldText(text) {
  return String(text ?? '').normalize('NFD').replace(MARKS, '').toLowerCase();
}

function foldWithMap(text) {
  const src = String(text ?? '');
  let folded = '';
  const map = [];
  for (let i = 0; i < src.length; i++) {
    const f = src[i].normalize('NFD').replace(MARKS, '').toLowerCase();
    for (let k = 0; k < f.length; k++) { folded += f[k]; map.push(i); }
  }
  return { folded, map };
}

export function searchWords(query) {
  return foldText(query).split(/\s+/).filter(Boolean);
}

// Each track's searchable text, worked out once per track object (a 20,000-song library is then
// one `includes` per word per song on every keystroke).
const hayCache = new WeakMap();
function hay(track) {
  let h = hayCache.get(track);
  if (h === undefined) {
    h = foldText([track.title, track.artist, track.album, track.year, track.genre].filter((v) => v != null && v !== '').join(' \u0001 '));
    hayCache.set(track, h);
  }
  return h;
}

export function trackMatchesWords(track, words) {
  if (!words.length) return true;
  const h = hay(track);
  return words.every((w) => h.includes(w));
}

// A text split into [{ text, hit }] runs, with every occurrence of every word marked.
export function highlightParts(text, words) {
  const src = String(text ?? '');
  if (!words?.length || !src) return [{ text: src, hit: false }];
  const { folded, map } = foldWithMap(src);
  const hit = new Array(src.length).fill(false);
  for (const w of words) {
    for (let k = folded.indexOf(w); k !== -1; k = folded.indexOf(w, k + 1)) {
      for (let j = k; j < k + w.length; j++) hit[map[j]] = true;
    }
  }
  const parts = [];
  for (let i = 0; i < src.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === hit[i]) last.text += src[i];
    else parts.push({ text: src[i], hit: hit[i] });
  }
  return parts;
}
