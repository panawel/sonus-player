import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { Music, Play, Shuffle, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
import cx from 'classnames';
import { snapToTier, tierLabel, splitArtists, detectScript } from './audioUtils.js';
import { formatTime } from './trackUtils.js';

// Mulberry32 seeded PRNG — deterministic shuffle that stays stable until user hits Refresh.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, seed) {
  const rng = mulberry32((seed * 2147483647) | 0);
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function trackMatchesGenre(track, genre) {
  if (!genre) return true;
  return (track.genre || '')
    .split(',')
    .map(g => g.trim())
    .includes(genre);
}

function parseGenres(library) {
  const set = new Set();
  for (const track of library) {
    if (track.genre) {
      track.genre.split(',').map(g => g.trim()).filter(Boolean).forEach(g => set.add(g));
    }
  }
  return Array.from(set).sort();
}

function groupByAlbum(tracks) {
  const map = new Map();    // key: lowercase album name
  const counts = new Map(); // key: lowercase → Map<displayName, count>
  for (const track of tracks) {
    const raw = track.album || '';
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { name: raw, artist: track.artist || '', artwork: null, year: '', tracks: [] });
      counts.set(key, new Map());
    }
    const entry = map.get(key);
    entry.tracks.push(track);
    if (!entry.artwork && track.thumb) entry.artwork = track.thumb;
    if (!entry.year && track.year) entry.year = String(track.year);
    const nc = counts.get(key);
    nc.set(raw, (nc.get(raw) || 0) + 1);
  }
  // Resolve display name to most common casing variant
  for (const [key, entry] of map) {
    let best = entry.name, bestCount = 0;
    for (const [name, count] of counts.get(key)) {
      if (count > bestCount) { bestCount = count; best = name; }
    }
    entry.name = best;
  }
  return Array.from(map.values());
}

