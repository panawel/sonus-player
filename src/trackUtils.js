// Shared tracklist utilities: time formatting, sort fields, comparators.
// Single source of truth — replaces the formatTime copies that used to live in
// SortableTrackRow.jsx / HomeDetailView.jsx / HomeView.jsx.

// Row geometry per density — shared by TrackRow, TrackList, and the header.
export const ROW_HEIGHTS = { compact: 44, comfortable: 56 };
export const ART_SIZES = { compact: 30, comfortable: 40 };

export function formatTime(time) {
  if (!time || isNaN(time)) return '--:--';
  const m = Math.floor(time / 60);
  const s = Math.floor(time % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const MANUAL_SORT = { field: 'manual', dir: 'asc' };

// Every sortable field. Deliberately only the ones a rendered column header can
// reach: sorting is driven entirely by clicking a column, so a field with no
// column would be unreachable. (year / dateAdded / playCount / lastPlayed were
// removed along with the Sort dropdown that used to be their only entry point.)
export const SORT_FIELDS = [
  { id: 'title',    label: 'Title'    },
  { id: 'artist',   label: 'Artist'   },
  { id: 'album',    label: 'Album'    },
  { id: 'duration', label: 'Duration' },
  { id: 'year',     label: 'Year'     },
  { id: 'genre',    label: 'Genre'    },
];

export const sortFieldById = (id) => SORT_FIELDS.find(f => f.id === id) ?? null;

// Clicking a column header walks that column's cycle. Expressed as data rather
// than branching logic so the whole sort model is readable at a glance.
//
// Title folds in Artist because both live in the same combined cell — the row's
// StackedCell already promotes whichever one is sorted to its bold primary line.
// Every cycle ends at manual, which is what makes drag-to-reorder reachable
// again (canDrag keys off isManual); without it, one click on any header would
// disable reordering permanently.
export const COLUMN_CYCLES = {
  title: [
    { field: 'title',  dir: 'asc'  },
    { field: 'title',  dir: 'desc' },
    { field: 'artist', dir: 'asc'  },
    { field: 'artist', dir: 'desc' },
    MANUAL_SORT,
  ],
  album: [
    { field: 'album', dir: 'asc'  },
    { field: 'album', dir: 'desc' },
    MANUAL_SORT,
  ],
  duration: [
    { field: 'duration', dir: 'asc'  },
    { field: 'duration', dir: 'desc' },
    MANUAL_SORT,
  ],
  year: [
    { field: 'year', dir: 'asc'  },
    { field: 'year', dir: 'desc' },
    MANUAL_SORT,
  ],
  genre: [
    { field: 'genre', dir: 'asc'  },
    { field: 'genre', dir: 'desc' },
    MANUAL_SORT,
  ],
};

// Library-only extra columns, inserted between Title and the lyrics/Duration
// cluster. Order here is both the left-to-right render order and the
// right-to-left hide order as the window narrows (App.jsx slices this array
// from the front as width shrinks, so the last entry — Genre — is the first
// to go).
export const LIBRARY_EXTRA_COLUMNS = [
  { id: 'album', label: 'Album', flex: 1 },
  { id: 'year',  label: 'Year',  width: 50, align: 'right' },
  { id: 'genre', label: 'Genre', flex: 0.8 },
];

// Row-display text for a LIBRARY_EXTRA_COLUMNS cell. Deliberately separate
// from getSortValue: display keeps original casing and shows only the first
// genre of a multi-genre tag, while the sort value is lowercased for
// case-insensitive ordering.
export function displayValueForColumn(track, columnId) {
  switch (columnId) {
    case 'album':   return track.album || '';
    case 'year':    return track.year ? String(track.year) : '';
    case 'genre':   return track.genre ? track.genre.split(',')[0].trim() : '';
    default: return '';
  }
}

// Width thresholds for LIBRARY_EXTRA_COLUMNS visibility, shared by App.jsx
// (Library) and HomeDetailView.jsx (artist/album/year/etc. detail pages) —
// live here rather than in either component so both can import the same
// numbers without a circular import between them. Below
// ULTRA_COMPACT_PANEL_BREAKPOINT all extra columns are hidden; App.jsx also
// reuses that same breakpoint for its own (unrelated) player-panel sizing,
// one fewer constant to keep in sync. **Must stay above 700**:
// electron/smokeTest.mjs has a hardcoded check that resizes to 700px and
// expects Library's header/rows to show no extra columns.
export const ULTRA_COMPACT_PANEL_BREAKPOINT = 780;
export const LIBRARY_YEAR_COL_BREAKPOINT = 900;
export const LIBRARY_GENRE_COL_BREAKPOINT = 1000;

// 0..3 — how many of an ordered extra-columns list currently fit, given the
// three width tiers above. Each wider threshold implies the narrower ones,
// so this is a plain cascade rather than three independent checks.
export function extraColumnFitCount(isAlbumTierHidden, isYearTierHidden, isGenreTierHidden) {
  return isAlbumTierHidden ? 0 : isYearTierHidden ? 1 : isGenreTierHidden ? 2 : 3;
}

// Which of LIBRARY_EXTRA_COLUMNS make sense on a given Home detail page —
// suppresses a column that would be redundant for the page you're already
// on: an Album page filters to one album, so its own Album column is dead
// weight (matches Library's TrackListHeader/TrackRow, which never show a
// combined Album cell either); a Year page — or the "Missing Year" metadata
// page — means every row already shares or lacks that exact year. Order is
// preserved from LIBRARY_EXTRA_COLUMNS, so the same right-to-left breakpoint
// slicing (extraColumnFitCount above) still applies to whatever's left.
export function detailExtraColumns(item) {
  return LIBRARY_EXTRA_COLUMNS.filter(col => {
    if (col.id === 'album') return item.type !== 'album';
    if (col.id === 'year') {
      return !(item.type === 'year' || (item.type === 'missing-metadata' && item.key === 'year'));
    }
    return true;
  });
}

// The next state for a column, given the current sort. A sort that isn't in
// this column's cycle isn't found, so the -1 wraps to index 0 — which is
// exactly right: clicking a different column starts that column's cycle from
// the top. Manual appears in every cycle, so it also correctly resolves to
// "first state of the column you just clicked".
export function nextInCycle(columnId, sort) {
  const cycle = COLUMN_CYCLES[columnId];
  if (!cycle) return MANUAL_SORT;
  const i = cycle.findIndex(s => s.field === sort.field && (s.field === 'manual' || s.dir === sort.dir));
  return cycle[(i + 1) % cycle.length];
}

// The field this column is currently sorted by, or null when the active sort
// belongs to another column (or is manual). Drives the header's label text.
export function activeFieldForColumn(columnId, sort) {
  if (!sort || sort.field === 'manual') return null;
  return COLUMN_CYCLES[columnId]?.some(s => s.field === sort.field) ? sort.field : null;
}

const STRING_FIELDS = new Set(['title', 'artist', 'album', 'genre']);

// null → "no value, always sorts last regardless of direction"
export function getSortValue(track, field) {
  switch (field) {
    case 'title':  return track.title  ? String(track.title).toLowerCase()  : null;
    case 'artist': return track.artist ? String(track.artist).toLowerCase() : null;
    case 'album':  return track.album  ? String(track.album).toLowerCase()  : null;
    case 'duration': return typeof track.duration === 'number' && track.duration > 0 ? track.duration : null;
    case 'year': {
      const y = parseInt(track.year, 10);
      return !isNaN(y) && y > 0 ? y : null;
    }
    case 'genre': {
      const g = track.genre ? String(track.genre).split(',')[0].trim().toLowerCase() : '';
      return g || null;
    }
    default: return null;
  }
}

// Comparator factory. Missing values sort last in both directions; ties keep
// their existing relative order (Array.prototype.sort is stable).
export function compareBy(field, dir = 'asc') {
  const mult = dir === 'desc' ? -1 : 1;
  const isString = STRING_FIELDS.has(field);
  return (a, b) => {
    const va = getSortValue(a, field);
    const vb = getSortValue(b, field);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (isString) return mult * va.localeCompare(vb, undefined, { sensitivity: 'base', numeric: true });
    return va === vb ? 0 : (va < vb ? -mult : mult);
  };
}

// 'manual' (or unknown field) returns the input array untouched.
export function sortTracks(tracks, field, dir) {
  if (!field || field === 'manual' || !sortFieldById(field)) return tracks;
  return [...tracks].sort(compareBy(field, dir));
}
