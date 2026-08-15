import { useState, useRef, useCallback, useMemo } from 'react';

// Set-based multi-selection over a displayed (sorted + filtered) track array.
// O(1) membership checks, macOS-style click semantics, and a keyboard cursor
// (focusedIndex) for arrow-key navigation.
//
// Selection deliberately does NOT auto-prune when `tracks` changes: hiding
// rows behind a search must not drop their selection (matches the original
// Library behavior). Call prune(paths) when tracks are actually removed.
export function useTrackSelection(tracks) {
  const [selected, setSelected] = useState(() => new Set());
  const [focusedIndex, setFocusedIndex] = useState(null);
  const anchorIndexRef = useRef(null);

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  const selectedPaths = useMemo(() => [...selected], [selected]);
  const selectedPathsRef = useRef(selectedPaths);
  selectedPathsRef.current = selectedPaths;

  const selectRange = useCallback((from, to) => {
    const list = tracksRef.current;
    const start = Math.max(0, Math.min(from, to));
    const end = Math.min(list.length - 1, Math.max(from, to));
    const next = new Set();
    for (let i = start; i <= end; i++) next.add(list[i].filePath);
    setSelected(next);
  }, []);

  // Click semantics: plain = single, cmd/ctrl = toggle, shift = range-from-anchor.
  const handleRowClick = useCallback((track, index, event) => {
    if (event.metaKey || event.ctrlKey) {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(track.filePath)) next.delete(track.filePath);
        else next.add(track.filePath);
        return next;
      });
      anchorIndexRef.current = index;
      setFocusedIndex(index);
    } else if (event.shiftKey && anchorIndexRef.current !== null) {
      selectRange(anchorIndexRef.current, index);
      setFocusedIndex(index);
    } else {
      setSelected(new Set([track.filePath]));
      anchorIndexRef.current = index;
      setFocusedIndex(index);
    }
  }, [selectRange]);

  const selectSingle = useCallback((index) => {
    const t = tracksRef.current[index];
    if (!t) return;
    setSelected(new Set([t.filePath]));
    anchorIndexRef.current = index;
    setFocusedIndex(index);
  }, []);

  const selectAll = useCallback(() => {
    const list = tracksRef.current;
    setSelected(new Set(list.map(t => t.filePath)));
    anchorIndexRef.current = list.length > 0 ? 0 : null;
    setFocusedIndex(list.length > 0 ? list.length - 1 : null);
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorIndexRef.current = null;
    setFocusedIndex(null);
  }, []);

  // Arrow-key cursor. extend=false moves a single-row selection; extend=true
  // (Shift) grows the range from the anchor. Returns the new index so callers
  // can scroll it into view, or null when there's nowhere to go.
  const moveFocus = useCallback((delta, extend = false) => {
    const list = tracksRef.current;
    if (list.length === 0) return null;
    const from = focusedIndex ?? (delta > 0 ? -1 : list.length);
    const next = Math.max(0, Math.min(list.length - 1, from + delta));
    if (extend) {
      if (anchorIndexRef.current === null) anchorIndexRef.current = Math.max(0, Math.min(list.length - 1, from));
      selectRange(anchorIndexRef.current, next);
    } else {
      setSelected(new Set([list[next].filePath]));
      anchorIndexRef.current = next;
    }
    setFocusedIndex(next);
    return next;
  }, [focusedIndex, selectRange]);

  // Jump the cursor to an absolute index (Home/End).
  const focusIndex = useCallback((index, extend = false) => {
    const list = tracksRef.current;
    if (list.length === 0) return null;
    const next = Math.max(0, Math.min(list.length - 1, index));
    if (extend && anchorIndexRef.current !== null) {
      selectRange(anchorIndexRef.current, next);
    } else {
      setSelected(new Set([list[next].filePath]));
      anchorIndexRef.current = next;
    }
    setFocusedIndex(next);
    return next;
  }, [selectRange]);

  const prune = useCallback((removedPaths) => {
    if (!removedPaths || removedPaths.length === 0) return;
    setSelected(prev => {
      let touched = false;
      const next = new Set(prev);
      for (const p of removedPaths) touched = next.delete(p) || touched;
      return touched ? next : prev;
    });
  }, []);

  return {
    selected,
    selectedPaths,
    selectedPathsRef,
    focusedIndex,
    isSelected: (filePath) => selected.has(filePath),
    handleRowClick,
    selectSingle,
    selectAll,
    clear,
    moveFocus,
    focusIndex,
    prune,
  };
}
