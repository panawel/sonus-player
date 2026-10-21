import { useRef, useState, useEffect, useLayoutEffect, useMemo } from 'react';
import { Music, Play, Shuffle, ChevronLeft, Calendar, Headphones, AlertCircle, LoaderCircle, Sparkles } from 'lucide-react';
import TrackList from './TrackList.jsx';
import TrackListHeader from './TrackListHeader.jsx';
import { useTrackSort } from './useTrackSort.js';
import { useTrackSelection } from './useTrackSelection.js';
import { useIsNarrow } from './useIsNarrow.js';
import { useMix } from './useMix.js';
import {
  ULTRA_COMPACT_PANEL_BREAKPOINT, LIBRARY_YEAR_COL_BREAKPOINT, LIBRARY_GENRE_COL_BREAKPOINT,
  NARROW_LAYOUT_BREAKPOINT, extraColumnFitCount, detailExtraColumns, trackMatchesQuery,
} from './trackUtils.js';

const MISSING_TITLES = { art: 'Missing Art', year: 'Missing Year', lyrics: 'Missing Lyrics' };
import { snapToTier, splitArtists, detectScript } from './audioUtils.js';

// The hero image reaches .glass-panel's own top/left(/right) edges flush,
// with no gap — not via a negative margin on this component's own side
// (that was tried, and is a real bug: see App.jsx's .scrollable padding
// comment for why a scroll port silently clips content pulled above/before
// its own scroll origin). Instead App.jsx removes its own padding entirely
// while a Home detail item is open, so there's nothing here to escape — the
// hero just renders at its own natural (0,0) origin and is already flush.
// This component adds its own padding back around the tracklist specifically
// (HERO_TRACKLIST_PAD_*, below), so only the hero reaches the true edge.

