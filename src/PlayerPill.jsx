import { useRef } from 'react';
import ColourLayers from './ColourLayers.jsx';
import { MoreVertical } from 'lucide-react';
import cx from 'classnames';
import usePillPhase from './usePillPhase';

// The floating player on Home, the Library and detail pages is Chill mode's bar, made the same
// way (ChillScene.jsx's `.chill-bar`): the same width (min(640px, 100% - 48px)), place (22px from
// the bottom, centred), corner radius, padding, text sizes, the same shared transport controls
// (App.jsx's renderTransportControls with Chill's sizes, passed in as `renderTransport`), the same ⋮
// and the same seek row with both times — no cover. What only this one has: the song's colour
// tinting its glass (and a soft glow around it), a click on its empty area opening Now Playing,
// and its bubble in / out. The geometry is shared CSS (`.player-pill--bar` + `.chill-bar`, see
// index.css) and the smoke suite compares the two bars, so they cannot drift apart.
// The bar's outer height (measured 86px), rounded up: the lists keep this much room under their
// last row (App.jsx's PLAYER_PILL_CLEARANCE), and the smoke suite checks the last row clears it.
export const PLAYER_PILL_TOTAL_HEIGHT = 92;
export const PLAYER_PILL_BOTTOM_MARGIN = 22;
export const PILL_RADIUS = 20;

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
  currentTrack, isNowPlayingOpen,
  currentTime, duration, isSeeking, seekValue, isSeekHovered, hoverTime,
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
  renderTransport,
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
          animation needed. Half the strength it had over the old see-through glass (0.35): the
          pages now sit on the song's own colours, where the full halo was too much. A new
          song's colour CROSSFADES in (ColourLayers), never as a `background` transition, which
          repainted this whole blurred layer on every frame for a second on every skip. */}
      <ColourLayers rgb={artworkRgb} fadeMs={1000} className="player-pill-halo" layerStyle={({ r, g, b }) => ({
        position: 'absolute', inset: '-41px', borderRadius: 9999,
        background: `rgba(${r}, ${g}, ${b}, 0.175)`,
        filter: 'blur(44px)', zIndex: 0,
      })} />

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
        className="player-pill player-pill--bar clickable"
        data-player-bar
        onClick={onExpandCollapseNP}
        style={{ position: 'relative', zIndex: 1, cursor: 'default', pointerEvents: phase === 'exiting' ? 'none' : 'auto' }}
      >
        {/* The song's colour tinting the glass, alpha clamped by tintAlphaForLuminance so a light
            cover can't wash the white icons out; crossfaded (ColourLayers), never a `background`
            transition. Rounded with the bar (it is clipped to it). */}
        <ColourLayers rgb={tintAlpha > 0 ? artworkRgb : null} fadeMs={1000} className="player-bar-tint" layerStyle={({ r, g, b }) => ({
          position: 'absolute', inset: 0, zIndex: 0, borderRadius: 'inherit',
          background: `rgba(${r}, ${g}, ${b}, ${tintAlphaForLuminance(r, g, b)})`,
        })} />

        {/* Chill's top row: title / artist, the controls, ⋮ */}
        <div className="chill-bar-top" style={{ position: 'relative', zIndex: 1 }}>
          <div className="chill-meta">
            <div ref={playerTitleWrapRef} style={{ overflow: 'hidden', whiteSpace: 'nowrap', width: '100%', fontWeight: 700, fontSize: 16, color: 'var(--chrome-text)', lineHeight: 1.3, WebkitMaskImage: playerTitleDist > 0 ? marqueeFadeMask : undefined, maskImage: playerTitleDist > 0 ? marqueeFadeMask : undefined }}>
              <span className={playerTitleDist > 0 ? 'marquee-scroll' : undefined} style={{ display: 'inline-block', '--marquee-distance': `${playerTitleDist}px`, '--marquee-duration': playerTitleDuration }}>
                {track?.title}
              </span>
            </div>
            <div ref={playerSubtitleWrapRef} style={{ overflow: 'hidden', whiteSpace: 'nowrap', width: '100%', fontSize: 14, color: 'var(--chrome-text-dim)', lineHeight: 1.3, WebkitMaskImage: playerSubtitleDist > 0 ? marqueeFadeMask : undefined, maskImage: playerSubtitleDist > 0 ? marqueeFadeMask : undefined }}>
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
          <div className="chill-transport">{renderTransport()}</div>
          <button
            className="player-control-button chill-menu-btn clickable"
            title="More"
            aria-label="More"
            data-pill-menu-btn
            onClick={(e) => { e.stopPropagation(); onOpenMenu(e); }}
          >
            <MoreVertical size={20} />
          </button>
        </div>

        {/* Chill's seek row: elapsed — the line — remaining (with this bar's scrub-time bubble) */}
        <div className="chill-seek-row" style={{ position: 'relative', zIndex: 1 }} onClick={(e) => e.stopPropagation()}>
          <span style={{ minWidth: 34 }}>{formatTime(shown)}</span>
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
              className="clickable mini-seek-bar chill-seek-bar"
              style={{ flex: 1, '--progress': `${progressPct}%` }}
            />
          </div>
          <span style={{ minWidth: 40, textAlign: 'right' }}>-{formatTime(remaining)}</span>
        </div>
      </div>
    </div>
  );
}
