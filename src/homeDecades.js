// Home's one filter row: the decades the library's songs come from (HomeView.jsx). Four-digit labels
// ("1990s", "2020s"): the old two-digit ones ("00s") were the same for the 1900s and the 2000s.

const yearOf = (track) => { const y = parseInt(track?.year, 10); return Number.isFinite(y) && y > 0 ? y : null; };

// The decades that have songs, newest first.
export function decadesOf(tracks) {
  const set = new Set();
  for (const t of tracks) { const y = yearOf(t); if (y !== null) set.add(Math.floor(y / 10) * 10); }
  return [...set].sort((a, b) => b - a);
}

export const decadeLabel = (decade) => `${decade}s`;

// The songs from that decade (all of them for null).
export function filterByDecade(tracks, decade) {
  if (decade == null) return tracks;
  return tracks.filter((t) => { const y = yearOf(t); return y !== null && y >= decade && y < decade + 10; });
}
