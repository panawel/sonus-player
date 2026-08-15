import { ChevronUp, ChevronDown, AlignJustify, LayoutList } from 'lucide-react';
import cx from 'classnames';
import { SORT_FIELDS, activeFieldForColumn, ART_SIZES } from './trackUtils.js';

const fieldLabel = (id) => SORT_FIELDS.find(f => f.id === id)?.label ?? id;

function SortArrow({ dir }) {
  return dir === 'asc'
    ? <ChevronUp size={11} style={{ flexShrink: 0 }} />
    : <ChevronDown size={11} style={{ flexShrink: 0 }} />;
}

// One clickable column label. Clicking advances that column's cycle. The label
// renames itself only when the active field is a *borrowed* one — i.e. the
// Title column reads "Artist" while sorted by artist, so the current state is
// readable with no extra chrome. A column sorted by its own field keeps its own
// name ("Time", not "Duration"), and manual order shows the name with no arrow.
// columnId doubles as the column's primary field id, which is what makes the
// "borrowed" comparison a plain equality check.
function HeaderZone({ columnId, fallbackLabel, sort, onCycleColumn, style }) {
  const active = activeFieldForColumn(columnId, sort);
  const borrowed = active && active !== columnId;
  return (
    <button
      className={cx('track-header-label clickable', { active: !!active })}
      style={style}
      onClick={() => onCycleColumn(columnId)}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {borrowed ? fieldLabel(active) : fallbackLabel}
      </span>
      {active && <SortArrow dir={sort.dir} />}
    </button>
  );
}

// The column line. Rendered by the layout owner *above* its scroll container,
// never inside it — nothing ever passes behind these labels, which is why the
// bar needs no background, no blur and no scrolled state. It is a hairline:
// text over a rule, and that is all.
export default function TrackListHeader({
  sort, onCycleColumn,
  density, onDensityChange,
  showAlbum = true,
}) {
  return (
    <div className="track-list-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {/* Leading spacer stands in for the row's index + artwork cells, so every
          label below sits over the column it actually sorts. */}
      <div style={{ width: 24 + 12 + ART_SIZES[density], flexShrink: 0 }} />
      <HeaderZone columnId="title" fallbackLabel="Title" sort={sort} onCycleColumn={onCycleColumn} style={{ flex: '1.6 1 0px', minWidth: 0 }} />
      {showAlbum && (
        <HeaderZone columnId="album" fallbackLabel="Album" sort={sort} onCycleColumn={onCycleColumn} style={{ flex: '1 1 0px', minWidth: 0 }} />
      )}
      {/* Density sits in the 20px slot that lines up with the row's lyrics
          indicator — the only free space left that doesn't push Time out of
          alignment with the duration column. */}
      <div style={{ width: 20, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
        <button
          className="track-header-density clickable"
          title={density === 'compact' ? 'Roomier rows' : 'Tighter rows'}
          onClick={() => onDensityChange(density === 'compact' ? 'comfortable' : 'compact')}
        >
          {density === 'compact' ? <AlignJustify size={13} /> : <LayoutList size={13} />}
        </button>
      </div>
      <HeaderZone columnId="duration" fallbackLabel="Time" sort={sort} onCycleColumn={onCycleColumn} style={{ width: 52, flexShrink: 0, justifyContent: 'flex-end' }} />
    </div>
  );
}
