import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Music, User, ChevronDown } from 'lucide-react';
import { splitArtists } from './audioUtils.js';
import { trackMatchesQuery, formatTime } from './trackUtils.js';

const SONG_PAGE = 20;
const TILE_LIMIT = 8;

// Swallows the rest of a mouse gesture whose pointerdown already closed the
// panel: the panel unmounts immediately, so these listeners live on `window`
// and remove themselves ~450ms after the button is released (long enough to
// also eat the second click/dblclick of a fast double-click), or after 5s if
// no release ever arrives.
const SWALLOWED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'];
function swallowGesture() {
  const eat = (e) => { e.preventDefault(); e.stopPropagation(); };
  let timer = null;
  const done = () => {
    clearTimeout(timer);
    for (const type of SWALLOWED) window.removeEventListener(type, eat, true);
    window.removeEventListener('pointerup', onUp, true);
  };
  const onUp = () => { clearTimeout(timer); timer = setTimeout(done, 450); };
  for (const type of SWALLOWED) window.addEventListener(type, eat, true);
  window.addEventListener('pointerup', onUp, true);
  timer = setTimeout(done, 5000);
}

function Tile({ round, size, thumb, title, subtitle, onClick }) {
  return (
    <button className="clickable search-panel-tile" onClick={onClick} style={{ width: size }}>
      <div style={{ width: size, height: size, borderRadius: round ? '50%' : 12, overflow: 'hidden', background: 'var(--glass-active)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {thumb
          ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : (round ? <User size={size * 0.35} color="var(--text-secondary)" /> : <Music size={size * 0.35} color="var(--text-secondary)" />)}
      </div>
      <div className="search-panel-tile-title">{title}</div>
      <div className="search-panel-tile-sub">{subtitle}</div>
    </button>
  );
}

// The floating search panel, opened from the title bar's search button or ⌘F.
// A Spotlight-style layer over whatever page you're on. On Library and Details
// pages that page's own list is ALSO filtering live as you type (App.jsx).
//
// Closing: Escape (clears the text first), the X, changing page, or a click
// anywhere outside the panel. An outside click only CLOSES: it is swallowed
// (swallowGesture below), so nothing behind the panel reacts to it — you click
// again once it's gone. It calls onDismiss rather than onClose because on
// Library/Details it leaves the filter on the list (App.jsx dismissSearch);
// Escape/X are the "clear it" paths.
//
// Scope: whole library by default (grouped Artists / Albums / Songs). On a
// Details page it starts scoped to that page's tracks (Songs only) and a chip
// widens it to the whole library. Artists and albums open their Details page,
// songs play; the panel stays open after a song so you can keep choosing.
export default function SearchPanel({
  query, onQueryChange, onClose, onDismiss,
  library, pageTracks, pageLabel,
  onOpenDetail, playTrack, currentTrack,
  isNarrowLayout,
}) {
  const inputRef = useRef(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  const q = query.trim().toLowerCase();

  const hasPageScope = Array.isArray(pageTracks);
  const [wide, setWide] = useState(false);
  const pageScoped = hasPageScope && !wide;
  const source = pageScoped ? pageTracks : library;

  const [songLimit, setSongLimit] = useState(SONG_PAGE);
  useEffect(() => { setSongLimit(SONG_PAGE); }, [q, pageScoped]);

  // Reopening over a still-filtered list shows its text, selected so typing replaces it.
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  // Escape works wherever focus is (the user may have clicked a row in the
  // live-filtered list behind): clear the text first, then close.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (queryRef.current) onQueryChange('');
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onQueryChange, onClose]);

  // Click outside closes and is swallowed — see the header comment. The search
  // button is left to its own handler (it refocuses an open panel), and the
  // track context menu / modals are layers on top that the page opens itself.
  const onDismissRef = useRef(onDismiss ?? onClose);
  onDismissRef.current = onDismiss ?? onClose;
  useEffect(() => {
    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('.search-panel, .nav-search-btn, .track-dropdown, .confirm-modal-panel')) return;
      e.preventDefault();
      e.stopPropagation();
      swallowGesture();
      onDismissRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const { artists, albums, songs } = useMemo(() => {
    if (!q) return { artists: [], albums: [], songs: [] };
    const artistMap = new Map();
    const albumMap = new Map();
    const songList = [];
    for (const t of source) {
      if (!pageScoped) {
        for (const name of splitArtists(t.artist || '')) {
          const key = name.toLowerCase();
          if (!key.includes(q)) continue;
          const e = artistMap.get(key) ?? { name, count: 0, thumb: null };
          e.count += 1;
          if (!e.thumb && t.thumb) e.thumb = t.thumb;
          artistMap.set(key, e);
        }
        const album = (t.album || '').trim();
        if (album && album.toLowerCase().includes(q)) {
          const key = album.toLowerCase();
          const e = albumMap.get(key) ?? { name: album, artist: t.artist || '', count: 0, thumb: null };
          e.count += 1;
          if (!e.thumb && t.thumb) e.thumb = t.thumb;
          albumMap.set(key, e);
        }
      }
      if (trackMatchesQuery(t, q)) songList.push(t);
    }
    const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
    // Songs whose title starts with the text, then ones that contain it, then
    // the rest (matched on artist/album/year/genre); stable within each tier.
    const tier = (t) => { const title = (t.title || '').toLowerCase(); return title.startsWith(q) ? 0 : title.includes(q) ? 1 : 2; };
    songList.sort((a, b) => tier(a) - tier(b));
    return { artists: [...artistMap.values()].sort(byCount), albums: [...albumMap.values()].sort(byCount), songs: songList };
  }, [source, q, pageScoped]);

  const none = artists.length === 0 && albums.length === 0 && songs.length === 0;
  const tileSize = isNarrowLayout ? 72 : 84;

  return (
    <div className="search-panel" style={{ width: 'min(580px, calc(100vw - 24px))' }}>
      <div className="search-panel-header">
        <Search size={16} style={{ flexShrink: 0, color: 'var(--chrome-text-dim)' }} />
        <input
          ref={inputRef}
          type="text"
          className="search-panel-input"
          placeholder={pageScoped ? `Search ${pageLabel}` : 'Search your library'}
          value={query}
          onChange={e => onQueryChange(e.target.value)}
        />
        {hasPageScope && (
          <button
            className="clickable search-panel-chip"
            title={pageScoped ? 'Searching this page. Click to search the whole library' : 'Searching the whole library. Click to search this page only'}
            onClick={() => setWide(w => !w)}
          >
            <span className="search-panel-chip-label">{pageScoped ? `In ${pageLabel}` : 'Library'}</span>
            <ChevronDown size={12} />
          </button>
        )}
        <button
          className="clickable search-panel-x"
          title={query ? 'Clear search' : 'Close search'}
          aria-label={query ? 'Clear search' : 'Close search'}
          onMouseDown={e => e.preventDefault()}
          onClick={() => { if (query) { onQueryChange(''); inputRef.current?.focus(); } else onClose(); }}
        >
          <X size={14} />
        </button>
      </div>

      {q && (
        <div className="search-panel-body">
          {none && <p className="search-panel-none">No results for "{query.trim()}".</p>}

          {artists.length > 0 && (
            <section>
              <h3 className="search-panel-h">Artists</h3>
              <div className="search-panel-tiles">
                {artists.slice(0, TILE_LIMIT).map(a => (
                  <Tile key={a.name} round size={tileSize} thumb={a.thumb} title={a.name}
                    subtitle={`${a.count} song${a.count !== 1 ? 's' : ''}`}
                    onClick={() => onOpenDetail({ type: 'artist', key: a.name })} />
                ))}
              </div>
            </section>
          )}

          {albums.length > 0 && (
            <section>
              <h3 className="search-panel-h">Albums</h3>
              <div className="search-panel-tiles">
                {albums.slice(0, TILE_LIMIT).map(a => (
                  <Tile key={a.name} size={tileSize} thumb={a.thumb} title={a.name}
                    subtitle={a.artist || `${a.count} song${a.count !== 1 ? 's' : ''}`}
                    onClick={() => onOpenDetail({ type: 'album', key: a.name })} />
                ))}
              </div>
            </section>
          )}

          {songs.length > 0 && (
            <section>
              <h3 className="search-panel-h">Songs</h3>
              {songs.slice(0, songLimit).map(t => {
                const isCurrent = currentTrack?.filePath === t.filePath;
                return (
                  <div key={t.filePath} className="track-row clickable search-panel-song" onClick={() => playTrack(t, false)}>
                    <div className="search-panel-song-art">
                      {t.thumb ? <img src={t.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music size={15} color="var(--text-secondary)" />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="search-panel-song-title" style={{ color: 'var(--chrome-text)', fontWeight: isCurrent ? 700 : undefined }}>{t.title}</div>
                      <div className="search-panel-song-sub">{t.artist}{t.album ? ` · ${t.album}` : ''}</div>
                    </div>
                    <div className="search-panel-song-time">{formatTime(t.duration)}</div>
                  </div>
                );
              })}
              {songs.length > songLimit && (
                <button className="glass-button clickable search-panel-more" onClick={() => setSongLimit(n => n + 40)}>
                  Show more ({songs.length - songLimit} more)
                </button>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
