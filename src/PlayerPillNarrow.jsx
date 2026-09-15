import { Play, Pause, SkipForward, Music } from 'lucide-react';
import cx from 'classnames';
import usePillPhase from './usePillPhase';

// Sized for touch (a real hit target, not a mouse-hover-oriented capsule
// like the desktop pill) rather than scaled off PlayerPill.jsx's own
// numbers — narrow windows range 380-560px wide, nowhere near desktop's
// room to work with, and these are closer to the old docked mini-player
// bar's own sizes (44px artwork, 36-44px buttons) than to the desktop
// pill's scale.
const PILL_HEIGHT = 56;
const ARTWORK_SIZE = 44;
const PLAY_PAUSE_SIZE = 44;
const PLAY_PAUSE_ICON_SIZE = 20;
const NEXT_ICON_SIZE = 20;
export const PLAYER_PILL_NARROW_TOTAL_HEIGHT = PILL_HEIGHT;
export const PLAYER_PILL_NARROW_BOTTOM_MARGIN = 14;

const HOLD_RING_SIZE = PLAY_PAUSE_SIZE + 8;
const HOLD_RING_RADIUS = HOLD_RING_SIZE / 2 - 2;
const HOLD_RING_CIRCUMFERENCE = 2 * Math.PI * HOLD_RING_RADIUS;
const HOLD_RING_OFFSET = (HOLD_RING_SIZE - PLAY_PAUSE_SIZE) / 2;

// Same luminance-based tint-alpha clamp as PlayerPill.jsx (dark glass, white
// icons — a bright cover shouldn't wash the glass toward white). Not
// imported from there since it's a tiny pure function and importing it would
// couple this file to PlayerPill.jsx's own unrelated constants for no real
// benefit; see that file's own copy for the full contrast-math rationale.
const TINT_BASE_ALPHA = 0.20;
function tintAlphaForLuminance(r, g, b) {
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return TINT_BASE_ALPHA * Math.min(1, (255 - luminance) / 140);
}

// Narrow's floating pill — the same dark-glass capsule language as
// PlayerPill.jsx (shares its CSS: .player-pill/.player-pill-wrapper, the
// bubble-in/out keyframes, hover/press) and the same usePillPhase animation
// hook, but its own component: only two transport buttons (Play/Pause and
// Skip Forward — no shuffle/prev/repeat, all still reachable inside narrow
// Now Playing's own Song tab), no seek strip, no ⋮ menu, and touch-sized
// rather than desktop-scaled. See docs/ARCHITECTURE.md's "Player pill"
// section for the full reasoning behind this split vs. a single
// parameterized component.
//
// One instance covers BOTH of the old docked mini-player bar's call sites
// (Library/Home, and narrow Now Playing's own Lyrics tab) — App.jsx renders
// this once, unconditionally on isNarrowLayout, and `shouldShow` below folds
// in isLyricsOpen so it stays visible on the Lyrics tab (where there's no
// other way to control playback while reading) but hides on the Song tab
// (which already has its own full-size embedded transport controls). Its
// z-index (6) already sits above the Now Playing overlay's (5), so it floats
// correctly over the Lyrics tab's content with no extra stacking work.
export default function PlayerPillNarrow({
  currentTrack, isNowPlayingOpen, isLyricsOpen, isPlaying,
  isHoldingPlayPause,
  playNext,
  onPlayPauseClick, onPlayPausePressStart, onPlayPausePressEnd,
  onTap,
  artworkRgb,
}) {
  const shouldShow = !!currentTrack && (!isNowPlayingOpen || isLyricsOpen);
  const { phase, displayTrack } = usePillPhase(shouldShow, currentTrack);

  if (phase === 'hidden') return null;

  const track = displayTrack;
  const tintAlpha = artworkRgb ? tintAlphaForLuminance(artworkRgb.r, artworkRgb.g, artworkRgb.b) : 0;

  return (
    <div
      className={cx('player-pill-wrapper', { 'player-pill-wrapper--entering': phase === 'entering', 'player-pill-wrapper--exiting': phase === 'exiting' })}
      style={{ position: 'fixed', bottom: PLAYER_PILL_NARROW_BOTTOM_MARGIN, left: '50%', transform: 'translateX(-50%)', zIndex: 6, WebkitAppRegion: 'no-drag' }}
    >
      {/* Ambient halo — same "blur flare" wash as the desktop pill, a DOM
          sibling placed before the capsule so plain source order keeps it
          behind, no z-index needed. */}
      {artworkRgb && (
        <div style={{
          position: 'absolute', inset: '-40px', borderRadius: 9999,
          background: `rgba(${artworkRgb.r}, ${artworkRgb.g}, ${artworkRgb.b}, 0.35)`,
          filter: 'blur(42px)', transition: 'background 1s ease',
          pointerEvents: 'none', zIndex: 0,
        }} />
      )}

      <div
        className="player-pill clickable"
        onClick={onTap}
        style={{
          position: 'relative', zIndex: 1,
          width: 'calc(100vw - 24px)',
          height: PILL_HEIGHT,
          borderRadius: 9999,
          overflow: 'hidden',
          cursor: 'default',
          pointerEvents: phase === 'exiting' ? 'none' : 'auto',
        }}
      >
        {/* Artwork-color tint — see PlayerPill.jsx's own copy of this layer
            for the full rationale; identical mechanism here. */}
        {tintAlpha > 0 && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
            background: `rgba(${artworkRgb.r}, ${artworkRgb.g}, ${artworkRgb.b}, ${tintAlpha})`,
            transition: 'background 1s ease',
          }} />
        )}

        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 0 6px' }}>
          <div
            className="player-artwork"
            style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE, borderRadius: 9, background: 'rgba(0,0,0,0.06)', overflow: 'hidden', flexShrink: 0 }}
          >
            {track?.thumb ? <img src={track.thumb} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music size={18} style={{ margin: 13 }} color="var(--text-secondary)" />}
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--chrome-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track?.title}</div>
            <div style={{ fontSize: 13, color: 'var(--chrome-text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track?.artist || ''}</div>
          </div>

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

          <button
            className="player-control-button clickable"
            style={{ padding: 10, color: 'var(--chrome-text)', flexShrink: 0 }}
            onClick={(e) => { e.stopPropagation(); playNext(false); }}
          >
            <SkipForward size={NEXT_ICON_SIZE} fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  );
}
