import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import cx from 'classnames';
import { MoreVertical } from 'lucide-react';
import { MarqueeLine } from './MiniPlayer.jsx';
import { computeFraming } from './chillGeometry.js';
import ChillTurntable from './ChillTurntable.jsx';
import ChillBeach from './ChillBeach.jsx';
import ChillRoom from './ChillRoom.jsx';
import { getChillScene } from './chillScenes.js';
import {
  transitionReducer, initialTransition, isTransitionLoading,
  CHILL_FADE_MS, CHILL_FADE_REDUCED_MS, CHILL_LOAD_TIMEOUT_MS,
} from './chillTransition.js';

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
//
// Switching scenes (chillTransition.js): this component stays mounted - the bar
// never blinks - and each scene is a LAYER. The one on screen keeps running while
// the requested one loads hidden behind it (photo decoded, textures uploaded, first
// frame drawn: its `onReady`), and only then does it crossfade in. The same holds
// for the first scene: the whole Chill layer fades in once it is ready, instead of
// a brown box and a photo popping in.

// One scene's stage. `role`: 'current' (on screen), 'loading' (hidden, preparing),
// 'in' (fading in over the current one).
function SceneLayer({ sceneId, seq, role, box, shared, onReady }) {
  const scene = getChillScene(sceneId);
  const framing = useMemo(() => computeFraming(box.w, box.h, box.dpr, scene.framing), [box, scene]);
  const handleReady = useCallback(() => onReady(sceneId, seq), [onReady, sceneId, seq]);
  const { arts, currentTrack, artworkRgb, isPlaying, shown, duration, formatTime, onTogglePlay, labelRgb } = shared;
  return (
    <div
      className={cx('chill-layer', `chill-layer--${role}`)}
      data-layer-scene={sceneId}
      data-layer-role={role}
      inert={role === 'loading' ? true : undefined}
    >
      <div
        className="chill-stage"
        style={{ width: scene.framing.sceneW, height: scene.framing.sceneH, transform: `translate(${framing.tx}px, ${framing.ty}px) scale(${framing.k})` }}
      >
        {scene.kind === 'turntable' && (
          <ChillTurntable photoUrl={scene.photo} arts={arts} isPlaying={isPlaying} labelRgb={labelRgb} onTogglePlay={onTogglePlay} onReady={handleReady} />
        )}
        {scene.kind === 'room' && (
          <ChillRoom scene={scene} framing={framing} dpr={box.dpr} arts={arts} isPlaying={isPlaying} lyrics={currentTrack?.lyrics ?? null} trackKey={currentTrack?.filePath} title={currentTrack?.title || ''} artist={currentTrack?.artist || ''} onReady={handleReady} />
        )}
        {scene.kind === 'beach' && (
          <ChillBeach
            scene={scene} framing={framing} dpr={box.dpr}
            arts={arts} artworkRgb={artworkRgb}
            title={currentTrack?.title || ''} artist={currentTrack?.artist || ''}
            shown={shown} duration={duration || 0} isPlaying={isPlaying} formatTime={formatTime}
            onReady={handleReady}
          />
        )}
      </div>
    </div>
  );
}

export default function ChillScene({
  scene, currentTrack, artSrc, isPlaying, artworkRgb,
  currentTime, duration, isSeeking, seekValue,
  onSeekChange, onSeekMouseDown, onSeekMouseUp,
  formatTime, renderTransport, marqueeFadeMask,
  onTogglePlay, onExit, exitOnEscape, chromeVisible, onOpenMenu, onLoadingChange,
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
  // The stages only mount once the first size is known.
  const ready = box.w > 0;

  // ── which scene is on screen, which is loading ──────────────────────────
  const [tState, dispatch] = useReducer(transitionReducer, scene.id, initialTransition);
  useEffect(() => { dispatch({ type: 'request', sceneId: scene.id }); }, [scene.id]);
  // A layer reports ready when its first frame is DRAWN; two animation frames later
  // it has actually reached the screen, which is when it is safe to start showing it.
  const onLayerReady = useCallback((sceneId, seq) => {
    requestAnimationFrame(() => requestAnimationFrame(() => dispatch({ type: 'ready', sceneId, seq })));
  }, []);
  // A scene that never reports ready (a stalled load, a lost context) is shown anyway.
  useEffect(() => {
    if (!tState.target || tState.fading) return undefined;
    const { sceneId, seq } = tState.target;
    const timer = setTimeout(() => dispatch({ type: 'ready', sceneId, seq }), CHILL_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [tState.target, tState.fading]);
  const fadeMs = useMemo(
    () => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? CHILL_FADE_REDUCED_MS : CHILL_FADE_MS), []);
  useEffect(() => {
    if (!tState.fading) return undefined;
    const timer = setTimeout(() => dispatch({ type: 'faded' }), fadeMs + 60);
    return () => clearTimeout(timer);
  }, [tState.fading, fadeMs]);
  // The scene button's spinner (App.jsx) follows this.
  const loading = isTransitionLoading(tState);
  const onLoadingChangeRef = useRef(onLoadingChange);
  onLoadingChangeRef.current = onLoadingChange;
  useEffect(() => { onLoadingChangeRef.current?.(loading); }, [loading]);
  useEffect(() => () => onLoadingChangeRef.current?.(false), []);
  const shownSceneId = tState.current?.sceneId ?? tState.target?.sceneId ?? scene.id;
  const layers = [];
  if (tState.current) layers.push({ ...tState.current, role: 'current' });
  if (tState.target) layers.push({ ...tState.target, role: tState.fading ? 'in' : 'loading' });

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
      className={cx('chill-scene', `chill-scene--${shownSceneId}`, { 'chill-scene--idle': !chromeVisible, 'chill-scene--waiting': !tState.current })}
      style={{ '--chill-fade': `${fadeMs}ms` }}
      data-scene={shownSceneId}
      data-chill-state={tState.fading ? 'fading' : tState.target ? 'loading' : 'ready'}
    >
      {ready && layers.map((l) => (
        <SceneLayer
          key={`${l.sceneId}:${l.seq}`} sceneId={l.sceneId} seq={l.seq} role={l.role}
          box={box} onReady={onLayerReady}
          shared={{ arts, currentTrack, artworkRgb, isPlaying, shown, duration, formatTime, onTogglePlay, labelRgb }}
        />
      ))}

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
