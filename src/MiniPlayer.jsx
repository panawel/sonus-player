import { useEffect, useRef, useState } from 'react';
import cx from 'classnames';
import { Music, Maximize2, MoreVertical } from 'lucide-react';
import AmbientFlares from './AmbientFlares.jsx';

const marqueeDuration = (d) => `${Math.min(14, Math.max(4, 3 + d / 30))}s`;

// Same overflow-measure + .marquee-scroll technique App.jsx uses for the
// pills' title/artist, but self-contained: App's refs point into PlayerPill,
// which isn't mounted while the mini player is showing.
export function MarqueeLine({ text, fadeMask, style }) {
  const wrapRef = useRef(null);
  const [dist, setDist] = useState(0);

  useEffect(() => {
    setDist(0);
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      const d = el.scrollWidth - el.clientWidth;
      setDist(d > 0 ? Math.ceil(d) : 0);
    };
    const rafId = requestAnimationFrame(() => requestAnimationFrame(measure));
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measure);
    };
  }, [text]);

  return (
    <div
      ref={wrapRef}
      style={{
        overflow: 'hidden', whiteSpace: 'nowrap', width: '100%',
        WebkitMaskImage: dist > 0 ? fadeMask : undefined, maskImage: dist > 0 ? fadeMask : undefined,
        ...style,
      }}
    >
      <span
        dir="auto"
        className={dist > 0 ? 'marquee-scroll' : undefined}
        style={{ display: 'inline-block', '--marquee-distance': `${dist}px`, '--marquee-duration': marqueeDuration(dist) }}
      >
        {text}
      </span>
    </div>
  );
}

