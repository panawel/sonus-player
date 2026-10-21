import { useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, Repeat1, Music, MoreVertical } from 'lucide-react';
import cx from 'classnames';
import usePillPhase from './usePillPhase';

// Row height is sized to hug its tallest child (the skip buttons' 36px hit
// circle, see the .player-pill .player-control-button padding override in
// index.css) rather than leaving generous breathing room around it — the
// user explicitly asked for "as thin as possible" while keeping every
// icon/artwork/text element the same visual size, so the flattening comes
// entirely from trimming chrome padding, not shrinking content.
// Every size below (row height, icon/artwork sizes, fonts, paddings) is the
// previous round's value scaled by the same ~1.15 factor (PILL_HEIGHT
// 40->46 is the exact ratio the rest were rounded against) — a user request
// for "a little bit bigger, same proportions, same design" specifically, not
// a redesign, so nothing here changed shape, just uniform scale. Position
// (PLAYER_PILL_BOTTOM_MARGIN) moved separately, per the same request's "a
// little bit higher" — it's not a size and isn't part of this scale factor.
const PILL_ROW_HEIGHT = 46;
// The seek line now has a row of its own under the controls (elapsed — line —
// remaining, like the mini player) instead of a thin strip along the pill's
// very bottom edge, which ran into the rounded corners.
const SEEK_ROW_HEIGHT = 26;
export const PLAYER_PILL_TOTAL_HEIGHT = PILL_ROW_HEIGHT + SEEK_ROW_HEIGHT;
export const PLAYER_PILL_BOTTOM_MARGIN = 18;

// Concentric corners. The pill is a soft rounded rectangle (PILL_RADIUS), not
// a full capsule (9999): with a capsule, the artwork inside needed some
// unrelated small radius and the two curves visibly disagreed. The artwork now
// sits ROW_INSET from the pill's top, bottom and left edges, so its radius is
// PILL_RADIUS - border - ROW_INSET — one curve, offset, which is what
// "matching radii" means geometrically.
export const PILL_RADIUS = 18;
const ROW_INSET = 5;
const ARTWORK_SIZE = PILL_ROW_HEIGHT - 2 * ROW_INSET;
// - 1: the pill's 1px border, which the artwork's inset is measured inside of.
const ARTWORK_RADIUS = PILL_RADIUS - 1 - ROW_INSET;

// Side padding of the seek row. The bottom corners curve with PILL_RADIUS; the
// line sits ~13px above the bottom edge, where that curve has moved in only
// ~1px, so 16px of padding leaves it comfortably clear of the curve.
const SEEK_ROW_INSET = 16;

const PLAY_PAUSE_SIZE = 41;
const CONTROL_ICON_SIZE = 23;
const SECONDARY_ICON_SIZE = 18;
const PLAY_PAUSE_ICON_SIZE = 21;

const HOLD_RING_SIZE = PLAY_PAUSE_SIZE + 9;
const HOLD_RING_RADIUS = HOLD_RING_SIZE / 2 - 2;
const HOLD_RING_CIRCUMFERENCE = 2 * Math.PI * HOLD_RING_RADIUS;
const HOLD_RING_OFFSET = (HOLD_RING_SIZE - PLAY_PAUSE_SIZE) / 2;

// How much of the artwork's average color tints the glass — see
// tintAlphaForLuminance below for why this is a ceiling, not a flat value.
const TINT_BASE_ALPHA = 0.20;

// Perceived luminance (ITU-R BT.601), 0-255. The pill's base is now dark
// glass with white icons/text (matching the rest of the app — see the
// component comment below), so the contrast risk this guards against is the
// mirror image of the pill's original light-glass version: a bright/
// light-colored cover tinting the dark glass toward white is what threatens
// legibility now, not a dark one. Scaling the tint's own alpha down as
// artwork gets brighter — down to 0 for a near-white cover — keeps this a
// background-only effect safe to use: a light cover simply doesn't tint the
// glass rather than tinting it into unreadability for the white icons/text.
// (Icon tinting by artwork color itself — recoloring the icons, not just the
// background — was tried once, on the pre-pill dark panel, and reverted for
// legibility; that history is why this stays background-only regardless of
// which direction the glass leans. See docs/ARCHITECTURE.md's
// "Artwork-derived color" section.)
function tintAlphaForLuminance(r, g, b) {
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return TINT_BASE_ALPHA * Math.min(1, (255 - luminance) / 140);
}

