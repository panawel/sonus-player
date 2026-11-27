import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Maximize2, Music } from 'lucide-react';
import { MarqueeLine } from './MiniPlayer.jsx';
import ColourLayers from './ColourLayers.jsx';

// Strip mode (File > Strip Mode): one slim glass capsule, at home beside the macOS Dock. It fills
// its own small frameless window (main.js opens it, StripApp.jsx feeds it the main window's
// playback state); this is only the capsule:
//   [cover] [title / seek line] [shuffle] [prev] [play] [next] [repeat]
//
// Only actions everyone already knows, and nothing on screen to explain them:
//   - drag it anywhere but a button or the seek line → the window moves, like any window.
//     Page-driven ('window:drag': main follows the OS cursor and snaps it into the Dock band on
//     release), because a frameless window's native drag area would hide the pointer from the
//     page, and the cover, buttons and seek line must still take theirs;
//   - the seek line: click or drag along it to seek (it follows the pointer, the song seeks on
//     release);
//   - the buttons; the cover → back to the full window (or Escape); ← / → seek 5 seconds.
// `preview`: the main window shows it while it is being shrunk into Strip mode (App.jsx). It is a
// picture only there: no keys (the app's own ← / → would seek twice), no pointer.
export const SEEK_STEP = 5;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export default function StripPlayer({
  currentTrack, isPlaying, currentTime, duration, artworkRgb, marqueeFadeMask, isShuffle, repeatMode, preview = false,
  onTogglePlay, onPrev, onNext, onToggleShuffle, onToggleRepeat, onSeek, onExpand,
}) {
  const dragging = useRef(false);
  const seekRef = useRef(null);
  const [scrub, setScrub] = useState(null); // the seek line's position while it is being dragged (0..1)
  const timeRef = useRef({ currentTime, duration });
  timeRef.current = { currentTime, duration };

  useEffect(() => {
    if (preview) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onExpand();
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.altKey && !e.ctrlKey) {
        const { currentTime: t, duration: d } = timeRef.current;
        if (!d) return;
        e.preventDefault();
        onSeek(clamp(t + (e.key === 'ArrowRight' ? SEEK_STEP : -SEEK_STEP), 0, d));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExpand, onSeek, preview]);
  useEffect(() => () => { if (dragging.current) window.electronAPI?.dragWindow?.('end'); }, []);

  // Moving the window: anywhere but a button or the seek line.
  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('button, [data-strip-seek]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    window.electronAPI?.dragWindow?.('start');
  };
  const onPointerMove = () => { if (dragging.current) window.electronAPI?.dragWindow?.('move'); };
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    window.electronAPI?.dragWindow?.('end');
  };

  // The seek line.
  const fractionAt = (e) => {
    const r = seekRef.current.getBoundingClientRect();
    return r.width ? clamp((e.clientX - r.left) / r.width, 0, 1) : 0;
  };
  const onSeekDown = (e) => {
    if (e.button !== 0 || !duration) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrub(fractionAt(e));
  };
  const onSeekMove = (e) => { if (scrub != null) setScrub(fractionAt(e)); };
  const onSeekUp = (e) => {
    if (scrub == null) return;
    const f = fractionAt(e);
    setScrub(null);
    onSeek(f * duration);
  };

  const progress = scrub ?? (duration ? clamp(currentTime / duration, 0, 1) : 0);
  const pct = `${(progress * 100).toFixed(3)}%`;
  // The title alone: a strip is read at a glance, and the cover already says a lot about the rest.
  const line = currentTrack ? (currentTrack.title || 'Unknown title') : '';

  return (
    <div className="strip-window">
      <div
        className="strip-player"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <ColourLayers rgb={artworkRgb} fadeMs={1000} className="strip-tint" layerStyle={({ r, g, b }) => ({ position: 'absolute', inset: 0, background: `rgba(${r}, ${g}, ${b}, 0.30)` })} />
        <button type="button" className="strip-cover" data-action="expand" title="Back to the full window (Esc)" aria-label="Back to the full window" onClick={onExpand}>
          {currentTrack?.thumb ? <img src={currentTrack.thumb} alt="" draggable={false} /> : <Music size={14} />}
          <span className="strip-cover-expand"><Maximize2 size={13} /></span>
        </button>
        <div className="strip-text">
          {currentTrack ? (
            <MarqueeLine text={line} fadeMask={marqueeFadeMask} style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.2 }} />
          ) : (
            <div className="strip-sub">Nothing playing</div>
          )}
          <div
            ref={seekRef}
            className={`strip-seek${scrub != null ? ' strip-seek--active' : ''}${duration ? '' : ' strip-seek--off'}`}
            data-strip-seek
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration || 0)}
            aria-valuenow={Math.round(progress * (duration || 0))}
            onPointerDown={onSeekDown}
            onPointerMove={onSeekMove}
            onPointerUp={onSeekUp}
            onPointerCancel={() => setScrub(null)}
          >
            <div className="strip-seek-track" />
            <div className="strip-seek-fill" data-strip-seek-fill style={{ width: pct }} />
            <div className="strip-seek-knob" style={{ left: pct }} />
          </div>
        </div>
        <button type="button" className={`strip-btn strip-btn--minor player-toggle${isShuffle ? ' player-toggle--on' : ''}`} data-action="shuffle" aria-label="Shuffle" aria-pressed={!!isShuffle} onClick={onToggleShuffle}><Shuffle size={14} /></button>
        <button type="button" className="strip-btn" data-action="prev" aria-label="Previous" onClick={onPrev}><SkipBack size={15} fill="currentColor" /></button>
        <button type="button" className="strip-btn" data-action="play" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={onTogglePlay}>
          {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: 1 }} />}
        </button>
        <button type="button" className="strip-btn" data-action="next" aria-label="Next" onClick={onNext}><SkipForward size={15} fill="currentColor" /></button>
        <button type="button" className={`strip-btn strip-btn--minor player-toggle${repeatMode !== 'off' ? ' player-toggle--on' : ''}`} data-action="repeat" aria-label={`Repeat: ${repeatMode || 'off'}`} aria-pressed={repeatMode !== 'off'} onClick={onToggleRepeat}>
          {repeatMode === 'one' ? <Repeat1 size={14} /> : <Repeat size={14} />}
        </button>
      </div>
    </div>
  );
}