// Full-width hero column width (the solid part of the image / where the
// text sits). 35% capped at 520px — the user's pick over a wider ~42%, to
// leave the tracklist more room. The image layer itself is wider than this
// by HERO_OVERLAP_WIDE, extending under the start of the tracklist column
// and dissolving there (see the mask below), so the two columns read as one
// surface with no seam — the reference's own wide layout.
const HERO_WIDTH_WIDE = 'clamp(260px, 35%, 520px)';
// Padding re-added around just the tracklist (header + rows), now that
// App.jsx's own .scrollable no longer supplies any — matches what that
// padding used to be (16px narrow, 32px full-width), so the tracklist's own
// position is visually unchanged from before this fix; only the hero is new
// edge-to-edge territory. HERO_TRACKLIST_PAD_WIDE also doubles as the actual
// x-position (relative to the hero column's own right edge) where the
// tracklist's own text starts — see HERO_OVERLAP_WIDE/HERO_FADE_WIDE below,
// which are deliberately tuned against this exact number.
const HERO_TRACKLIST_PAD_NARROW = 16;
const HERO_TRACKLIST_PAD_WIDE = 32;
// How far past the hero column the image layer extends, and how deep its
// fade is — tuned together, against HERO_TRACKLIST_PAD_WIDE's own 32px
// tracklist-side padding, not picked independently. A real bug, caught only
// once the user saw it live: the original values (120 / 280) left the image
// still ~2/3 *visible* — not just structurally present, actually still
// showing through — at the exact point the tracklist's own first column of
// text renders (24px into that 32px padding), reading as real overlap
// rather than a clean blend. The image only needs to extend as far as it's
// still visible at all, so HERO_OVERLAP_WIDE (16) now stops comfortably
// *before* HERO_TRACKLIST_PAD_WIDE's own 32px (an 8-16px buffer with
// neither image nor text), and HERO_FADE_WIDE (200) is sized so the fade
// actually *reaches* fully transparent by HERO_OVERLAP_WIDE, not just gets
// most of the way there. Verified with real pixel sampling (a solid-color
// test thumbnail), not just the arithmetic — see docs/ARCHITECTURE.md.
const HERO_OVERLAP_WIDE = 16;
const HERO_FADE_WIDE = 200;
// Full-width's second, functional fade — a fixed depth from the bottom, deep
// enough to sit behind the whole eyebrow/title/subtitle/button text block
// (including a 2-line title) plus real margin. See heroMask's own comment
// for why full-width needs this at all when narrow doesn't. 300 (was 240):
// the block now sits bottomClearance (89px) up from the bottom instead of 32,
// 57px taller overall, and the fade has to keep covering all of it.
const HERO_TEXT_FADE_WIDE = 300;

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function HomeDetailView({ item, library, currentTrack, isPlaying, playTrack, togglePlay, playAllTracks, onShowMenu, onRemoveTracks, onBack, backLabel = 'Home', savedScrollTop = 0, onScrollChange, density, onDensityChange, selectionRegistryRef, bottomClearance = 0, searchQuery = '', onTracksChange }) {
  // Same extra-columns mechanism Library uses (App.jsx), just with a
  // per-page-type filter first — see detailExtraColumns in trackUtils.js for
  // which column gets suppressed on which page (e.g. no Album column on an
  // Album page). Independent useIsNarrow subscriptions from App.jsx's own,
  // but the same shared breakpoint constants, so the two can never drift.
  const isAlbumColTierHidden = useIsNarrow(ULTRA_COMPACT_PANEL_BREAKPOINT);
  const isYearColTierHidden = useIsNarrow(LIBRARY_YEAR_COL_BREAKPOINT);
  const isGenreColTierHidden = useIsNarrow(LIBRARY_GENRE_COL_BREAKPOINT);
  // Own subscription to the same breakpoint App.jsx uses for its own
  // narrow/full-width split (imported from trackUtils.js so the two can
  // never drift) — this page's hero switches from a stacked, centered
  // layout (narrow) to a two-column one (full-width, hero left / tracklist
  // right) based on it. See docs/ARCHITECTURE.md's "Home view" section.
  const isNarrowLayout = useIsNarrow(NARROW_LAYOUT_BREAKPOINT);
  const visibleExtraColumns = detailExtraColumns(item).slice(
    0, extraColumnFitCount(isAlbumColTierHidden, isYearColTierHidden, isGenreColTierHidden)
  );

  // No-op (status stays 'idle') for every item type except 'mix' — safe to
  // call unconditionally alongside the synchronous types below.
  const mix = useMix(item, library);

  const tracks = useMemo(() => {
    if (item.type === 'mix') return mix.tracks;
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
  }, [item, library, mix.tracks]);

  const innerScrollRef = useRef(null);

  // Report this page's full track list upward, so the search panel (App.jsx /
  // SearchPanel.jsx) can scope itself to this page.
  useEffect(() => { onTracksChange?.(tracks); }, [tracks, onTracksChange]);

  // The search panel's text (App.jsx / SearchPanel.jsx) live-filters THIS
  // page's tracks. Only the list is filtered: everything describing the page
  // itself — the track count and duration in the subtitle, the hero artwork,
  // whether Play/Shuffle are enabled — keeps reading from the full `tracks`.
  const searching = searchQuery.trim() !== '';
  const listTracks = useMemo(
    () => (searching ? tracks.filter(t => trackMatchesQuery(t, searchQuery)) : tracks),
    [tracks, searching, searchQuery]
  );

  // Per-open sort (resets whenever the detail item changes) + selection.
  const sortApi = useTrackSort(listTracks, { resetKey: `${item.type}:${item.key}` });
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

  // The seed track a mix was started from — item.key is its filePath.
  const seedTrack = useMemo(
    () => item.type === 'mix' ? library.find(t => t.filePath === item.key) ?? null : null,
    [item, library]
  );

  // A mix's own artwork is the seed track's, so the hero visibly ties back
  // to "the song you started this from" — falling back to the first result
  // track's artwork (matching every other type below) only if the seed has
  // none of its own. Keeps the whole track (not just its thumb) now, so the
  // full-res upgrade below has a filePath to fetch.
  const artworkTrack = useMemo(
    () => (item.type === 'mix' ? (seedTrack?.thumb ? seedTrack : null) : null) || tracks.find(t => t.thumb) || null,
    [tracks, item.type, seedTrack]
  );
  const artwork = artworkTrack?.thumb ?? null;

  const mosaicTracks = useMemo(() => {
    if (item.type !== 'language') return null;
    const seen = new Set();
    const result = [];
    for (const t of tracks) {
      if (t.thumb && !seen.has(t.thumb)) {
        seen.add(t.thumb);
        result.push(t);
        if (result.length === 4) break;
      }
    }
    return result;
  }, [item.type, tracks]);
  const mosaicArtworks = mosaicTracks?.map(t => t.thumb) ?? null;

  // Full-resolution upgrade — the hero displays this artwork at 400-500px+
  // now (the whole point of this redesign), but library track objects only
  // ever carry a small ~300px thumbnail (`thumb`); full-res is deliberately
  // kept out of renderer memory otherwise and fetched on demand (see
  // "Metadata index, thumbnails" below). App.jsx's own npArtwork effect for
  // Now Playing is the existing precedent for this exact pattern — same
  // fs:readArtwork call, same "show the thumb immediately, swap in the
  // full-res once it resolves" approach, just applied here as a second,
  // independent consumer instead of reusing App.jsx's own state (this page's
  // own artwork is very often a different track than whatever's playing).
  const [heroFullArtwork, setHeroFullArtwork] = useState(null);
  useEffect(() => {
    setHeroFullArtwork(null);
    const filePath = artworkTrack?.filePath;
    if (!filePath || !window.electronAPI?.readArtwork) return;
    let active = true;
    window.electronAPI.readArtwork(filePath).then(url => {
      if (active && url) setHeroFullArtwork(url);
    });
    return () => { active = false; };
  }, [artworkTrack?.filePath]);

  // Same upgrade for the language mosaic's own 4 tiles — one independent
  // fetch per tile (not gated on each other finishing) so each tile upgrades
  // as soon as its own fetch resolves, rather than the whole mosaic waiting
  // on the slowest of the four.
  const [mosaicFullArtworks, setMosaicFullArtworks] = useState([null, null, null, null]);
  useEffect(() => {
    setMosaicFullArtworks([null, null, null, null]);
    if (!mosaicTracks || !window.electronAPI?.readArtwork) return;
    let active = true;
    mosaicTracks.forEach((t, i) => {
      window.electronAPI.readArtwork(t.filePath).then(url => {
        if (active && url) setMosaicFullArtworks(prev => { const next = [...prev]; next[i] = url; return next; });
      });
    });
    return () => { active = false; };
  }, [mosaicTracks]);

  const subtitle = useMemo(() => {
    if (item.type === 'mix') {
      // 'idle' is useMix's useState initial value, true for the one render
      // before its effect has actually run (even on a cache hit — the
      // lookup itself only happens inside that effect). Treating it as
      // anything but "still finding out" would flash a misleading "0
      // tracks" here for a frame, every single time.
      if (mix.status === 'loading' || mix.status === 'idle') return 'Finding similar tracks…';
      if (mix.status === 'error') return "Couldn't reach the similarity services — check your connection.";
      if (mix.status === 'empty') return 'No similar tracks found in your library yet.';
      return `Based on ${seedTrack?.artist || 'this track'} · ${tracks.length} track${tracks.length !== 1 ? 's' : ''}`;
    }
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
  }, [tracks, item.type, mix.status, seedTrack]);

  // Eyebrow label + title text — pulled out of the hero JSX below since both
  // the narrow (stacked) and full-width (left-column) hero layouts need the
  // exact same values, just arranged differently.
  const eyebrowLabel = item.type === 'album' ? 'Album' : item.type === 'year' ? 'Year' : item.type === 'bitrate' ? 'Quality' : item.type === 'missing-metadata' ? 'Metadata' : item.type === 'language' ? 'Language' : item.type === 'mix' ? 'Mix' : 'Artist';
  const titleText = item.type === 'missing-metadata' ? (MISSING_TITLES[item.key] ?? item.key) : item.type === 'mix' ? item.label : item.key;

  // Hero background — a real photo (or 2x2 mosaic for language) filling the
  // ENTIRE hero region edge-to-edge, or — no artwork at all — a plain dark
  // gradient with the type's fallback icon centered, so the hero's own
  // shape/size stays consistent whether or not there's a real photo
  // (confirmed with the user). This replaced an earlier, much more
  // conservative version — a small bounded square card with a soft glow
  // behind it — once the user pointed at a reference screenshot and asked
  // for the artwork to actually fill the whole hero section as its own
  // background, the way the reference's own album art does, not sit in a
  // separate box above separate text.
  const FALLBACK_ICON_PROPS = { size: 72, color: 'var(--chrome-text-dim)', style: { opacity: 0.35 } };
  const fallbackIcon = item.type === 'year' ? <Calendar {...FALLBACK_ICON_PROPS} />
    : item.type === 'bitrate' ? <Headphones {...FALLBACK_ICON_PROPS} />
    : item.type === 'missing-metadata' ? <AlertCircle {...FALLBACK_ICON_PROPS} />
    : item.type === 'mix' ? <Sparkles {...FALLBACK_ICON_PROPS} />
    : <Music {...FALLBACK_ICON_PROPS} />;
  const fallbackBackgroundStyle = { position: 'absolute', inset: 0, background: 'linear-gradient(160deg, var(--glass-active), rgba(0,0,0,0.6))', display: 'flex', alignItems: 'center', justifyContent: 'center' };

  const heroBackgroundEl = item.type === 'language' ? (
    mosaicArtworks.length > 0 ? (
      <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 1, background: '#000' }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ overflow: 'hidden', background: 'rgba(255,255,255,0.04)' }}>
            {mosaicArtworks[i] && <img src={mosaicFullArtworks[i] ?? mosaicArtworks[i]} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt="" />}
          </div>
        ))}
      </div>
    ) : (
      <div style={fallbackBackgroundStyle}>{fallbackIcon}</div>
    )
  ) : artwork ? (
    // heroFullArtwork starts null and upgrades in place once fs:readArtwork
    // resolves (see the effect above) — the thumbnail shows immediately so
    // there's no blank flash, same as App.jsx's own npArtwork for Now Playing.
    <img src={heroFullArtwork ?? artwork} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} alt={item.label ?? item.key} />
  ) : (
    <div style={fallbackBackgroundStyle}>{fallbackIcon}</div>
  );

  // The image dissolves into the panel via a CSS *mask* to transparent — not a
  // dark gradient painted over it. An earlier version did exactly that (faded
  // the image to near-black) and it read as a hard dark strip: the surface
  // behind this page is the light, artwork-tinted glass, not black, so
  // fading toward black creates an edge instead of removing one. Masking to
  // transparent lets that same surface show through, so the image and the
  // tracklist share one continuous background — the reference's own look.
  // Inline WebkitMaskImage + maskImage, the pair PlayerPill's marquee fade
  // already uses (inline styles aren't minified, so no risk of the
  // -webkit-only collapse CLAUDE.md warns about for backdrop-filter).
  // Narrow fades toward the bottom (the tracklist is below); full-width fades
  // toward the right (the tracklist is beside). Every OTHER edge (both
  // layouts) is fully opaque, flush with the hero's own bounds — no
  // decorative vignette. A version of this did briefly fade all four edges
  // (a lighter vignette on the non-primary ones, at the user's own request);
  // the user reconsidered after seeing it live — the reference itself
  // doesn't fade those edges either, and the transparency read as unwanted
  // "free space" rather than more artwork, so that's gone.
  //
  // Full-width ALSO gets a second, functional fade toward the bottom — not
  // decorative, and not reverted along with the vignette above: the
  // eyebrow/title/subtitle/Shuffle+Play block is anchored at the *bottom* of
  // this hero (see heroOverlayEl below), same as narrow's own text — but
  // narrow's one fade already happens to face that direction (bottom), so
  // its text gets legibility "for free"; full-width's one fade faces *right*
  // instead (toward the tracklist), leaving its own bottom-anchored text
  // sitting on the raw, un-faded photo with nothing but a text-shadow behind
  // it. A real omission, caught once the user compared it against the
  // reference (which darkens behind the text in both layouts) and pointed
  // out the bottom fade was simply missing. Two gradient layers combined
  // with mask-composite: 'intersect' (the same technique the reverted
  // vignette used, here for a genuine functional reason rather than
  // decoration): the existing right-edge fade, unchanged, plus a
  // HERO_TEXT_FADE_WIDE (300px) fade from the bottom — sized as a fixed
  // pixel depth, not a percentage of the hero's own height (which the
  // narrow version uses), since full-width's hero can be much taller than
  // narrow's and a percentage-based fade would end up covering far more
  // than the text block actually needs.
  const heroMask = isNarrowLayout
    ? 'linear-gradient(to bottom, black 45%, transparent 100%)'
    : [
        `linear-gradient(to right, black calc(100% - ${HERO_FADE_WIDE}px), transparent 100%)`,
        `linear-gradient(to top, transparent 0, black ${HERO_TEXT_FADE_WIDE}px)`,
      ].join(', ');

  // Overlay content: the back button floating top-left (it left its old
  // separate row above the hero once the hero became edge-to-edge — nothing
  // above it to put a row in), and the eyebrow/title/subtitle/Shuffle+Play
  // block, centered and anchored low, sitting on the image's faded zone.
  // Text uses --chrome-text/--chrome-text-dim (white) — the same pair Now
  // Playing uses for text on a photo/blurred backdrop (see "Chrome text
  // colors" in ARCHITECTURE.md) — plus a soft text-shadow, since what's
  // behind it here ranges from a bright photo to the plain glass surface
  // depending on where in the fade it lands. Shuffle is a frosted round icon
  // button, Play a solid white pill (.detail-play-button) — a deliberate
  // one-off departure from the accent-color-for-primary-actions convention,
  // per the user's own choice. No third "+" button — no Sonus feature it
  // would map to.
  const heroTextShadow = '0 1px 2px rgba(0,0,0,0.5), 0 2px 16px rgba(0,0,0,0.45)';
  const heroOverlayEl = (
    <>
      {/* top/left: 16 (matching every other corner-anchored control in the
          app, e.g. the pill's own menu button) was a real bug here
          specifically: this hero bleeds flush with .glass-panel's own edges
          (see above), and the panel itself has a 16px border-radius —
          positioning the button at exactly (16, 16) puts its corner right at
          the center of that curve, the single worst spot, and the rounded
          corner clips straight across the chevron/first letter. 16px was
          never wrong anywhere else in the app; it's only wrong here, because
          nothing else sits flush with the panel's own outer edge the way
          this hero does.
          A first fix (24/28) cleared the CSS rounded-corner clip — confirmed
          live, a real bug fixed — but the button still read as crowded
          against the real macOS traffic lights on the user's own screen.
          Those are native, OS-compositor-drawn (titleBarStyle: 'hiddenInset'
          in electron/main.js) — a completely separate layer from anything
          this app renders, which `webContents.capturePage()` cannot see at
          all (confirmed directly: capturing this exact corner returns fully
          transparent pixels where the traffic lights visibly are on a real
          screen). That means this specific offset can only ever be verified
          by looking at the real app, not from this sandbox — 36/36 pushes
          well past a generous estimate of the traffic-light cluster's own
          footprint, with real margin instead of a small nudge, but it hasn't
          been pixel-confirmed the way the corner-radius fix was. */}
      <button
        className="np-back-button np-back-button--strong clickable"
        style={{ position: 'absolute', top: 36, left: 36, zIndex: 2 }}
        onClick={onBack}
      >
        <ChevronLeft size={16} style={{ flexShrink: 0 }} />
        {backLabel}
      </button>
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 2,
        // Full-width: the text block's bottom padding is the same clearance the
        // tracklist reserves for the floating pill (bottomClearance, 89px), not
        // a fixed 32. The pill is centered and at ~1000px wide it reaches left
        // under this 35%-wide column, covering the Play button by ~42px; this
        // puts Play's bottom edge 14px above the pill's top at every width, so
        // its position never jumps as the window is resized. Narrow's hero sits
        // at the top of the page, nowhere near its pill, so it keeps 20.
        padding: isNarrowLayout ? '0 24px 20px' : `0 28px ${Math.max(32, bottomClearance)}px`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--chrome-text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, textShadow: heroTextShadow }}>
          {eyebrowLabel}
        </div>
        {/* Two lines then ellipsis (-webkit-line-clamp) rather than one
            truncated line — "The Greatest Showman Ensemble" was getting cut
            to "The Greatest S…" in a single row. */}
        <h2 style={{ fontSize: isNarrowLayout ? 'clamp(22px, 6vw, 30px)' : 'clamp(24px, 2.2vw, 34px)', lineHeight: 1.15, fontWeight: 800, color: 'var(--chrome-text)', marginBottom: 10, maxWidth: '100%', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere', textShadow: heroTextShadow }}>
          {titleText}
        </h2>
        <div style={{ fontSize: 13, color: 'var(--chrome-text-dim)', marginBottom: 20, textShadow: heroTextShadow }}>
          {subtitle}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
          <button
            className="player-control-button detail-shuffle-button clickable"
            disabled={tracks.length === 0}
            style={{ color: 'var(--chrome-text)', opacity: tracks.length === 0 ? 0.4 : 1 }}
            onClick={() => playAllTracks(sortApi.sorted, true)}
          >
            <Shuffle size={18} />
          </button>
          <button
            className="detail-play-button clickable"
            disabled={tracks.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 30px', borderRadius: 24, background: '#fff', color: '#000', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: tracks.length === 0 ? 0.4 : 1 }}
            onClick={() => playAllTracks(sortApi.sorted, false)}
          >
            <Play size={16} fill="#000" color="#000" />
            Play
          </button>
        </div>
      </div>
    </>
  );

  // Header + tracklist, or the mix loading/error state — identical to
  // before, just pulled into a variable so both layouts below can place it
  // (full-width: inside the right column; narrow: below the stacked hero).
  // The scroll architecture itself is untouched either way: the header stays
  // outside the scroll container (see the Library/Home "fails silently" row
  // in CLAUDE.md — nesting it back inside makes rows pass behind it), and
  // only TrackList's own rows actually scroll, via the same innerScrollRef.
  const trackListArea = (item.type === 'mix' && mix.status !== 'ready') ? (
    // A mix is the only Details page that isn't instant — this replaces
    // the header+tracklist while there's nothing (yet, or ever) to list.
    // 'ready' with zero tracks can't happen (useMix reports that as
    // 'empty'), so this and the tracklist below are mutually exclusive.
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', textAlign: 'center', gap: 12 }}>
      {/* 'idle' reads as loading too — see the matching comment on the
          subtitle above for why it's a real, reachable state here. */}
      {mix.status === 'loading' || mix.status === 'idle' ? (
        <LoaderCircle size={32} className="spin" />
      ) : (
        <AlertCircle size={32} style={{ opacity: 0.5 }} />
      )}
      {mix.status === 'error' && (
        <button
          className="glass-button clickable"
          style={{ padding: '8px 20px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}
          onClick={mix.retry}
        >
          Try Again
        </button>
      )}
    </div>
  ) : (
    <>
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
          showAlbum={false}
          extraColumns={visibleExtraColumns}
        />
      </div>

      {/* Track list — unified engine (no drag: detail order is sort-driven).
          bottomClearance (App.jsx's PLAYER_PILL_CLEARANCE, 0 in narrow
          mode) keeps the last rows from sitting underneath the floating
          full-width player pill. This has to be TrackList's own
          bottomPadding (paddingEnd on its virtualizer), not CSS padding
          on this scroll div — confirmed live that plain padding-bottom on
          a container whose overflow comes from a virtualizer's rows is
          silently ignored for scrollHeight purposes; see the comment on
          paddingEnd in TrackList.jsx. */}
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
          showAlbum={false}
          extraColumns={visibleExtraColumns}
          initialOffset={savedScrollTop}
          bottomPadding={bottomClearance}
          emptyState={searching ? (
            <div style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: 60 }}>
              <p style={{ fontSize: 15 }}>No tracks match "{searchQuery.trim()}".</p>
            </div>
          ) : undefined}
        />
      </div>
    </>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {isNarrowLayout ? (
        <>
          {/* Full-bleed hero band at the top — flush with .glass-panel's own
              top/left/right edges because App.jsx's .scrollable has no
              padding to escape while this component is open (see the
              comment above); this div just renders at its own natural
              origin, no negative margin needed. A fixed height, not
              height:100%-of-parent. The image layer is masked to transparent
              toward the bottom (heroMask), so the band has no hard bottom
              edge — it dissolves into the same glass surface the tracklist
              sits on. */}
          {/* The 280px floor only holds down to the window's old 600px minimum
              height; below that (reachable now that the mini player lets the
              window get short) it eases down to 230px, just enough for the
              back button plus a two-line title block, so the track list keeps
              some room instead of being squeezed out entirely. At 600px and
              above the clamp resolves exactly as before. */}
          <div style={{ position: 'relative', height: 'clamp(max(230px, min(280px, calc(100vh - 320px))), 45vh, 460px)', flexShrink: 0 }}>
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', WebkitMaskImage: heroMask, maskImage: heroMask }}>
              {heroBackgroundEl}
            </div>
            {heroOverlayEl}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, marginTop: 8, padding: `0 ${HERO_TRACKLIST_PAD_NARROW}px` }}>
            {trackListArea}
          </div>
        </>
      ) : (
        /* Two columns sharing one background: the image is an absolutely
           positioned layer behind BOTH columns — flush with .glass-panel's
           top/left edges (nothing to escape, see the comment above), full
           row height, and HERO_OVERLAP_WIDE wider than the hero column so it
           runs under the start of the tracklist and dissolves there
           (heroMask, to the right). The hero content column sits over the
           image's solid part; the tracklist column (zIndex 1) starts right
           after it with no gutter, its first columns landing on the fade
           tail — no seam, the reference's own wide layout. */
        <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, bottom: 0,
            width: `calc(${HERO_WIDTH_WIDE} + ${HERO_OVERLAP_WIDE}px)`,
            overflow: 'hidden', pointerEvents: 'none',
            WebkitMaskImage: heroMask, maskImage: heroMask, maskComposite: 'intersect',
          }}>
            {heroBackgroundEl}
          </div>
          <div style={{ position: 'relative', width: HERO_WIDTH_WIDE, flexShrink: 0, height: '100%', zIndex: 1 }}>
            {heroOverlayEl}
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative', zIndex: 1, paddingLeft: 24, paddingRight: HERO_TRACKLIST_PAD_WIDE }}>
            {trackListArea}
          </div>
        </div>
      )}
    </div>
  );
}
