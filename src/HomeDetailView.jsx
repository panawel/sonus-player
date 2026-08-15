import { useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { Music, Play, Shuffle, ChevronLeft, Calendar, Headphones, AlertCircle } from 'lucide-react';
import TrackList from './TrackList.jsx';
import TrackListHeader from './TrackListHeader.jsx';
import { useTrackSort } from './useTrackSort.js';
import { useTrackSelection } from './useTrackSelection.js';

const MISSING_TITLES = { art: 'Missing Art', year: 'Missing Year', lyrics: 'Missing Lyrics' };
import { snapToTier, splitArtists, detectScript } from './audioUtils.js';

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function HomeDetailView({ item, library, currentTrack, isPlaying, playTrack, togglePlay, playAllTracks, onShowMenu, onRemoveTracks, onBack, backLabel = 'Home', savedScrollTop = 0, onScrollChange, density, onDensityChange, selectionRegistryRef }) {
  const tracks = useMemo(() => {
    if (item.type === 'album') return library.filter(t => (t.album || '').toLowerCase() === item.key.toLowerCase());
    if (item.type === 'year') {
      return library
        .filter(t => { const y = parseInt(t.year); return !isNaN(y) && String(y) === item.key; })
        .sort((a, b) => (a.artist || '').localeCompare(b.artist || '') || (a.title || '').localeCompare(b.title || ''));
    }
    if (item.type === 'bitrate') {
      return library
        .filter(t => t.bitrate != null && String(snapToTier(t.bitrate)) === item.key)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    }
    if (item.type === 'language') {
      return library
        .filter(t => detectScript(t.title) === item.key)
        .sort((a, b) => (a.artist || '').localeCompare(b.artist || '') || (a.title || '').localeCompare(b.title || ''));
    }
    if (item.type === 'missing-metadata') {
      let filtered;
      if (item.key === 'art') {
        filtered = library.filter(t => !t.thumb);
      } else if (item.key === 'year') {
        filtered = library.filter(t => { const y = parseInt(t.year); return isNaN(y) || y <= 0; });
      } else {
        filtered = library.filter(t => t.filePath?.toLowerCase().endsWith('.mp3') && (!t.lyrics || !t.lyrics.trim()));
      }
      return filtered.sort((a, b) =>
        (a.artist || '').localeCompare(b.artist || '') || (a.title || '').localeCompare(b.title || '')
      );
    }
    return library.filter(t => splitArtists(t.artist || '').some(a => a.toLowerCase() === item.key.toLowerCase()));
  }, [item, library]);

  const innerScrollRef = useRef(null);

  // Per-open sort (resets whenever the detail item changes) + selection.
  const sortApi = useTrackSort(tracks, { resetKey: `${item.type}:${item.key}` });
  const selection = useTrackSelection(sortApi.sorted);

  // Register as the active list for Cmd+A (App-menu IPC routes through this).
  useEffect(() => {
    if (!selectionRegistryRef) return;
    selectionRegistryRef.current = selection;
    return () => {
      if (selectionRegistryRef.current === selection) selectionRegistryRef.current = null;
    };
  });

  // Restore saved scroll position on mount without a render-then-jump flash.
  // TrackList's virtualizer gets the same value as initialOffset; this syncs
  // the actual DOM scrollTop to match.
  useLayoutEffect(() => {
    if (innerScrollRef.current && savedScrollTop > 0) {
      innerScrollRef.current.scrollTop = savedScrollTop;
    }
  }, []); // mount-only

  const artwork = useMemo(() => tracks.find(t => t.thumb)?.thumb || null, [tracks]);

  const mosaicArtworks = useMemo(() => {
    if (item.type !== 'language') return null;
    const seen = new Set();
    const result = [];
    for (const t of tracks) {
      if (t.thumb && !seen.has(t.thumb)) {
        seen.add(t.thumb);
        result.push(t.thumb);
        if (result.length === 4) break;
      }
    }
    return result;
  }, [item.type, tracks]);

  const subtitle = useMemo(() => {
    const parts = [];
    if (item.type === 'album') {
      const artist = tracks.find(t => t.artist)?.artist;
      if (artist) parts.push(artist);
      const year = tracks.find(t => t.year)?.year;
      if (year) parts.push(String(year));
    }
    if (item.type === 'year') {
      const artistCount = new Set(tracks.map(t => t.artist).filter(Boolean)).size;
      if (artistCount > 1) parts.push(`${artistCount} artists`);
    }
    if (item.type === 'language' || item.type === 'bitrate' || item.type === 'missing-metadata') {
      const artistCount = new Set(tracks.map(t => t.artist).filter(Boolean)).size;
      if (artistCount > 1) parts.push(`${artistCount} artists`);
    }
    parts.push(`${tracks.length} track${tracks.length !== 1 ? 's' : ''}`);
    const totalSec = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    if (totalSec > 60) parts.push(formatDuration(totalSec));
    return parts.join(' · ');
  }, [tracks, item.type]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Back breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28, flexShrink: 0 }}>
        <button
          className="player-control-button clickable"
          style={{ color: 'var(--text-secondary)', padding: 8 }}
          onClick={onBack}
        >
          <ChevronLeft size={20} />
        </button>
        <span
          style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}
          onClick={onBack}
        >
          {backLabel}
        </span>
      </div>

      {/* Detail hero */}
      <div style={{ display: 'flex', gap: 28, marginBottom: 32, flexShrink: 0, alignItems: 'flex-end' }}>
        {item.type === 'language' ? (
          <div style={{
            width: 160, height: 160, flexShrink: 0,
            borderRadius: 16, overflow: 'hidden',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr',
            gap: 2,
            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'var(--glass-active)',
          }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ overflow: 'hidden', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {mosaicArtworks[i]
                  ? <img src={mosaicArtworks[i]} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt="" />
                  : <Music size={20} color="var(--text-secondary)" style={{ opacity: 0.3 }} />
                }
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            width: 160, height: 160, flexShrink: 0,
            borderRadius: item.type === 'artist' ? '50%' : 16,
            overflow: 'hidden', background: 'var(--glass-active)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            {artwork
              ? <img src={artwork} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={item.key} />
              : item.type === 'year'
                ? <Calendar size={56} color="var(--text-secondary)" />
                : item.type === 'bitrate'
                  ? <Headphones size={56} color="var(--text-secondary)" />
                  : item.type === 'missing-metadata'
                    ? <AlertCircle size={56} color="var(--text-secondary)" />
                    : <Music size={56} color="var(--text-secondary)" />
            }
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            {item.type === 'album' ? 'Album' : item.type === 'year' ? 'Year' : item.type === 'bitrate' ? 'Quality' : item.type === 'missing-metadata' ? 'Metadata' : item.type === 'language' ? 'Language' : 'Artist'}
          </div>
          <h2 style={{ fontSize: 'clamp(22px, 3vw, 40px)', fontWeight: 800, marginBottom: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.type === 'missing-metadata' ? (MISSING_TITLES[item.key] ?? item.key) : item.key}
          </h2>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 22 }}>
            {subtitle}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="clickable"
              disabled={tracks.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px', borderRadius: 24, background: 'var(--accent-color)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: tracks.length === 0 ? 0.4 : 1 }}
              onClick={() => playAllTracks(sortApi.sorted, false)}
            >
              <Play size={14} fill="#fff" color="#fff" />
              Play All
            </button>
            <button
              className="glass-button clickable"
              disabled={tracks.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px', borderRadius: 24, fontWeight: 600, fontSize: 13, opacity: tracks.length === 0 ? 0.4 : 1 }}
              onClick={() => playAllTracks(sortApi.sorted, true)}
            >
              <Shuffle size={13} />
              Shuffle
            </button>
          </div>
        </div>
      </div>

      {/* Column header — outside the scroll box below, so rows never pass
          behind the labels (same reason as the Library screen). */}
      {/* paddingRight 6 matches the scrollbar gutter the scroller below reserves
          — the header is outside it and so keeps that width. Same compensation
          the Library screen makes; the smoke suite asserts both to the pixel. */}
      <div style={{ flexShrink: 0, marginBottom: 6, paddingRight: 6 }}>
        <TrackListHeader
          sort={sortApi.sort}
          onCycleColumn={sortApi.cycleColumn}
          density={density}
          onDensityChange={onDensityChange}
          showAlbum={item.type !== 'album'}
        />
      </div>

      {/* Track list — unified engine (no drag: detail order is sort-driven) */}
      <div
        ref={innerScrollRef}
        style={{ flex: 1, overflowY: 'auto', marginRight: -8, paddingRight: 8, scrollbarGutter: 'stable' }}
        onScroll={(e) => onScrollChange?.(e.currentTarget.scrollTop)}
      >
        <TrackList
          tracks={sortApi.sorted}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          density={density}
          selection={selection}
          sort={sortApi.sort}
          playTrack={playTrack}
          togglePlay={togglePlay}
          onShowMenu={onShowMenu}
          onRemoveTracks={onRemoveTracks}
          scrollElRef={innerScrollRef}
          showAlbum={item.type !== 'album'}
          initialOffset={savedScrollTop}
        />
      </div>
    </div>
  );
}
