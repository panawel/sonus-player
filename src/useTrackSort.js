import { useState, useMemo, useEffect, useCallback } from 'react';
import { sortTracks, sortFieldById, nextInCycle, MANUAL_SORT as MANUAL } from './trackUtils.js';

// Anything not in the current SORT_FIELDS falls through to null → manual. That
// is the migration path for sessions saved before the Sort dropdown was
// removed: a stored {field:'playCount'} is no longer reachable by any column,
// so restoring it would strand the user in a state they could neither
// understand nor escape.
function readStored(storageKey) {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.field === 'manual') return MANUAL;
    if (sortFieldById(parsed?.field) && (parsed.dir === 'asc' || parsed.dir === 'desc')) return parsed;
  } catch { /* ignore */ }
  return null;
}

// Sort state + memoized ordered array. `storageKey` persists the choice
// (Library); omit it for per-open state (Details). `resetKey` snaps back to
// manual/default order whenever it changes (Details item switches).
export function useTrackSort(tracks, { storageKey = null, resetKey = null } = {}) {
  const [sort, setSort] = useState(() => readStored(storageKey) ?? MANUAL);

  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(sort)); } catch { /* ignore */ }
  }, [sort, storageKey]);

  // Reset to default order when the underlying collection identity changes.
  useEffect(() => {
    if (resetKey !== null) setSort(MANUAL);
  }, [resetKey]);

  // Header click: advance that column's cycle (see COLUMN_CYCLES). Title walks
  // title↑ ↓ → artist↑ ↓ → manual; Album and Time walk their own ↑ ↓ → manual.
  const cycleColumn = useCallback((columnId) => {
    setSort(prev => nextInCycle(columnId, prev));
  }, []);

  const setManual = useCallback(() => setSort(MANUAL), []);

  const sorted = useMemo(() => sortTracks(tracks, sort.field, sort.dir), [tracks, sort]);

  return {
    sort,
    setSort,
    cycleColumn,
    setManual,
    sorted,
    isManual: sort.field === 'manual',
  };
}
