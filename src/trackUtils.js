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
};

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

const STRING_FIELDS = new Set(['title', 'artist', 'album']);

// null → "no value, always sorts last regardless of direction"
export function getSortValue(track, field) {
  switch (field) {
    case 'title':  return track.title  ? String(track.title).toLowerCase()  : null;
    case 'artist': return track.artist ? String(track.artist).toLowerCase() : null;
    case 'album':  return track.album  ? String(track.album).toLowerCase()  : null;
    case 'duration': return typeof track.duration === 'number' && track.duration > 0 ? track.duration : null;
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
