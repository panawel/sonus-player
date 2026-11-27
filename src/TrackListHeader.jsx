import { ChevronUp, ChevronDown, AlignJustify, LayoutList, Search, X } from 'lucide-react';
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
  // Library-only extended layout switch — see the matching prop on TrackRow
  // (TrackRow.jsx) for the full explanation. null keeps today's header
  // exactly as-is; an array appends extra column labels after Time and adds
  // a trailing spacer matching the row's standalone ⋮ button slot.
  extraColumns = null,
  // The Library's search (null elsewhere): a 🔍 in the leading slot; opened, the Title label
  // becomes the search field, which grows out of the icon over the Title column. The other
  // columns stay, so results can still be sorted. { open, query, count, total, inputRef,
  // onOpen, onQueryChange, onClear, onClose } — App.jsx owns the state and the keys.
  search = null,
}) {
  const extended = extraColumns !== null;
  const lead = 24 + 12 + ART_SIZES[density];
  const open = !!search?.open;
  return (
    <div className="track-list-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {/* Leading spacer stands in for the row's index + artwork cells, so every
          label below sits over the column it actually sorts. */}
      <div style={{ width: lead, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {search && (
          <button
            className={cx('track-header-search clickable', { hidden: open })}
            title="Search (⌘F)"
            aria-label="Search the Library"
            tabIndex={open ? -1 : 0}
            onClick={() => search.onOpen()}
          >
            <Search size={14} />
          </button>
        )}
      </div>
      <div className={cx('track-header-title-zone', { 'search-open': open })} style={{ flex: '1.6 1 0px', minWidth: 0, position: 'relative', display: 'flex', alignItems: 'center' }}>
        <HeaderZone columnId="title" fallbackLabel="Title" sort={sort} onCycleColumn={onCycleColumn} style={{ flex: '1 1 auto', minWidth: 0 }} />
        {search && (
          <label className={cx('list-search', { open })} style={{ left: -(lead + 12) }} data-list-search={open ? 'open' : 'closed'}>
            <Search size={14} className="list-search-icon" />
            <input
              ref={search.inputRef}
              value={search.query}
              onChange={(e) => search.onQueryChange(e.target.value)}
              placeholder="Search songs, artists, albums"
              aria-label="Search the Library"
              spellCheck={false}
              autoComplete="off"
              tabIndex={open ? 0 : -1}
            />
            {search.query.trim() && <span className="list-search-count">{search.count.toLocaleString()} of {search.total.toLocaleString()}</span>}
            <button
              className="list-search-clear clickable"
              title={search.query ? 'Clear (Esc)' : 'Close (Esc)'}
              aria-label={search.query ? 'Clear search' : 'Close search'}
              tabIndex={open ? 0 : -1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.preventDefault(); if (search.query) search.onClear(); else search.onClose(); }}
            >
              <X size={11} />
            </button>
          </label>
        )}
      </div>
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
      {extended && extraColumns.map((col, i) => (
        <HeaderZone
          key={col.id}
          columnId={col.id}
          fallbackLabel={col.label}
          sort={sort}
          onCycleColumn={onCycleColumn}
          style={{
            ...(col.width ? { width: col.width, flexShrink: 0 } : { flex: `${col.flex} 1 0px`, minWidth: 0 }),
            ...(col.align === 'right' ? { justifyContent: 'flex-end' } : {}),
            ...(i === 0 ? { marginLeft: 20 } : {}),
          }}
        />
      ))}
      {/* Matches the row's standalone ⋮ button slot, which the header has no
          label for — keeps flexible columns (Title, Album, Genre) aligned. */}
      {extended && <div style={{ width: 28, flexShrink: 0 }} />}
    </div>
  );
}
