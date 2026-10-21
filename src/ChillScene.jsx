import { useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import { MoreVertical } from 'lucide-react';
import { MarqueeLine } from './MiniPlayer.jsx';
import { computeFraming } from './chillGeometry.js';
import ChillTurntable from './ChillTurntable.jsx';
import ChillBeach from './ChillBeach.jsx';
import ChillRoom from './ChillRoom.jsx';

// Chill mode — full-width Now Playing as a scene: a photo fills the WHOLE WINDOW
// (a fixed full-bleed layer like the mini player's, so it covers the title strip
// too; macOS's own window corners clip it) and the playing song's artwork is part
// of it — the spinning record of the turntable scene, the phone screen of the
// hammock scene. Which scene is `scene` (chillScenes.js); this component is the
// part they share:
//   * framing the photo in a window of any shape (chillGeometry.js);
//   * the artwork crossfade between tracks;
//   * the bottom bar, the invisible drag band along the top, Escape.
//
// Whether the chrome is up (this bar, and — from App.jsx — the title strip's
// buttons) comes in as `chromeVisible` from one shared idle clock
// (useChillChrome.js). Because this layer is no-drag and covers the strip, it
// brings back its own invisible drag band along the top so the window can still
// be moved from there — and where that band sits in the document matters (see
// the comment in App.jsx).
//
// Everything scene-specific is drawn inside ONE box, the "stage" (the photo's own
// pixel size), scaled and shifted as a unit, so overlays stay glued to the photo
// at every window size. The layers and why they are ordered as they are are in
// docs/ARCHITECTURE.md ("Chill mode").
export default function ChillScene({
  scene, currentTrack, artSrc, isPlaying, artworkRgb,
  currentTime, duration, isSeeking, seekValue,
  onSeekChange, onSeekMouseDown, onSeekMouseUp,
  formatTime, renderTransport, marqueeFadeMask,
  onTogglePlay, onExit, exitOnEscape, chromeVisible, onOpenMenu,
}) {
  const rootRef = useRef(null);

  // ── size → framing ─────────────────────────────────────────────────────
  const [box, setBox] = useState({ w: 0, h: 0, dpr: 1 });
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    // Layout size, NOT getBoundingClientRect: that includes ancestors' transforms,
    // and Now Playing's own fade-in is a scale(0.96 -> 1) — entering Chill mode
    // mid-fade would frame the scene for a box that is 4% too small.
    const measure = () => {
      setBox({ w: el.clientWidth, h: el.clientHeight, dpr: window.devicePixelRatio || 1 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const framing = useMemo(() => computeFraming(box.w, box.h, box.dpr, scene.framing), [box, scene]);
  // The stage only mounts once the first size is known.
  const ready = box.w > 0;

  // ── artwork, crossfading between tracks ────────────────────────────────
  const [arts, setArts] = useState(() => [{ id: 0, src: artSrc }]);
  const artIdRef = useRef(0);
  useEffect(() => {
    const id = ++artIdRef.current;
    setArts(prev => (prev[prev.length - 1].src === artSrc ? prev : [prev[prev.length - 1], { id, src: artSrc }]));
  }, [artSrc]);
  useEffect(() => {
    if (arts.length < 2) return undefined;
    const t = setTimeout(() => setArts(prev => prev.slice(-1)), 900);
    return () => clearTimeout(t);
  }, [arts]);

  // ── Escape exits ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!exitOnEscape) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') onExit(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exitOnEscape, onExit]);

  const shown = isSeeking ? seekValue : currentTime;
  const progressPct = duration ? (shown / duration) * 100 : 0;
  const remaining = Math.max(0, (duration || 0) - shown);
  const labelRgb = artworkRgb ? `rgb(${artworkRgb.r}, ${artworkRgb.g}, ${artworkRgb.b})` : '#5b6470';

  return (
    <div
      ref={rootRef}
      className={cx('chill-scene', `chill-scene--${scene.id}`, { 'chill-scene--idle': !chromeVisible })}
      data-scene={scene.id}
    >
      {ready && (
        <div
          className="chill-stage"
          style={{ width: scene.framing.sceneW, height: scene.framing.sceneH, transform: `translate(${framing.tx}px, ${framing.ty}px) scale(${framing.k})` }}
        >
          {scene.kind === 'turntable' && (
            <ChillTurntable photoUrl={scene.photo} arts={arts} isPlaying={isPlaying} labelRgb={labelRgb} onTogglePlay={onTogglePlay} />
          )}
          {scene.kind === 'room' && (
            <ChillRoom scene={scene} framing={framing} dpr={box.dpr} arts={arts} isPlaying={isPlaying} lyrics={currentTrack?.lyrics ?? null} />
          )}
          {scene.kind === 'beach' && (
            <ChillBeach
              scene={scene} framing={framing} dpr={box.dpr}
              arts={arts} artworkRgb={artworkRgb}
              title={currentTrack?.title || ''} artist={currentTrack?.artist || ''}
              shown={shown} duration={duration || 0} isPlaying={isPlaying} formatTime={formatTime}
            />
          )}
        </div>
      )}

      <div className="chill-scrim" />

      <div className="chill-drag-strip" />

      <div className="chill-bar" data-chill-chrome inert={!chromeVisible}>
        <div className="chill-bar-top">
          <div className="chill-meta">
            {currentTrack ? (
              <>
                <MarqueeLine text={currentTrack.title} fadeMask={marqueeFadeMask} style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.3 }} />
                <MarqueeLine text={currentTrack.artist || 'Unknown artist'} fadeMask={marqueeFadeMask} style={{ fontSize: 14, lineHeight: 1.3, color: 'var(--chrome-text-dim)' }} />
              </>
            ) : null}
          </div>
          <div className="chill-transport">{renderTransport()}</div>
          {/* The track menu (Start Mix, Edit Tags, Reveal in Finder, Search in YouTube) — the SAME one
              the pill and Now Playing's own ⋮ open (App.jsx renders it once, at the root, above this
              layer). Without it Chill mode would be the one place you can't reach the menu. */}
          {onOpenMenu && (
            <button
              className="player-control-button chill-menu-btn clickable"
              title="More"
              aria-label="More"
              data-chill-menu-btn
              onClick={(e) => { e.stopPropagation(); onOpenMenu(e); }}
            >
              <MoreVertical size={20} />
            </button>
          )}
        </div>
        <div className="chill-seek-row">
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
            className="clickable mini-seek-bar chill-seek-bar"
            style={{ flex: 1, '--progress': `${progressPct}%` }}
          />
          <span style={{ minWidth: 40, textAlign: 'right' }}>-{formatTime(remaining)}</span>
        </div>
      </div>
    </div>
  );
}
