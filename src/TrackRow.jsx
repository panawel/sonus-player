import { memo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Music, MoreVertical, Play, Pause, Mic2 } from 'lucide-react';
import cx from 'classnames';
import { formatTime, ROW_HEIGHTS, ART_SIZES } from './trackUtils.js';

const TITLE_SIZE = { compact: 13, comfortable: 14 };
const SUB_SIZE = { compact: 11, comfortable: 12 };

// One combined two-line cell (Title/Artist or Album/Year). `flip` swaps which
// line is the bold primary — driven by the active sort field, so a list sorted
// by Artist reads artist-first.
function StackedCell({ top, bottom, flip, density, flexGrow }) {
  const primary = flip ? bottom : top;
  const secondary = flip ? top : bottom;
  return (
    <div style={{ flex: `${flexGrow} 1 0px`, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: density === 'compact' ? 1 : 2 }}>
      <div style={{ fontWeight: 600, fontSize: TITLE_SIZE[density], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)', transition: 'font-size 0.15s ease' }}>
        {primary || <span style={{ opacity: 0.35 }}>—</span>}
      </div>
      {secondary ? (
        <div style={{ fontSize: SUB_SIZE[density], color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {secondary}
        </div>
      ) : null}
    </div>
  );
}

function TrackRowImpl({
  track, index,
  isCurrent, isPlaying, isSelected,
  density = 'compact',
  sortField = 'manual',
  leading = 'index',            // 'handle' | 'index'
  sortable = null,              // { setNodeRef, style, handleProps, isDragging } in drag mode
  showAlbum = true,
  onRowClick, onRowDoubleClick, onPlayToggle, onRowMenu, onRowContextMenu,
}) {
  const [hovered, setHovered] = useState(false);
  const art = ART_SIZES[density];
  const showOverlay = (isCurrent && isPlaying) || hovered;

  return (
    <div
      ref={sortable?.setNodeRef}
      className={cx('track-row', { active: isCurrent, selected: isSelected })}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        height: ROW_HEIGHTS[density],
        padding: '0 12px',
        borderRadius: 8,
        cursor: 'default',
        position: 'relative',
        ...(sortable?.style),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => onRowClick?.(track, index, e)}
      onDoubleClick={() => onRowDoubleClick?.(track)}
      onMouseDown={(e) => {
        if (e.button !== 2) return;
        e.preventDefault();
        onRowMenu?.(track, index, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 });
      }}
      onContextMenu={(e) => {
        // Belt for input paths that don't produce a button-2 mousedown
        // (notably macOS Ctrl+click). TrackList's guard makes the contextmenu
        // that immediately follows a handled right-button mousedown a no-op.
        e.preventDefault();
        onRowContextMenu?.(track, index, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 });
      }}
    >
      {/* Leading: drag handle (manual order) or position index */}
      <div
        {...(leading === 'handle' ? sortable?.handleProps : undefined)}
        style={{
          width: 24, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: leading === 'handle' ? 'grab' : 'default',
          color: 'var(--text-secondary)',
        }}
        onClick={leading === 'handle' ? (e) => e.stopPropagation() : undefined}
      >
        {leading === 'handle'
          ? <GripVertical size={15} />
          : <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', opacity: hovered ? 0.9 : 0.55, color: isCurrent ? 'var(--accent-color)' : undefined }}>{index + 1}</span>
        }
      </div>

      {/* Artwork + play/pause overlay + EQ bars while playing */}
      <div style={{ position: 'relative', width: art, height: art, borderRadius: 6, background: 'var(--glass-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
        {track.thumb
          ? <img src={track.thumb} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
          : <Music size={density === 'compact' ? 14 : 18} color="var(--text-secondary)" />
        }
        {showOverlay && (
          <div
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: hovered ? 'center' : 'flex-end', justifyContent: 'center', cursor: 'pointer', gap: 2, paddingBottom: hovered ? 0 : 6 }}
            onClick={(e) => { e.stopPropagation(); onPlayToggle?.(track); }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {hovered
              ? (isCurrent && isPlaying
                  ? <Pause size={density === 'compact' ? 15 : 18} fill="white" color="white" />
                  : <Play size={density === 'compact' ? 14 : 17} fill="white" color="white" />)
              : (<><div className="eq-bar" /><div className="eq-bar" /><div className="eq-bar" /></>)
            }
          </div>
        )}
      </div>

      {/* Title / Artist — artist becomes primary when sorting by artist */}
      <StackedCell top={track.title} bottom={track.artist} flip={sortField === 'artist'} density={density} flexGrow={1.6} />

      {/* Album / Year — year is no longer a sortable field, so this cell never
          flips; album stays the primary line. */}
      {showAlbum && (
        <StackedCell top={track.album} bottom={track.year ? String(track.year) : ''} flip={false} density={density} flexGrow={1} />
      )}

      {/* Lyrics indicator */}
      <div style={{ width: 20, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {track.lyrics && <Mic2 size={12} color="var(--text-secondary)" />}
      </div>

      {/* Duration ⇄ menu button — both mounted, crossfaded, zero layout shift */}
      <div style={{ width: 52, flexShrink: 0, position: 'relative', height: '100%' }}>
        <span style={{
          position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
          fontSize: SUB_SIZE[density] + 1, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums',
          opacity: hovered ? 0 : 1, transition: 'opacity 0.12s ease', pointerEvents: 'none',
        }}>
          {formatTime(track.duration)}
        </span>
        <button
          className="clickable track-menu-btn"
          tabIndex={-1}
          style={{
            position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
            background: 'transparent', border: 'none', padding: 4, cursor: 'pointer',
            color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4,
            opacity: hovered ? 1 : 0, transition: 'opacity 0.12s ease',
            pointerEvents: hovered ? 'auto' : 'none',
          }}
          onClick={(e) => { e.stopPropagation(); onRowMenu?.(track, index, e.currentTarget.getBoundingClientRect()); }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <MoreVertical size={15} />
        </button>
      </div>
    </div>
  );
}

export const TrackRow = memo(TrackRowImpl);

// dnd-kit wrapper used only in manual-order mode (≤5k tracks). Kept separate
// so TrackRow itself never calls useSortable — rows outside a DndContext
// (sorted mode, Details view) stay hook-free and cheap. A memoized component
// (not a render-prop) so its props are the same stable primitives as
// TrackRow's: parent re-renders skip it entirely; dnd context updates during
// an actual drag still reach it through useSortable's own subscription.
export const DraggableTrackRow = memo(function DraggableTrackRow(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.track.filePath });
  const sortable = {
    setNodeRef,
    style: {
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? 100 : undefined,
      opacity: isDragging ? 0.85 : undefined,
      boxShadow: isDragging ? '0 10px 30px rgba(0,0,0,0.5)' : undefined,
      background: isDragging ? 'var(--glass-bg)' : undefined,
      backdropFilter: isDragging ? 'blur(20px)' : undefined,
    },
    handleProps: { ...attributes, ...listeners },
  };
  return <TrackRowImpl {...props} sortable={sortable} />;
});