// The whole window, once it's shorter than MINI_LAYOUT_HEIGHT_BREAKPOINT
// (trackUtils.js): artwork, title/artist, a seek line with elapsed/remaining
// time, and the same five transport controls as the full-width pill. App.jsx
// keeps rendering everything underneath (hidden + inert, not unmounted), so
// leaving mini mode returns to exactly where the user was.
//
// The transport row is App.jsx's own renderTransportControls (passed in as
// renderTransport) rather than a copy: it already is "the five controls plus
// the hold ring, wired to the one set of handlers", and a second copy would
// be a second place for shuffle/repeat behavior to drift.
//
// No chrome of its own: the window is the card. Its corners are macOS's own
// window corners and the glass is the window's native vibrancy — CSS can't
// round or clip either, so there is deliberately no border-radius here.
export default function MiniPlayer({
  currentTrack, isPlaying, artworkRgb,
  currentTime, duration, isSeeking, seekValue,
  onSeekChange, onSeekMouseDown, onSeekMouseUp,
  formatTime, renderTransport, marqueeFadeMask,
  chromeVisible, onRestore, restoreOnEscape, onOpenMenu,
}) {

  useEffect(() => {
    if (!restoreOnEscape) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') onRestore(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onRestore, restoreOnEscape]);

  const shown = isSeeking ? seekValue : currentTime;
  const progressPct = duration ? (shown / duration) * 100 : 0;
  const remaining = Math.max(0, (duration || 0) - shown);
  // Both come from CSS custom properties so index.css can change them for the very shortest windows (see
  // `.mini-player` there): at the 180px minimum the traffic lights sat ~5px above the artwork against 22px
  // of margin on its left.
  const artSize = 'var(--mini-art, clamp(64px, 17vh, 96px))';

  return (
    <div
      className="mini-player"
      style={{
        position: 'fixed', inset: 0, zIndex: 900, boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        // 26px of top padding leaves the traffic lights (shown on hover)
        // their own strip above the artwork instead of landing on it.
        padding: 'var(--mini-pad-top, 26px) 22px 14px',
        background: 'rgba(0,0,0,0.2)', color: 'var(--chrome-text)',
        // A glass edge catches light along its top: a faint 1px inset line,
        // the same idea as the pill's own. Top only — the window's native
        // rounded corners clip the other three sides, so a full border would
        // be cut off at the corners.
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14)',
        WebkitAppRegion: 'drag',
      }}
    >
      {/* Now Playing's drifting lights (moving only while playing). Its 100px
          blur is tuned for a full panel; scaled to the window height here so
          the lights stay as soft-edged but still read as colour in a card
          this small. */}
      <AmbientFlares artworkRgb={artworkRgb} isPlaying={isPlaying} blur="clamp(36px, 14vh, 64px)" />

      <button
        className="mini-restore-btn clickable"
        aria-label="Expand window"
        title="Expand window"
        onClick={onRestore}
        tabIndex={chromeVisible ? 0 : -1}
        // Shown and hidden together with the macOS traffic lights, from the
        // same pointer-over-the-window signal (see App.jsx). Fully hidden
        // otherwise, so it can't be clicked blind; Escape works either way.
        style={{ opacity: chromeVisible ? 1 : 0, pointerEvents: chromeVisible ? 'auto' : 'none' }}
      >
        <Maximize2 size={14} />
      </button>

      <div className="mini-content" style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 560, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          {/* Same treatment as Now Playing's artwork card: light border, a glow in
              the cover's own colour, and the slow breathing pulse while playing
              (the np-artwork class; keyed by track so its fade-in replays). */}
          <div
            key={currentTrack?.filePath}
            className={cx('np-artwork', { 'np-artwork-paused': !isPlaying })}
            style={{
              width: artSize, height: artSize, borderRadius: 12, overflow: 'hidden', flexShrink: 0,
              background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid rgba(255,255,255,0.15)',
              boxShadow: artworkRgb
                ? `0 10px 28px rgba(${artworkRgb.r}, ${artworkRgb.g}, ${artworkRgb.b}, 0.5), 0 4px 14px rgba(0,0,0,0.6)`
                : '0 10px 28px rgba(0,0,0,0.5)',
            }}
          >
            {currentTrack?.thumb
              ? <img src={currentTrack.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <Music size={28} color="var(--chrome-text-dim)" />}
          </div>

          <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
            {currentTrack ? (
              <>
                <MarqueeLine text={currentTrack.title} fadeMask={marqueeFadeMask} style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.3 }} />
                <MarqueeLine text={currentTrack.artist || 'Unknown artist'} fadeMask={marqueeFadeMask} style={{ fontSize: 15, lineHeight: 1.3, color: 'var(--chrome-text-dim)' }} />
              </>
            ) : (
              <div style={{ fontSize: 15, color: 'var(--chrome-text-dim)', lineHeight: 1.3, paddingTop: 6 }}>Nothing playing</div>
            )}
          </div>

          {currentTrack && (
            <div className={cx('mini-eq', { 'mini-eq--playing': isPlaying })} aria-hidden="true" style={{ marginTop: 8 }}>
              <span /><span /><span /><span />
            </div>
          )}
        </div>

        {currentTrack && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'var(--mini-seek-gap, 10px)', fontSize: 12, color: 'var(--chrome-text-dim)', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ minWidth: 34 }}>{formatTime(shown)}</span>
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
                className="clickable mini-seek-bar"
                style={{ flex: 1, '--progress': `${progressPct}%` }}
              />
              <span style={{ minWidth: 40, textAlign: 'right' }}>-{formatTime(remaining)}</span>
            </div>
            {/* The five controls, then the ⋮ track menu (the same menu the pill, Now Playing and
                Chill mode open — App.jsx renders it once at the root, above this card). */}
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {renderTransport()}
              {onOpenMenu && (
                <button
                  className="player-control-button mini-menu-btn clickable"
                  title="More"
                  aria-label="More"
                  data-mini-menu-btn
                  onClick={(e) => { e.stopPropagation(); onOpenMenu(e); }}
                >
                  <MoreVertical size={20} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
