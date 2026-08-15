import { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TrackRow, DraggableTrackRow } from './TrackRow.jsx';
import { ROW_HEIGHTS } from './trackUtils.js';

// Left-button-only drag activation, so right-click stays free for the
// context menu (moved here from App.jsx).
class PrimaryPointerSensor extends PointerSensor {
  static activators = [{
    eventName: 'onPointerDown',
    handler: ({ nativeEvent: event }) => event.button === 0,
  }];
}

// The unified tracklist engine: virtualized rows + keyboard navigation, with
// drag-to-reorder mounted only when the caller allows it (manual order, no
// search, ≤5k tracks). Library and Details are two configurations of it.
//
// Deliberately does NOT render the column header. The caller places
// <TrackListHeader> *above* its scroll container, so rows can never pass behind
// the labels — which is what lets the header carry no background at all and
// stay visually identical whether the list is scrolled or not.
export default function TrackList({
  tracks,                     // displayed order (already sorted/filtered)
  currentTrack, isPlaying,
  density,
  selection,                  // from useTrackSelection
  sort,
  playTrack, togglePlay,
  onShowMenu,                 // (paths, anchorRect)
  onRemoveTracks = null,      // Delete/Backspace handler; null disables
  canDrag = false, onDragEnd = null,
  scrollElRef,                // ref to the actual scrolling ancestor
  virtualizerRef = null,      // exposes the virtualizer (scrollToTrack etc.)
  showAlbum = true,
  initialOffset = 0,          // restored scroll position (Details view)
  emptyState = null,          // replaces the default "No tracks found." block
}) {
  const containerRef = useRef(null);
  const rowsRef = useRef(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const sensors = useSensors(
    useSensor(PrimaryPointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Distance from the scroll container's content top to the first row —
  // feeds the virtualizer's scrollMargin so windowing math and scrollToIndex
  // stay exact with the title/header content above the rows.
  const hasRows = tracks.length > 0;
  // Now that the header lives outside the scroll container this is usually 0,
  // but it stays measured rather than assumed: a caller is free to put content
  // above the rows inside its scroller, and getting this wrong silently offsets
  // every row and every scrollToIndex.
  useLayoutEffect(() => {
    const rowsEl = rowsRef.current;
    const scrollEl = scrollElRef.current;
    if (!rowsEl || !scrollEl) return;
    const margin = rowsEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
    setScrollMargin(Math.max(0, Math.round(margin)));
  }, [density, scrollElRef, showAlbum, hasRows]);

  const rowVirtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollElRef.current,
    estimateSize: () => ROW_HEIGHTS[density],
    overscan: 10,
    scrollMargin,
    initialOffset,
  });
  if (virtualizerRef) virtualizerRef.current = rowVirtualizer;

  // Row height changes with density — force the virtualizer to re-measure.
  useEffect(() => {
    rowVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density]);

  const trackIds = useMemo(() => tracks.map(t => t.filePath), [tracks]);

  // Row callbacks must be referentially stable or every App render re-renders
  // all ~25 mounted memo'd rows (measured at ~70ms menu-open → paint before
  // this). Latest-value-ref idiom: the callbacks close over nothing volatile
  // and read the current values through this ref at call time.
  const latestRef = useRef(null);
  latestRef.current = { selection, onShowMenu, currentTrack, togglePlay, playTrack };

  const handlePlayToggle = useCallback((track) => {
    const { currentTrack, togglePlay, playTrack } = latestRef.current;
    if (currentTrack?.filePath === track.filePath) togglePlay();
    else playTrack(track, false);
  }, []);

  const handleRowDoubleClick = useCallback((track) => {
    latestRef.current.playTrack(track, false);
  }, []);

  // Guards the contextmenu belt: the contextmenu event that immediately
  // follows a handled button-2 mousedown must not reopen/flicker the menu.
  const lastMenuOpenRef = useRef({ path: null, t: 0 });

  const handleRowMenu = useCallback((track, index, rect) => {
    const { selection, onShowMenu } = latestRef.current;
    lastMenuOpenRef.current = { path: track.filePath, t: performance.now() };
    if (!selection.isSelected(track.filePath)) {
      selection.selectSingle(index);
      onShowMenu([track.filePath], rect);
    } else {
      onShowMenu(selection.selectedPathsRef.current, rect);
    }
  }, []);

  const handleRowContextMenu = useCallback((track, index, rect) => {
    const last = lastMenuOpenRef.current;
    if (last.path === track.filePath && performance.now() - last.t < 400) return;
    handleRowMenu(track, index, rect);
  }, [handleRowMenu]);

  const handleKeyDown = (e) => {
    if (tracks.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        e.stopPropagation();
        const idx = selection.moveFocus(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
        if (idx != null) rowVirtualizer.scrollToIndex(idx, { align: 'auto' });
        break;
      }
      case 'Home':
      case 'End': {
        e.preventDefault();
        e.stopPropagation();
        const idx = selection.focusIndex(e.key === 'Home' ? 0 : tracks.length - 1, e.shiftKey);
        if (idx != null) rowVirtualizer.scrollToIndex(idx, { align: 'auto' });
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const idx = selection.focusedIndex;
        if (idx != null && tracks[idx]) playTrack(tracks[idx], false);
        break;
      }
      case 'Backspace':
      case 'Delete': {
        if (!onRemoveTracks) break;
        e.preventDefault();
        e.stopPropagation();
        if (selection.selectedPathsRef.current.length > 0) {
          onRemoveTracks(selection.selectedPathsRef.current);
        }
        break;
      }
      case 'Escape':
        selection.clear();
        break;
      default:
        break;
    }
    // ArrowLeft/Right intentionally fall through to the global ±5s seek.
  };

  const leading = canDrag ? 'handle' : 'index';

  const renderRow = (virtualRow) => {
    const track = tracks[virtualRow.index];
    const common = {
      track,
      index: virtualRow.index,
      isCurrent: currentTrack?.filePath === track.filePath,
      isPlaying,
      isSelected: selection.selected.has(track.filePath),
      density,
      sortField: sort.field,
      leading,
      showAlbum,
      onRowClick: selection.handleRowClick,
      onRowDoubleClick: handleRowDoubleClick,
      onPlayToggle: handlePlayToggle,
      onRowMenu: handleRowMenu,
      onRowContextMenu: handleRowContextMenu,
    };
    return (
      <div
        key={track.filePath}
        style={{
          position: 'absolute', top: 0, left: 0, width: '100%',
          transform: `translateY(${virtualRow.start - scrollMargin}px)`,
        }}
      >
        {canDrag ? <DraggableTrackRow {...common} /> : <TrackRow {...common} />}
      </div>
    );
  };

  const rowsBlock = (
    <div
      ref={rowsRef}
      // Keyed on the sort so a sort change re-mounts with a soft fade-in.
      key={`${sort.field}:${sort.dir}`}
      className="track-rows-appear"
      style={{ position: 'relative', height: rowVirtualizer.getTotalSize() }}
    >
      {rowVirtualizer.getVirtualItems().map(renderRow)}
    </div>
  );

  return (
    <div
      ref={containerRef}
      className="track-list"
      tabIndex={0}
      style={{ outline: 'none' }}
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => {
        // Keep keyboard nav live after any click in the list; don't steal
        // focus from real form controls (none live here today).
        const tag = e.target.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          containerRef.current?.focus({ preventScroll: true });
        }
      }}
    >
      {tracks.length === 0 ? (
        emptyState ?? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'var(--text-secondary)', fontSize: 14 }}>
            No tracks found.
          </div>
        )
      ) : canDrag ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={trackIds} strategy={verticalListSortingStrategy}>
            {rowsBlock}
          </SortableContext>
        </DndContext>
      ) : (
        rowsBlock
      )}
    </div>
  );
}