// Full-width Now Playing bar — a compact floating capsule, dark glass with
// white icons/text, matching the rest of the app's own glass language (see
// docs/ARCHITECTURE.md's "Player pill" section — this was originally a
// deliberately light/inverted theme, flipped to dark at the user's request
// once full-width Now Playing got its own white-icon transport controls and
// the mismatch between the two started to bother them). Replaces the old
// full-width docked panel; narrow layout gets its own separate
// PlayerPillNarrow (fewer buttons, no seek strip, different sizing) rather
// than reusing this component with a size prop, since so much of the row
// content genuinely differs — they share the bubble-animation logic
// (usePillPhase) and the .player-pill/.player-pill-wrapper CSS instead.
export default function PlayerPill({
  currentTrack, isNowPlayingOpen, isPlaying,
  currentTime, duration, isSeeking, seekValue, isSeekHovered, hoverTime,
  isShuffle, onToggleShuffle, repeatMode, onToggleRepeat,
  isHoldingPlayPause,
  playPrev, playNext,
  onPlayPauseClick, onPlayPausePressStart, onPlayPausePressEnd,
  playerArtistTokens,
  playerTitleWrapRef, playerSubtitleWrapRef,
  playerTitleDist, playerSubtitleDist, playerTitleDuration, playerSubtitleDuration,
  marqueeFadeMask,
  onNavigateMeta,
  onOpenMenu,
  onSeekChange, onSeekMouseDown, onSeekMouseUp, onSeekMouseEnter, onSeekMouseLeave,
  onSeekBarClick, onSeekHoverMove,
  formatTime,
  onExpandCollapseNP,
  artworkRgb,
}) {
  const wrapperRef = useRef(null);
  const seekTrackRef = useRef(null);

  // shouldShow folds in isNowPlayingOpen: the pill has no reason to exist
  // while Now Playing is open (that screen has its own built-in transport
  // controls now, see App.jsx), and hiding it through the same bubble phase
  // machine usePillPhase drives — rather than App.jsx just not rendering
  // <PlayerPill> at all while NP is open — is what lets it play its
  // bubble-out animation when NP opens, instead of vanishing instantly.
  const shouldShow = !!currentTrack && !isNowPlayingOpen;
  const { phase, displayTrack } = usePillPhase(shouldShow, currentTrack);

  if (phase === 'hidden') return null;

  const shown = isSeeking ? seekValue : currentTime;
  const progressPct = duration ? (shown / duration) * 100 : 0;
  const remaining = Math.max(0, (duration || 0) - shown);
  const tooltipTime = isSeeking ? seekValue : hoverTime;
  const showTooltip = (isSeeking || (isSeekHovered && hoverTime !== null)) && duration > 0;
  const track = displayTrack;
  const tintAlpha = artworkRgb ? tintAlphaForLuminance(artworkRgb.r, artworkRgb.g, artworkRgb.b) : 0;

  // The hover/scrub time bubble sits at the time it names, along the real
  // (measured) seek track. It lives outside the clipped capsule below so the
  // capsule's overflow:hidden can't cut it off, which means its x has to be
  // expressed relative to this outer wrapper — hence measuring both boxes
  // (the same render-time-ref idiom the rest of App.jsx uses).
  let tipLeft = null;
  if (showTooltip && wrapperRef.current && seekTrackRef.current) {
    const w = wrapperRef.current.getBoundingClientRect();
    const t = seekTrackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (tooltipTime ?? 0) / duration));
    tipLeft = (t.left - w.left) + t.width * pct;
  }

  const seekFromPointer = (e, fn) => {
    if (!duration) return;
    const rect = seekTrackRef.current.querySelector('input').getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    fn(pct * duration);
  };

  return (
    <div
      ref={wrapperRef}
      className={cx('player-pill-wrapper', { 'player-pill-wrapper--entering': phase === 'entering', 'player-pill-wrapper--exiting': phase === 'exiting' })}
      style={{ position: 'fixed', bottom: PLAYER_PILL_BOTTOM_MARGIN, left: '50%', transform: 'translateX(-50%)', zIndex: 6, WebkitAppRegion: 'no-drag' }}
    >
      {/* Ambient halo — a large, softly blurred wash of the artwork's own
          color behind the pill, the same "blur flare" language Now Playing
          already uses behind its artwork. A DOM sibling placed *before* the
          capsule below (not z-indexed — plain source order is enough inside
          this wrapper's own stacking context) so it paints behind it. Fades
          in/out with the wrapper's own opacity automatically; no separate
          animation needed. */}
      {artworkRgb && (
        <div style={{
          position: 'absolute', inset: '-41px', borderRadius: 9999,
          background: `rgba(${artworkRgb.r}, ${artworkRgb.g}, ${artworkRgb.b}, 0.35)`,
          filter: 'blur(44px)', transition: 'background 1s ease',
          pointerEvents: 'none', zIndex: 0,
        }} />
      )}

      {/* Hover/scrub time tooltip — a sibling of the clipped capsule below (not
          a child of it), so its `bottom: calc(100% + ...)` position isn't cut
          off by the capsule's own overflow:hidden rounding. */}
      {tipLeft !== null && (
        <div style={{
          position: 'absolute',
          bottom: `calc(100% + 12px)`,
          left: tipLeft,
          transform: 'translateX(-50%)',
          background: 'rgba(20,20,24,0.85)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 500,
          padding: '2px 7px',
          borderRadius: 5,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          zIndex: 2,
        }}>
          {formatTime(tooltipTime)}
        </div>
      )}

      <div
        className="player-pill clickable"
        onClick={onExpandCollapseNP}
        style={{
          position: 'relative', zIndex: 1,
          display: 'flex', flexDirection: 'column',
          width: 'min(644px, calc(100vw - 48px))',
          borderRadius: PILL_RADIUS,
          overflow: 'hidden',
          cursor: 'default',
          pointerEvents: phase === 'exiting' ? 'none' : 'auto',
        }}
      >
        {/* Artwork-color tint — a plain absolutely-positioned layer behind the
            row content (not the capsule's own `background`, so the fallback
            white glass underneath always shows through at whatever the tint
            doesn't cover), alpha pre-clamped by tintAlphaForLuminance so a
            dark cover can't darken this into the icon-legibility problem
            artwork tinting caused the last time it was tried (see the
            function's own comment). Absent entirely when there's no artwork. */}
        {tintAlpha > 0 && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
            background: `rgba(${artworkRgb.r}, ${artworkRgb.g}, ${artworkRgb.b}, ${tintAlpha})`,
            transition: 'background 1s ease',
          }} />
        )}

        {/* Main row: artwork, title/artist, the five transport controls, menu.
            The artwork leads the row (it used to sit between the controls and
            the title, which read as arbitrary) at an equal ROW_INSET from the
            pill's top, bottom and left edges, so its corner radius
            (ARTWORK_RADIUS) is exactly concentric with the pill's own. */}
        <div style={{ position: 'relative', zIndex: 1, height: PILL_ROW_HEIGHT, display: 'flex', alignItems: 'center', gap: 10, padding: `0 9px 0 ${ROW_INSET}px` }}>
          <div
            className="player-artwork"
            style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE, borderRadius: ARTWORK_RADIUS, background: 'rgba(0,0,0,0.06)', overflow: 'hidden', flexShrink: 0, cursor: 'pointer' }}
          >
            {track?.thumb ? <img src={track.thumb} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music size={18} style={{ margin: (ARTWORK_SIZE - 18) / 2 }} color="var(--text-secondary)" />}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, flex: 1 }}>
            <div ref={playerTitleWrapRef} style={{ overflow: 'hidden', whiteSpace: 'nowrap', width: '100%', fontWeight: 700, fontSize: 15, color: 'var(--chrome-text)', lineHeight: 1.3, WebkitMaskImage: playerTitleDist > 0 ? marqueeFadeMask : undefined, maskImage: playerTitleDist > 0 ? marqueeFadeMask : undefined }}>
              <span className={playerTitleDist > 0 ? 'marquee-scroll' : undefined} style={{ display: 'inline-block', '--marquee-distance': `${playerTitleDist}px`, '--marquee-duration': playerTitleDuration }}>
                {track?.title}
              </span>
            </div>
            <div ref={playerSubtitleWrapRef} style={{ overflow: 'hidden', whiteSpace: 'nowrap', width: '100%', fontSize: 13, color: 'var(--chrome-text-dim)', lineHeight: 1.3, WebkitMaskImage: playerSubtitleDist > 0 ? marqueeFadeMask : undefined, maskImage: playerSubtitleDist > 0 ? marqueeFadeMask : undefined }}>
              <span className={playerSubtitleDist > 0 ? 'marquee-scroll' : undefined} style={{ display: 'inline-block', '--marquee-distance': `${playerSubtitleDist}px`, '--marquee-duration': playerSubtitleDuration }}>
                {playerArtistTokens.map((token, i) => (
                  <span key={`${i}:${token}`}>
                    {i > 0 && ' & '}
                    <span className="player-meta-link" onClick={(e) => { e.stopPropagation(); onNavigateMeta('artist', token); }}>{token}</span>
                  </span>
                ))}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <button className={cx('player-control-button player-toggle clickable', { 'player-toggle--on': isShuffle })} aria-pressed={isShuffle} aria-label="Shuffle" style={{ color: isShuffle ? 'var(--chrome-text)' : 'var(--chrome-text-off)' }} onClick={(e) => { e.stopPropagation(); onToggleShuffle(); }}>
              <Shuffle size={SECONDARY_ICON_SIZE} />
            </button>
            <button className="player-control-button skip-btn clickable" style={{ color: 'var(--chrome-text)' }} onClick={(e) => { e.stopPropagation(); playPrev(); }}>
              <SkipBack size={CONTROL_ICON_SIZE} fill="currentColor" />
            </button>
            <button
              className={cx('clickable play-pause-btn', { 'play-pause-btn--playing': isPlaying })}
              style={{ width: PLAY_PAUSE_SIZE, height: PLAY_PAUSE_SIZE, color: 'var(--chrome-text)', flexShrink: 0, position: 'relative' }}
              onClick={(e) => { e.stopPropagation(); onPlayPauseClick(e); }}
              onMouseDown={onPlayPausePressStart}
              onMouseUp={onPlayPausePressEnd}
              onMouseLeave={onPlayPausePressEnd}
              onTouchStart={onPlayPausePressStart}
              onTouchEnd={onPlayPausePressEnd}
            >
              {isHoldingPlayPause && (
                <svg width={HOLD_RING_SIZE} height={HOLD_RING_SIZE} viewBox={`0 0 ${HOLD_RING_SIZE} ${HOLD_RING_SIZE}`} style={{ position: 'absolute', top: -HOLD_RING_OFFSET, left: -HOLD_RING_OFFSET, pointerEvents: 'none' }}>
                  <circle
                    cx={HOLD_RING_SIZE / 2} cy={HOLD_RING_SIZE / 2} r={HOLD_RING_RADIUS}
                    fill="none"
                    stroke="#00f2fe"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={HOLD_RING_CIRCUMFERENCE}
                    strokeDashoffset={HOLD_RING_CIRCUMFERENCE}
                    transform={`rotate(-90 ${HOLD_RING_SIZE / 2} ${HOLD_RING_SIZE / 2})`}
                    className="hold-ring-circle"
                  />
                </svg>
              )}
              {isPlaying ? <Pause size={PLAY_PAUSE_ICON_SIZE} fill="currentColor" /> : <Play size={PLAY_PAUSE_ICON_SIZE} fill="currentColor" style={{ marginLeft: 1 }} />}
            </button>
            <button className="player-control-button skip-btn clickable" style={{ color: 'var(--chrome-text)' }} onClick={(e) => { e.stopPropagation(); playNext(false); }}>
              <SkipForward size={CONTROL_ICON_SIZE} fill="currentColor" />
            </button>
            <button className={cx('player-control-button player-toggle clickable', { 'player-toggle--on': repeatMode !== 'off' })} aria-pressed={repeatMode !== 'off'} aria-label={`Repeat: ${repeatMode}`} style={{ color: repeatMode !== 'off' ? 'var(--chrome-text)' : 'var(--chrome-text-off)' }} onClick={(e) => { e.stopPropagation(); onToggleRepeat(); }}>
              {repeatMode === 'one' ? <Repeat1 size={SECONDARY_ICON_SIZE} /> : <Repeat size={SECONDARY_ICON_SIZE} />}
            </button>
          </div>

          <button
            className="player-control-button clickable"
            style={{ color: 'var(--chrome-text)', flexShrink: 0 }}
            onClick={(e) => { e.stopPropagation(); onOpenMenu(e); }}
          >
            <MoreVertical size={21} />
          </button>
        </div>

        {/* Seek row: elapsed, the line, remaining — the same arrangement as the
            mini player. It replaced a thin line along the pill's very bottom
            edge, which ran into the rounded corners (the track's ends looked
            clipped and pinched where they met the curve). Here the line is a
            full row of its own with SEEK_ROW_INSET of side padding and a few
            px under it, so it never gets near the curve. The input keeps the
            app's tall invisible hit box (22px) around a 4px drawn line. */}
        <div
          style={{ position: 'relative', zIndex: 1, height: SEEK_ROW_HEIGHT, display: 'flex', alignItems: 'center', gap: 10, padding: `0 ${SEEK_ROW_INSET}px 3px`, fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--chrome-text-dim)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <span style={{ minWidth: 30 }}>{formatTime(shown)}</span>
          <div
            ref={seekTrackRef}
            style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}
            onClick={(e) => { e.stopPropagation(); seekFromPointer(e, onSeekBarClick); }}
            onMouseMove={(e) => seekFromPointer(e, onSeekHoverMove)}
            onMouseEnter={onSeekMouseEnter}
            onMouseLeave={onSeekMouseLeave}
          >
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={shown}
              onChange={onSeekChange}
              onMouseDown={onSeekMouseDown}
              onMouseUp={onSeekMouseUp}
              onTouchStart={onSeekMouseDown}
              onTouchEnd={onSeekMouseUp}
              onClick={(e) => e.stopPropagation()}
              className={cx('clickable pill-seek-bar', { 'pill-seek-bar--hovered': isSeekHovered || isSeeking })}
              style={{ '--progress': `${progressPct}%` }}
            />
          </div>
          <span style={{ minWidth: 34, textAlign: 'right' }}>-{formatTime(remaining)}</span>
        </div>
      </div>
    </div>
  );
}