function groupByArtist(tracks) {
  const map = new Map();    // key: lowercase token
  const counts = new Map(); // key: lowercase → Map<displayName, count>
  for (const track of tracks) {
    const tokens = splitArtists(track.artist || '');
    for (const token of tokens) {
      const key = token.toLowerCase();
      if (!map.has(key)) {
        map.set(key, { name: token, artwork: null, tracks: [] });
        counts.set(key, new Map());
      }
      const entry = map.get(key);
      entry.tracks.push(track);
      if (!entry.artwork && track.thumb) entry.artwork = track.thumb;
      const nc = counts.get(key);
      nc.set(token, (nc.get(token) || 0) + 1);
    }
  }
  // Resolve display name to most common casing variant
  for (const [key, entry] of map) {
    let best = entry.name, bestCount = 0;
    for (const [name, count] of counts.get(key)) {
      if (count > bestCount) { bestCount = count; best = name; }
    }
    entry.name = best;
  }
  return Array.from(map.values());
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const AlbumCard = memo(function AlbumCard({ album, onOpen, playAllTracks }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="clickable"
      style={{ flexShrink: 0, width: 140, cursor: 'pointer', scrollSnapAlign: 'start' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen({ type: 'album', key: album.name })}
    >
      <div style={{
        position: 'relative', width: 140, height: 140,
        borderRadius: 12, overflow: 'hidden',
        background: 'var(--glass-active)',
        transform: hovered ? 'scale(1.05)' : 'scale(1)',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        boxShadow: hovered ? '0 10px 36px rgba(0,0,0,0.55)' : '0 3px 10px rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {album.artwork
          ? <img src={album.artwork} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt={album.name} />
          : <Music size={40} color="var(--text-secondary)" />
        }
        <div
          style={{
            position: 'absolute', inset: 0, borderRadius: 12,
            background: 'rgba(0,0,0,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.18s ease',
            pointerEvents: hovered ? 'auto' : 'none',
          }}
          onClick={(e) => { e.stopPropagation(); playAllTracks(album.tracks, false); }}
        >
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
            <Play size={20} fill="#000" color="#000" style={{ marginLeft: 2 }} />
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10, overflow: 'hidden' }}>
        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>{album.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
          {[album.artist, album.year].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  );
});

const ArtistCard = memo(function ArtistCard({ artist, onOpen, playAllTracks }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="clickable"
      style={{ flexShrink: 0, width: 124, cursor: 'pointer', scrollSnapAlign: 'start', textAlign: 'center' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen({ type: 'artist', key: artist.name })}
    >
      <div style={{
        position: 'relative', width: 124, height: 124, margin: '0 auto',
        borderRadius: '50%', overflow: 'hidden',
        background: 'var(--glass-active)',
        transform: hovered ? 'scale(1.05)' : 'scale(1)',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        boxShadow: hovered ? '0 10px 36px rgba(0,0,0,0.55)' : '0 3px 10px rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {artist.artwork
          ? <img src={artist.artwork} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt={artist.name} />
          : <Music size={36} color="var(--text-secondary)" />
        }
        <div
          style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'rgba(0,0,0,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.18s ease',
            pointerEvents: hovered ? 'auto' : 'none',
          }}
          onClick={(e) => { e.stopPropagation(); playAllTracks(artist.tracks, false); }}
        >
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
            <Play size={18} fill="#000" color="#000" style={{ marginLeft: 2 }} />
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10, overflow: 'hidden' }}>
        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>{artist.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
          {artist.tracks.length} track{artist.tracks.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
});

const TopArtistRow = memo(function TopArtistRow({ artist, rank, pct, index, onOpen }) {
  const [hovered, setHovered] = useState(false);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setFilled(true), 120 + index * 75);
    return () => clearTimeout(t);
  }, [index]);

  const rankColor = rank === 1 ? '#FFD060' : rank === 2 ? '#B8C4CE' : rank === 3 ? '#C98B5A' : 'var(--text-secondary)';

  return (
    <div
      className="clickable"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '9px 14px', borderRadius: 10,
        background: hovered ? 'var(--glass-highlight)' : 'transparent',
        transition: 'background 0.15s ease',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen({ type: 'artist', key: artist.name })}
    >
      {/* Rank */}
      <div style={{ width: 20, textAlign: 'right', fontSize: 12, fontWeight: 800, color: rankColor, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {rank}
      </div>

      {/* Circle artwork */}
      <div style={{
        width: 34, height: 34, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
        background: 'var(--glass-active)', border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {artist.artwork
          ? <img src={artist.artwork} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt={artist.name} />
          : <Music size={14} color="var(--text-secondary)" />
        }
      </div>

      {/* Name */}
      <div style={{ width: 150, flexShrink: 0, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>
        {artist.name}
      </div>

      {/* Bar */}
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: filled ? `${pct}%` : '0%',
          borderRadius: 3,
          background: 'linear-gradient(90deg, var(--accent-color) 0%, rgba(79,172,254,0.55) 100%)',
          transition: 'width 700ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }} />
      </div>

      {/* Track count */}
      <div style={{ width: 58, textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
        {artist.tracks.length} {artist.tracks.length === 1 ? 'track' : 'tracks'}
      </div>
    </div>
  );
});

function TopArtistsPanel({ artists, onOpen }) {
  const max = artists[0]?.tracks.length || 1;
  return (
    <div>
      {artists.map((artist, i) => (
        <TopArtistRow
          key={artist.name}
          artist={artist}
          rank={i + 1}
          pct={(artist.tracks.length / max) * 100}
          index={i}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function SectionHeader({ title, onScrollLeft, onScrollRight, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {children}
        {onScrollLeft && (
          <>
            <button
              className="player-control-button clickable"
              style={{ padding: 6, color: 'var(--text-secondary)' }}
              onClick={onScrollLeft}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="player-control-button clickable"
              style={{ padding: 6, color: 'var(--text-secondary)' }}
              onClick={onScrollRight}
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const QuickPickRow = memo(function QuickPickRow({ track, currentTrack, isPlaying, playTrack }) {
  const [hovered, setHovered] = useState(false);
  const isCurrent = currentTrack?.filePath === track.filePath;
  return (
    <div
      className="clickable"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px', borderRadius: 10,
        background: isCurrent ? 'var(--glass-active)' : hovered ? 'var(--glass-highlight)' : 'var(--glass-bg)',
        transition: 'background 0.15s ease',
        cursor: 'pointer',
        boxShadow: isCurrent ? 'inset 2px 0 0 var(--accent-color)' : 'none',
        border: '1px solid var(--glass-border)',
        minWidth: 0,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => playTrack(track, false)}
    >
      <div style={{ position: 'relative', width: 38, height: 38, borderRadius: 6, overflow: 'hidden', background: 'var(--glass-active)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {track.thumb
          ? <img src={track.thumb} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
          : <Music size={16} color="var(--text-secondary)" />
        }
        {isCurrent && isPlaying && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.52)', borderRadius: 6, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, paddingBottom: 7 }}>
            <div className="eq-bar" />
            <div className="eq-bar" />
            <div className="eq-bar" />
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          color: isCurrent ? 'var(--accent-color)' : 'var(--text-primary)',
        }}>
          {track.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
          {track.artist || 'Unknown'}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>{formatTime(track.duration)}</div>
    </div>
  );
});

function HeroBanner({ item, onOpen, playAllTracks, onHoverChange }) {
  const [hovered, setHovered] = useState(false);

  const handleMouseEnter = () => { setHovered(true);  onHoverChange?.(true);  };
  const handleMouseLeave = () => { setHovered(false); onHoverChange?.(false); };

  return (
    <div
      className="clickable"
      style={{
        position: 'relative', borderRadius: 20, overflow: 'hidden',
        height: 200, display: 'flex', alignItems: 'center', gap: 28, padding: '24px 32px',
        cursor: 'pointer',
        transition: 'transform 0.25s ease, box-shadow 0.25s ease',
        transform: hovered ? 'scale(1.008)' : 'scale(1)',
        boxShadow: hovered ? '0 16px 56px rgba(0,0,0,0.5)' : '0 4px 24px rgba(0,0,0,0.3)',
        flexShrink: 0,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => onOpen({ type: 'artist', key: item.name })}
    >
      {/* Blurred background */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {item.artwork
          ? <img src={item.artwork} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(28px) brightness(0.55)', transform: 'scale(1.12)' }} alt="" />
          : <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, rgba(10,132,255,0.35), rgba(120,80,220,0.35))' }} />
        }
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.38)' }} />
      </div>

      {/* Artist circle */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: 140, height: 140, borderRadius: '50%', overflow: 'hidden',
        background: 'var(--glass-active)', flexShrink: 0,
        border: '2px solid rgba(255,255,255,0.22)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {item.artwork
          ? <img src={item.artwork} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={item.name} />
          : <Music size={52} color="var(--text-secondary)" />
        }
      </div>

      {/* Text + buttons */}
      <div style={{ position: 'relative', zIndex: 1, flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
          Featured Artist
        </div>
        <div style={{
          fontSize: 'clamp(22px, 3vw, 36px)', fontWeight: 800, color: '#fff',
          textShadow: '0 2px 20px rgba(0,0,0,0.9)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 6,
        }}>
          {item.name}
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 20 }}>
          {item.tracks.length} track{item.tracks.length !== 1 ? 's' : ''}
        </div>
        <div style={{ display: 'flex', gap: 10 }} onClick={(e) => e.stopPropagation()}>
          <button
            className="clickable"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 20px', borderRadius: 24, background: '#fff', color: '#000', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'transform 0.15s ease, filter 0.15s ease' }}
            onMouseEnter={e => e.currentTarget.style.filter = 'brightness(0.9)'}
            onMouseLeave={e => e.currentTarget.style.filter = ''}
            onClick={() => playAllTracks(item.tracks, false)}
          >
            <Play size={14} fill="#000" color="#000" />
            Play
          </button>
          <button
            className="clickable"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 20px', borderRadius: 24, background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.28)', fontWeight: 600, fontSize: 13, cursor: 'pointer', backdropFilter: 'blur(10px)', transition: 'background 0.15s ease' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
            onClick={() => playAllTracks(item.tracks, true)}
          >
            <Shuffle size={13} />
            Shuffle
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── YearGraph helpers ────────────────────────────────────────────────────────

function catmullRomSegs(pts) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    segs.push({
      cp1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      cp2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      end: p2,
    });
  }
  return segs;
}

function buildYearPaths(pts, baseline) {
  if (pts.length < 2) return { area: '', line: '' };
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) {
    d += ` L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  } else {
    for (const seg of catmullRomSegs(pts)) {
      d += ` C ${seg.cp1.x.toFixed(1)} ${seg.cp1.y.toFixed(1)} ${seg.cp2.x.toFixed(1)} ${seg.cp2.y.toFixed(1)} ${seg.end.x.toFixed(1)} ${seg.end.y.toFixed(1)}`;
    }
  }
  return {
    line: d,
    area: `${d} L ${pts[pts.length - 1].x.toFixed(1)} ${baseline.toFixed(1)} L ${pts[0].x.toFixed(1)} ${baseline.toFixed(1)} Z`,
  };
}

function YearGraph({ data, onYearClick }) {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const GRAPH_H = 140;
  const PL = 28, PR = 28, PT = 16, PB = 30;
  const n = data.length;

  const derived = useMemo(() => {
    if (width < 1 || n < 2) return null;
    const pW = width - PL - PR;
    const pH = GRAPH_H - PT - PB;
    const base = PT + pH;
    const mx = Math.max(...data.map(d => d.count), 1);
    const pts = data.map((d, i) => ({
      x: PL + (i / (n - 1)) * pW,
      y: PT + pH - (d.count / mx) * pH,
    }));
    return { pts, ...buildYearPaths(pts, base), base, pW };
  }, [data, width, n]);

  const labelIndices = useMemo(() => {
    if (n < 2) return [];
    const step = n <= 12 ? 1 : n <= 35 ? 5 : 10;
    const s = new Set([0, n - 1]);
    for (let i = 1; i < n - 1; i++) {
      if (data[i].year % step === 0) s.add(i);
    }
    return [...s].sort((a, b) => a - b);
  }, [data, n]);

  const handleMouseMove = useCallback((e) => {
    if (!containerRef.current || !derived || n < 2) return;
    const rect = containerRef.current.getBoundingClientRect();
    const idx = Math.round(((e.clientX - rect.left - PL) / derived.pW) * (n - 1));
    setHoveredIdx(Math.max(0, Math.min(idx, n - 1)));
  }, [derived, n]);

  const handleClick = useCallback(() => {
    if (hoveredIdx !== null && (data[hoveredIdx]?.count ?? 0) > 0) {
      onYearClick(data[hoveredIdx].year);
    }
  }, [hoveredIdx, data, onYearClick]);

  const hPt   = derived && hoveredIdx !== null ? derived.pts[hoveredIdx] : null;
  const hData = hoveredIdx !== null ? data[hoveredIdx] : null;
  const isClickable = !!hData && hData.count > 0;

  const tooltipStyle = useMemo(() => {
    if (!hPt || !width) return {};
    const EST = 160;
    if (hPt.x - EST / 2 < PL)           return { left: PL };
    if (hPt.x + EST / 2 > width - PR)   return { right: PR };
    return { left: hPt.x, transform: 'translateX(-50%)' };
  }, [hPt, width]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative', width: '100%', height: GRAPH_H,
        cursor: isClickable ? 'pointer' : 'default',
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 14,
        boxSizing: 'border-box',
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredIdx(null)}
      onClick={handleClick}
    >
      {derived && (
        <svg width={width} height={GRAPH_H} style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <linearGradient id="yr-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#00f2fe" stopOpacity="0.32" />
              <stop offset="80%"  stopColor="#4facfe" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#4facfe" stopOpacity="0"    />
            </linearGradient>
            <filter id="yr-glow" x="-5%" y="-100%" width="110%" height="300%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* filled area */}
          <path d={derived.area} fill="url(#yr-fill)" />
          {/* glowing stroke */}
          <path d={derived.line} fill="none" stroke="rgba(0,242,254,0.75)" strokeWidth="1.8" filter="url(#yr-glow)" />
          {/* x-axis baseline */}
          <line x1={PL} y1={derived.base} x2={PL + derived.pW} y2={derived.base} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />

          {/* year labels */}
          {labelIndices.map(i => (
            <text key={data[i].year}
              x={PL + (i / (n - 1)) * derived.pW}
              y={GRAPH_H - 8}
              textAnchor="middle" fontSize="9.5" fill="rgba(255,255,255,0.28)"
              style={{ fontFamily: 'inherit', userSelect: 'none', pointerEvents: 'none' }}
            >{data[i].year}</text>
          ))}

          {/* hover vertical guide */}
          {hPt && <line x1={hPt.x} y1={PT} x2={hPt.x} y2={derived.base} stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="3 3" />}
          {/* hover dot */}
          {hPt && <circle cx={hPt.x} cy={hPt.y} r={4.5} fill="#00f2fe" stroke="rgba(0,0,0,0.45)" strokeWidth="1.5" />}
        </svg>
      )}

      {/* tooltip */}
      {hPt && hData && (
        <div style={{
          position: 'absolute',
          top: Math.max(6, hPt.y - 44),
          pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 20,
          background: 'rgba(8,8,12,0.88)', backdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.13)', borderRadius: 9,
          padding: '6px 13px', fontSize: 12,
          ...tooltipStyle,
        }}>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{hData.year}</span>
          <span style={{ color: 'var(--text-secondary)', marginLeft: 9 }}>
            {hData.count > 0 ? `${hData.count} song${hData.count !== 1 ? 's' : ''}` : 'No songs'}
          </span>
          {hData.count > 0 && (
            <span style={{ color: 'rgba(0,242,254,0.6)', marginLeft: 9, fontSize: 10 }}>↵ open</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// ─── DonutChart helpers ───────────────────────────────────────────────────────

const TIER_COLORS = {
  Lossless: '#FFD060',
  320:      '#00e5a0',
  256:      '#00c9e0',
  224:      '#2ab8f0',
  192:      '#4facfe',
  160:      '#7b8ffe',
  128:      '#9c7ed9',
  112:      '#b06ab3',
  96:       '#d4a05c',
  80:       '#d4775c',
  64:       '#d46060',
  56:       '#c04f4f',
  48:       '#b03c3c',
  40:       '#a02d2d',
  32:       '#8a1f1f',
};
const TIER_ORDER = ['Lossless', 320, 256, 224, 192, 160, 128, 112, 96, 80, 64, 56, 48, 40, 32];

function tierColor(tier) { return TIER_COLORS[tier] ?? '#888'; }

function polarToCart(cx, cy, r, angle) {
  return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) };
}

function donutSlice(cx, cy, outerR, innerR, sa, ea) {
  const largeArc = ea - sa > Math.PI ? 1 : 0;
  const os = polarToCart(cx, cy, outerR, sa);
  const oe = polarToCart(cx, cy, outerR, ea);
  const ie = polarToCart(cx, cy, innerR, ea);
  const is_ = polarToCart(cx, cy, innerR, sa);
  return [
    `M ${os.x.toFixed(2)} ${os.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${oe.x.toFixed(2)} ${oe.y.toFixed(2)}`,
    `L ${ie.x.toFixed(2)} ${ie.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${is_.x.toFixed(2)} ${is_.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function DonutChart({ data, onTierClick }) {
  const [hoveredTier, setHoveredTier] = useState(null);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setFilled(true), 60);
    return () => clearTimeout(t);
  }, []);

  const CX = 90, CY = 90, OR = 82, IR = 52;

  const { segs, total } = useMemo(() => {
    const tot = data.reduce((s, d) => s + d.count, 0);
    if (tot === 0) return { segs: [], total: 0 };
    const GAP = data.length > 1 ? Math.PI / 90 : 0;
    const remaining = 2 * Math.PI - GAP * data.length;
    let angle = 0;
    const s = data.map(d => {
      const sweep = (d.count / tot) * remaining;
      const sa = angle;
      const ea = sa + sweep;
      angle = ea + GAP;
      return { ...d, sa, ea, bisector: sa + sweep / 2 };
    });
    return { segs: s, total: tot };
  }, [data]);

  const dominant = segs.length > 0
    ? segs.reduce((p, c) => c.count > p.count ? c : p)
    : null;

  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
      {/* Donut */}
      <div style={{ flexShrink: 0 }}>
        <svg width={180} height={180} style={{ display: 'block', overflow: 'visible' }}>
          {/* subtle background ring */}
          <circle cx={CX} cy={CY} r={(OR + IR) / 2} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={OR - IR} />

          {segs.map(seg => {
            const isHov = hoveredTier === seg.tier;
            const dim   = hoveredTier !== null && !isHov;
            const dx    = isHov ? (5 * Math.sin(seg.bisector)).toFixed(2) : 0;
            const dy    = isHov ? (-5 * Math.cos(seg.bisector)).toFixed(2) : 0;
            return (
              <g
                key={seg.tier}
                transform={`translate(${dx}, ${dy})`}
                style={{ transition: 'transform 0.18s ease', cursor: 'pointer' }}
                onMouseEnter={() => setHoveredTier(seg.tier)}
                onMouseLeave={() => setHoveredTier(null)}
                onClick={() => onTierClick(seg.tier)}
              >
                <path
                  d={donutSlice(CX, CY, OR, IR, seg.sa, seg.ea)}
                  fill={tierColor(seg.tier)}
                  opacity={dim ? 0.3 : 1}
                  style={{ transition: 'opacity 0.18s ease' }}
                />
              </g>
            );
          })}

          {/* center label */}
          {dominant && (<>
            <text x={CX} y={CY - 7} textAnchor="middle" fontSize="13" fontWeight="700"
              fill="rgba(255,255,255,0.92)" style={{ fontFamily: 'inherit', pointerEvents: 'none' }}>
              {tierLabel(dominant.tier)}
            </text>
            <text x={CX} y={CY + 10} textAnchor="middle" fontSize="10"
              fill="rgba(255,255,255,0.4)" style={{ fontFamily: 'inherit', pointerEvents: 'none' }}>
              {Math.round((dominant.count / total) * 100)}% of library
            </text>
          </>)}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {data.map((d, i) => {
          const isHov = hoveredTier === d.tier;
          const pct   = Math.round((d.count / total) * 100);
          return (
            <div
              key={d.tier}
              className="clickable"
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '6px 9px', borderRadius: 7,
                background: isHov ? 'var(--glass-highlight)' : 'transparent',
                transition: 'background 0.15s ease', cursor: 'pointer',
              }}
              onMouseEnter={() => setHoveredTier(d.tier)}
              onMouseLeave={() => setHoveredTier(null)}
              onClick={() => onTierClick(d.tier)}
            >
              <div style={{ width: 9, height: 9, borderRadius: '50%', background: tierColor(d.tier), flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0, minWidth: 70 }}>
                {tierLabel(d.tier)}
              </span>
              <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: tierColor(d.tier), opacity: 0.75,
                  width: filled ? `${pct}%` : '0%',
                  transition: `width 550ms cubic-bezier(0.25,0.46,0.45,0.94) ${i * 45}ms`,
                }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0, minWidth: 22, textAlign: 'right' }}>
                {d.count}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.55, flexShrink: 0, minWidth: 30, textAlign: 'right' }}>
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── CompletenessBar ─────────────────────────────────────────────────────────

function completenessColor(pct) {
  if (pct >= 90) return '#00e5a0';
  if (pct >= 70) return '#4facfe';
  if (pct >= 50) return '#d4a05c';
  return '#d46060';
}

function CompletenessBar({ label, pct, present, outOf, onClick }) {
  const [animated, setAnimated] = useState(false);
  const [hovered,  setHovered]  = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 80);
    return () => clearTimeout(t);
  }, []);

  const isComplete = pct >= 100;
  const color      = completenessColor(Math.min(pct, 100));
  const missing    = outOf - present;

  return (
    <div
      className={isComplete ? undefined : 'clickable'}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 8,
        background: hovered ? 'var(--glass-highlight)' : 'transparent',
        transition: 'background 0.15s ease',
        cursor: isComplete ? 'default' : 'pointer',
      }}
      onMouseEnter={() => { if (!isComplete) setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
      onClick={isComplete ? undefined : onClick}
    >
      {/* Label + missing count */}
      <div style={{ width: 70, flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
          {label}
        </div>
        <div style={{ fontSize: 10, color: isComplete ? color : 'var(--text-secondary)', opacity: isComplete ? 0.9 : 0.55 }}>
          {isComplete ? 'All done' : `${missing} missing`}
        </div>
      </div>

      {/* Bar track */}
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: animated ? `${Math.min(pct, 100)}%` : '0%',
          borderRadius: 3,
          background: color,
          boxShadow: animated && pct > 5 ? `0 0 6px ${color}99` : 'none',
          transition: 'width 900ms cubic-bezier(0.25,0.46,0.45,0.94), box-shadow 1s ease',
        }} />
      </div>

      {/* Percentage */}
      <div style={{ width: 36, fontSize: 13, fontWeight: 700, color, textAlign: 'right', flexShrink: 0 }}>
        {isComplete ? '✓' : `${pct}%`}
      </div>
    </div>
  );
}

// ─── LanguageDonut ────────────────────────────────────────────────────────────

const LANG_COLORS = {
  Hebrew:  '#a855f7',
  English: '#4facfe',
  Arabic:  '#10b981',
  Cyrillic:'#f59e0b',
  CJK:     '#ef4444',
};
function langColor(script) { return LANG_COLORS[script] ?? '#888'; }

function LanguageDonut({ data, onScriptClick }) {
  const [hoveredScript, setHoveredScript] = useState(null);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setFilled(true), 60);
    return () => clearTimeout(t);
  }, []);

  const CX = 90, CY = 90, OR = 82, IR = 52;

  const { segs, total } = useMemo(() => {
    const tot = data.reduce((s, d) => s + d.count, 0);
    if (tot === 0) return { segs: [], total: 0 };
    const GAP = data.length > 1 ? Math.PI / 90 : 0;
    const remaining = 2 * Math.PI - GAP * data.length;
    let angle = 0;
    const s = data.map(d => {
      const sweep = (d.count / tot) * remaining;
      const sa = angle;
      const ea = sa + sweep;
      angle = ea + GAP;
      return { ...d, sa, ea, bisector: sa + sweep / 2 };
    });
    return { segs: s, total: tot };
  }, [data]);

  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
      <div style={{ flexShrink: 0 }}>
        <svg width={180} height={180} style={{ display: 'block', overflow: 'visible' }}>
          <circle cx={CX} cy={CY} r={(OR + IR) / 2} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={OR - IR} />
          {segs.map(seg => {
            const isHov = hoveredScript === seg.script;
            const dim = hoveredScript !== null && !isHov;
            const dx = isHov ? (5 * Math.sin(seg.bisector)).toFixed(2) : 0;
            const dy = isHov ? (-5 * Math.cos(seg.bisector)).toFixed(2) : 0;
            return (
              <g
                key={seg.script}
                transform={`translate(${dx}, ${dy})`}
                style={{ transition: 'transform 0.18s ease', cursor: 'pointer' }}
                onMouseEnter={() => setHoveredScript(seg.script)}
                onMouseLeave={() => setHoveredScript(null)}
                onClick={() => onScriptClick(seg.script)}
              >
                <path
                  d={donutSlice(CX, CY, OR, IR, seg.sa, seg.ea)}
                  fill={langColor(seg.script)}
                  opacity={dim ? 0.25 : 1}
                  style={{ transition: 'opacity 0.18s ease' }}
                />
              </g>
            );
          })}
          {total > 0 && (<>
            <text x={CX} y={CY - 7} textAnchor="middle" fontSize="20" fontWeight="700"
              fill="rgba(255,255,255,0.92)" style={{ fontFamily: 'inherit', pointerEvents: 'none' }}>
              {total}
            </text>
            <text x={CX} y={CY + 11} textAnchor="middle" fontSize="10"
              fill="rgba(255,255,255,0.4)" style={{ fontFamily: 'inherit', pointerEvents: 'none' }}>
              songs
            </text>
          </>)}
        </svg>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {data.map((d, i) => {
          const isHov = hoveredScript === d.script;
          const pct = Math.round((d.count / total) * 100);
          return (
            <div
              key={d.script}
              className="clickable"
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '6px 9px', borderRadius: 7,
                background: isHov ? 'var(--glass-highlight)' : 'transparent',
                transition: 'background 0.15s ease', cursor: 'pointer',
              }}
              onMouseEnter={() => setHoveredScript(d.script)}
              onMouseLeave={() => setHoveredScript(null)}
              onClick={() => onScriptClick(d.script)}
            >
              <div style={{ width: 9, height: 9, borderRadius: '50%', background: langColor(d.script), flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0, minWidth: 64 }}>
                {d.script}
              </span>
              <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: langColor(d.script), opacity: 0.75,
                  width: filled ? `${pct}%` : '0%',
                  transition: `width 550ms cubic-bezier(0.25,0.46,0.45,0.94) ${i * 45}ms`,
                }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0, minWidth: 22, textAlign: 'right' }}>
                {d.count}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.55, flexShrink: 0, minWidth: 30, textAlign: 'right' }}>
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const MAX_SECTION_CARDS = 20;

// ─── Main component ───────────────────────────────────────────────────────────

const HomeView = memo(function HomeView({ library, currentTrack, isPlaying, playTrack, playAllTracks, onOpenDetail, isActive }) {
  const [genreFilter,      setGenreFilter]      = useState(null);
  const [quickPickSeed,    setQuickPickSeed]    = useState(() => Math.random());
  const [albumSeed,        setAlbumSeed]        = useState(() => Math.random());
  const [artistSeed,       setArtistSeed]       = useState(() => Math.random());
  const [releasesSeed,     setReleasesSeed]     = useState(() => Math.random());
  const [heroSeed,         setHeroSeed]         = useState(() => Math.random());
  const [heroVisible,      setHeroVisible]      = useState(true);
  const [releasesVisible,  setReleasesVisible]  = useState(true);
  const [albumsVisible,    setAlbumsVisible]    = useState(true);
  const [artistsVisible,   setArtistsVisible]   = useState(true);
  const [quickPicksVisible, setQuickPicksVisible] = useState(true);
  const [decadeFilter,     setDecadeFilter]     = useState(null);

  const heroHoveredRef     = useRef(false);
  const sectionsHoveredRef = useRef(false);
  const isActiveRef        = useRef(isActive);
  const rotationIdxRef     = useRef(0);

  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

  // Hero auto-rotation: every 8s, fade out → swap artist → fade in. Pauses on hover.
  useEffect(() => {
    let fadeTimer = null;
    const interval = setInterval(() => {
      if (heroHoveredRef.current) return;
      setHeroVisible(false);
      fadeTimer = setTimeout(() => { setHeroSeed(Math.random()); setHeroVisible(true); }, 300);
    }, 8000);
    return () => { clearInterval(interval); clearTimeout(fadeTimer); };
  }, []);

  // Section auto-rotation: every 1 min, one section fades and reshuffles in order.
  // Skips silently when Home isn't the active view or any section is hovered.
  useEffect(() => {
    const SECTIONS = [
      { setVisible: setReleasesVisible,   setSeed: setReleasesSeed   },
      { setVisible: setArtistsVisible,    setSeed: setArtistSeed     },
      { setVisible: setAlbumsVisible,     setSeed: setAlbumSeed      },
      { setVisible: setQuickPicksVisible, setSeed: setQuickPickSeed  },
    ];
    let fadeTimer = null;
    const interval = setInterval(() => {
      if (!isActiveRef.current || sectionsHoveredRef.current) return;
      const { setVisible, setSeed } = SECTIONS[rotationIdxRef.current % SECTIONS.length];
      rotationIdxRef.current += 1;
      setVisible(false);
      fadeTimer = setTimeout(() => { setSeed(Math.random()); setVisible(true); }, 300);
    }, 60 * 1000);
    return () => { clearInterval(interval); clearTimeout(fadeTimer); };
  }, []);

  const albumsScrollRef = useRef(null);
  const artistsScrollRef = useRef(null);
  const newReleasesScrollRef = useRef(null);
  const scrollAnimating = useRef(new Set());

  const [scrollFades, setScrollFades] = useState({ albums: 'right', artists: 'right', releases: 'right' });

  const PAD = 12;
  const FADE = 40;

  const getFadeMask = (fade) => {
    if (fade === 'none')  return 'none';
    if (fade === 'right') return `linear-gradient(to right, black calc(100% - ${PAD + FADE}px), transparent calc(100% - ${PAD}px), transparent)`;
    if (fade === 'left')  return `linear-gradient(to right, transparent ${PAD}px, black ${PAD + FADE}px)`;
    return `linear-gradient(to right, transparent ${PAD}px, black ${PAD + FADE}px, black calc(100% - ${PAD + FADE}px), transparent calc(100% - ${PAD}px))`;
  };

  const updateFade = useCallback((key, el) => {
    if (!el) return;
    const atStart = el.scrollLeft <= PAD;
    const atEnd   = el.scrollLeft + el.clientWidth >= el.scrollWidth - PAD;
    const fade = (atStart && atEnd) ? 'none' : atStart ? 'right' : atEnd ? 'left' : 'both';
    setScrollFades(prev => prev[key] === fade ? prev : { ...prev, [key]: fade });
  }, []);

  const getFlushTarget = (el, dir) => {
    const children = Array.from(el.firstElementChild?.children ?? []);
    if (children.length === 0) return el.scrollLeft;
    const containerLeft = el.getBoundingClientRect().left;
    // Raw destination: 80% of visible width in the clicked direction.
    const raw = el.scrollLeft + dir * el.clientWidth * 0.8;
    // Snap to whichever card boundary is closest to that raw position.
    let best = null;
    let bestDist = Infinity;
    for (const child of children) {
      const cardPos = child.getBoundingClientRect().left - containerLeft + el.scrollLeft;
      const dist = Math.abs(cardPos - raw);
      if (dist < bestDist) { bestDist = dist; best = cardPos; }
    }
    return Math.max(0, Math.min(best ?? el.scrollLeft, el.scrollWidth - el.clientWidth));
  };

  const scroll = (ref, dir) => {
    const el = ref.current;
    if (!el || scrollAnimating.current.has(el)) return;
    const target = getFlushTarget(el, dir);
    if (Math.abs(target - el.scrollLeft) < 1) return;
    scrollAnimating.current.add(el);
    el.addEventListener('scrollend', () => scrollAnimating.current.delete(el), { once: true });
    el.scrollTo({ left: target, behavior: 'smooth' });
  };

  const genres = useMemo(() => parseGenres(library), [library]);
  const decades = useMemo(() => {
    const set = new Set();
    for (const t of library) {
      const y = parseInt(t.year);
      if (!isNaN(y) && y > 0) set.add(Math.floor(y / 10) * 10);
    }
    return [...set].sort((a, b) => a - b);
  }, [library]);
  const decadeLabel = d => `${String(d).slice(2)}s`;

  const filteredLibrary = useMemo(() => {
    let result = library;
    if (genreFilter) result = result.filter(t => trackMatchesGenre(t, genreFilter));
    if (decadeFilter) result = result.filter(t => {
      const y = parseInt(t.year);
      return !isNaN(y) && y >= decadeFilter && y < decadeFilter + 10;
    });
    return result;
  }, [library, genreFilter, decadeFilter]);

  const scriptData = useMemo(() => {
    const counts = {};
    for (const t of filteredLibrary) {
      const script = detectScript(t.title);
      counts[script] = (counts[script] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([script, count]) => ({ script, count }));
  }, [filteredLibrary]);

  const allArtists = useMemo(() => groupByArtist(library), [library]);
  const allAlbumsCount = useMemo(() => groupByAlbum(library).length, [library]);
  const totalDuration  = useMemo(() => library.reduce((sum, t) => sum + (t.duration || 0), 0), [library]);
  const albums = useMemo(() => groupByAlbum(filteredLibrary), [filteredLibrary]);
  const artists = useMemo(() => groupByArtist(filteredLibrary), [filteredLibrary]);

  // Hero: seeded-random artist with ≥2 tracks — Refresh picks a new one.
  const hero = useMemo(() => {
    const eligible = allArtists.filter(a => a.tracks.length >= 2);
    const pool = eligible.length > 0 ? eligible : allArtists;
    if (pool.length === 0) return null;
    const picked = seededShuffle(pool, heroSeed)[0] || null;
    if (!genreFilter && !decadeFilter) return picked;
    const inFiltered = picked && artists.find(a => a.name === picked.name);
    if (inFiltered) return inFiltered;
    return [...artists].sort((a, b) => b.tracks.length - a.tracks.length)[0] || null;
  }, [heroSeed, genreFilter, decadeFilter, allArtists, artists]);

  const topArtists = useMemo(() =>
    [...artists].sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 5),
    [artists]
  );

  const quickPicks = useMemo(() => {
    if (filteredLibrary.length === 0) return [];
    return seededShuffle(filteredLibrary, quickPickSeed).slice(0, Math.min(12, filteredLibrary.length));
  }, [filteredLibrary, quickPickSeed]);

  const newReleases = useMemo(() => {
    if (albums.length === 0) return [];
    // Sort all albums by their most recent track year, newest first
    const sorted = [...albums].sort((a, b) => {
      const ya = Math.max(...a.tracks.map(t => parseInt(t.year) || 0));
      const yb = Math.max(...b.tracks.map(t => parseInt(t.year) || 0));
      return yb - ya;
    });
    // Shuffle within the top-30 newest so refresh feels meaningful
    return seededShuffle(sorted.slice(0, 30), releasesSeed).slice(0, MAX_SECTION_CARDS);
  }, [albums, releasesSeed]);

  // Seeded-random order — Refresh reshuffles which cards appear first in the row.
  const albumPicks = useMemo(() =>
    seededShuffle(albums, albumSeed).slice(0, MAX_SECTION_CARDS),
    [albums, albumSeed]
  );
  const artistPicks = useMemo(() =>
    seededShuffle(artists, artistSeed).slice(0, MAX_SECTION_CARDS),
    [artists, artistSeed]
  );

  const yearData = useMemo(() => {
    const counts = {};
    const now = new Date().getFullYear();
    for (const t of filteredLibrary) {
      const y = parseInt(t.year);
      if (!isNaN(y) && y >= 1900 && y <= now) counts[y] = (counts[y] || 0) + 1;
    }
    const years = Object.keys(counts).map(Number).sort((a, b) => a - b);
    if (years.length < 2) return [];
    const [minY, maxY] = [years[0], years[years.length - 1]];
    const out = [];
    for (let y = minY; y <= maxY; y++) out.push({ year: y, count: counts[y] || 0 });
    return out;
  }, [filteredLibrary]);

  const qualityData = useMemo(() => {
    const counts = {};
    for (const t of filteredLibrary) {
      const tier = snapToTier(t.bitrate);
      if (tier == null) continue;
      counts[tier] = (counts[tier] || 0) + 1;
    }
    return TIER_ORDER.filter(t => counts[t]).map(t => ({ tier: t, count: counts[t] }));
  }, [filteredLibrary]);

  const completenessData = useMemo(() => {
    const total = filteredLibrary.length;
    if (total === 0) return null;
    const mp3s       = filteredLibrary.filter(t => t.filePath?.toLowerCase().endsWith('.mp3'));
    const artCount   = filteredLibrary.filter(t => t.thumb).length;
    const yearCount  = filteredLibrary.filter(t => { const y = parseInt(t.year); return !isNaN(y) && y > 0; }).length;
    const lyricCount = mp3s.filter(t => t.lyrics && t.lyrics.trim().length > 0).length;
    const gauges = [
      { key: 'art',  label: 'Cover Art', pct: Math.round(artCount  / total       * 100), present: artCount,  outOf: total       },
      { key: 'year', label: 'Year',      pct: Math.round(yearCount / total       * 100), present: yearCount, outOf: total       },
    ];
    if (mp3s.length > 0) {
      gauges.push({ key: 'lyrics', label: 'Lyrics', pct: Math.round(lyricCount / mp3s.length * 100), present: lyricCount, outOf: mp3s.length });
    }
    return gauges;
  }, [filteredLibrary]);

  if (library.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', textAlign: 'center' }}>
        <Music size={48} style={{ opacity: 0.35, marginBottom: 16 }} />
        <p style={{ fontSize: 16, marginBottom: 8, color: 'var(--text-primary)' }}>Your library is empty.</p>
        <p style={{ fontSize: 13 }}>Add tracks to see your Home screen.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, paddingBottom: 32 }}>

      {/* Filters + library stats */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {genres.length > 0 && (
          <div className="home-genre-chips">
            <button
              className={cx('home-genre-chip clickable', { active: genreFilter === null })}
              onClick={() => setGenreFilter(null)}
            >All</button>
            {genres.map(g => (
              <button
                key={g}
                className={cx('home-genre-chip clickable', { active: genreFilter === g })}
                onClick={() => setGenreFilter(g === genreFilter ? null : g)}
              >{g}</button>
            ))}
          </div>
        )}
        {decades.length > 1 && (
          <div className="home-genre-chips">
            {decades.map(d => (
              <button
                key={d}
                className={cx('home-genre-chip clickable', { active: decadeFilter === d })}
                onClick={() => setDecadeFilter(d === decadeFilter ? null : d)}
              >{decadeLabel(d)}</button>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.6, letterSpacing: '0.04em', paddingLeft: 2 }}>
          {library.length} {library.length === 1 ? 'song' : 'songs'} · {allArtists.length} {allArtists.length === 1 ? 'artist' : 'artists'} · {allAlbumsCount} {allAlbumsCount === 1 ? 'album' : 'albums'} · {formatDuration(totalDuration)}
        </div>
      </div>

      {/* Hero */}
      {hero && filteredLibrary.length > 0 && (
        <div style={{ opacity: heroVisible ? 1 : 0, transition: 'opacity 0.3s ease' }}>
          <HeroBanner
            item={hero}
            onOpen={onOpenDetail}
            playAllTracks={playAllTracks}
            onHoverChange={(h) => { heroHoveredRef.current = h; }}
          />
        </div>
      )}

      {/* Quick Picks */}
      {quickPicks.length > 0 && (
        <div style={{ opacity: quickPicksVisible ? 1 : 0, transition: 'opacity 0.3s ease' }} onMouseEnter={() => { sectionsHoveredRef.current = true; }} onMouseLeave={() => { sectionsHoveredRef.current = false; }}>
          <SectionHeader title="Quick Picks">
            <button
              className="glass-button clickable"
              style={{ padding: '5px 11px', fontSize: 12, gap: 6 }}
              onClick={() => setQuickPickSeed(Math.random())}
            >
              <RotateCcw size={12} />
              Refresh
            </button>
            <button
              className="glass-button clickable"
              style={{ padding: '5px 11px', fontSize: 12, gap: 6 }}
              onClick={() => playAllTracks(quickPicks, false)}
            >
              <Play size={12} fill="currentColor" />
              Play all
            </button>
          </SectionHeader>
          <div className="home-quick-picks-grid">
            {quickPicks.map(track => (
              <QuickPickRow
                key={track.filePath}
                track={track}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                playTrack={playTrack}
              />
            ))}
          </div>
        </div>
      )}

      {/* Latest Releases */}
      {newReleases.length > 0 && (
        <div style={{ opacity: releasesVisible ? 1 : 0, transition: 'opacity 0.3s ease' }} onMouseEnter={() => { sectionsHoveredRef.current = true; }} onMouseLeave={() => { sectionsHoveredRef.current = false; }}>
          <SectionHeader
            title="Latest Releases"
            onScrollLeft={() => scroll(newReleasesScrollRef, -1)}
            onScrollRight={() => scroll(newReleasesScrollRef, 1)}
          >
            <button
              className="glass-button clickable"
              style={{ padding: '5px 11px', fontSize: 12, gap: 6 }}
              onClick={() => setReleasesSeed(Math.random())}
            >
              <RotateCcw size={12} />
              Refresh
            </button>
          </SectionHeader>
          <div
            ref={newReleasesScrollRef}
            className="home-card-row-outer"
            onScroll={() => updateFade('releases', newReleasesScrollRef.current)}
            style={{ WebkitMaskImage: getFadeMask(scrollFades.releases), maskImage: getFadeMask(scrollFades.releases) }}
          >
            <div className="home-card-row">
              {newReleases.map(album => (
                <AlbumCard key={album.name} album={album} onOpen={onOpenDetail} playAllTracks={playAllTracks} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Artists */}
      {artistPicks.length >= 2 && (
        <div style={{ opacity: artistsVisible ? 1 : 0, transition: 'opacity 0.3s ease' }} onMouseEnter={() => { sectionsHoveredRef.current = true; }} onMouseLeave={() => { sectionsHoveredRef.current = false; }}>
          <SectionHeader
            title="Artists"
            onScrollLeft={() => scroll(artistsScrollRef, -1)}
            onScrollRight={() => scroll(artistsScrollRef, 1)}
          >
            <button
              className="glass-button clickable"
              style={{ padding: '5px 11px', fontSize: 12, gap: 6 }}
              onClick={() => setArtistSeed(Math.random())}
            >
              <RotateCcw size={12} />
              Refresh
            </button>
          </SectionHeader>
          <div
            ref={artistsScrollRef}
            className="home-card-row-outer"
            onScroll={() => updateFade('artists', artistsScrollRef.current)}
            style={{ WebkitMaskImage: getFadeMask(scrollFades.artists), maskImage: getFadeMask(scrollFades.artists) }}
          >
            <div className="home-card-row">
              {artistPicks.map(artist => (
                <ArtistCard key={artist.name} artist={artist} onOpen={onOpenDetail} playAllTracks={playAllTracks} />
              ))}
            </div>
          </div>
          {topArtists.length >= 2 && (
            <>
              <div style={{ height: 1, background: 'var(--glass-border)', margin: '20px 0 8px' }} />
              <TopArtistsPanel artists={topArtists} onOpen={onOpenDetail} />
            </>
          )}
        </div>
      )}

      {/* Albums */}
      {albumPicks.length >= 2 && (
        <div style={{ opacity: albumsVisible ? 1 : 0, transition: 'opacity 0.3s ease' }} onMouseEnter={() => { sectionsHoveredRef.current = true; }} onMouseLeave={() => { sectionsHoveredRef.current = false; }}>
          <SectionHeader
            title="Albums"
            onScrollLeft={() => scroll(albumsScrollRef, -1)}
            onScrollRight={() => scroll(albumsScrollRef, 1)}
          >
            <button
              className="glass-button clickable"
              style={{ padding: '5px 11px', fontSize: 12, gap: 6 }}
              onClick={() => setAlbumSeed(Math.random())}
            >
              <RotateCcw size={12} />
              Refresh
            </button>
          </SectionHeader>
          <div
            ref={albumsScrollRef}
            className="home-card-row-outer"
            onScroll={() => updateFade('albums', albumsScrollRef.current)}
            style={{ WebkitMaskImage: getFadeMask(scrollFades.albums), maskImage: getFadeMask(scrollFades.albums) }}
          >
            <div className="home-card-row">
              {albumPicks.map(album => (
                <AlbumCard key={album.name} album={album} onOpen={onOpenDetail} playAllTracks={playAllTracks} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Songs by Year */}
      {yearData.length >= 2 && (
        <div>
          <SectionHeader title="Songs by Year" />
          <YearGraph
            data={yearData}
            onYearClick={(year) => onOpenDetail({ type: 'year', key: String(year) })}
          />
        </div>
      )}

      {/* Library Stats */}
      {(qualityData.length >= 2 || completenessData) && (
        <div>
          <SectionHeader title="Library Stats" />
          <div style={{
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 14, display: 'flex', alignItems: 'stretch',
            overflow: 'hidden',
          }}>
            {/* Left — Sound Quality donut (flex 3 ≈ 60%) */}
            {qualityData.length >= 2 && (
              <div style={{ flex: 3, padding: '20px 24px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.5, marginBottom: 14 }}>
                  Sound Quality
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <DonutChart
                      data={qualityData}
                      onTierClick={(tier) => onOpenDetail({ type: 'bitrate', key: String(tier) })}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Vertical divider */}
            {qualityData.length >= 2 && completenessData && (
              <div style={{ width: 1, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />
            )}

            {/* Right — Completeness bars (flex 2 ≈ 40%) */}
            {completenessData && (
              <div style={{ flex: 2, padding: '20px 16px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.5, marginBottom: 8 }}>
                  Completeness
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
                  {completenessData.map((d, i) => (
                    <React.Fragment key={d.key}>
                      {i > 0 && <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '2px 12px' }} />}
                      <CompletenessBar
                        label={d.label}
                        pct={d.pct}
                        present={d.present}
                        outOf={d.outOf}
                        onClick={() => onOpenDetail({ type: 'missing-metadata', key: d.key })}
                      />
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Languages */}
      {scriptData.length >= 2 && (
        <div>
          <SectionHeader title="Languages" />
          <div style={{
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 14, padding: '20px 24px',
          }}>
            <LanguageDonut
              data={scriptData}
              onScriptClick={(key) => onOpenDetail({ type: 'language', key })}
            />
          </div>
        </div>
      )}

    </div>
  );
});

export default HomeView;
