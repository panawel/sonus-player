import { useEffect, useRef, useState } from 'react';
import { Play, SkipForward, ListPlus, Music } from 'lucide-react';
import { describeAddition } from './trackUtils.js';

// The "what do you want to do with these songs?" dialog that drag-and-drop, the
// title bar's + button and File > Add Music open when the library isn't empty.
// `compact` is the mini player's layout (the window is only 180-420px tall, and
// the macOS traffic lights sit in its top-left corner); everything else,
// narrow windows included, uses the regular one.

// Moves the window while the pointer is held down on the dialog's background or
// title-bar band (never on a button). A page-driven drag over IPC rather than a
// `-webkit-app-region: drag` area: see 'window:drag' in electron/main.js. The
// click that follows releasing a drag is swallowed: the pointer can land on the
// backdrop (the window lags the pointer), and a click there cancels the dialog.
function useWindowDrag() {
  const stopRef = useRef(null);
  useEffect(() => () => stopRef.current?.(), []);
  return (e) => {
    const api = window.electronAPI;
    if (e.button !== 0 || !api?.dragWindow || e.target.closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    let moved = false;
    api.dragWindow('start');
    const move = () => { moved = true; api.dragWindow('move'); };
    const swallowClick = (ev) => ev.stopPropagation();
    const stop = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('blur', stop);
      stopRef.current = null;
      api.dragWindow('end');
      if (moved) {
        window.addEventListener('click', swallowClick, true);
        setTimeout(() => window.removeEventListener('click', swallowClick, true), 0);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);
    stopRef.current = stop;
  };
}

const options = (hasCurrentTrack) => [
  { action: 'play', label: 'Play now', compactLabel: 'Play', hint: 'Replaces your current library', Icon: Play, primary: true },
  { action: 'play-next', label: 'Play next', compactLabel: 'Play next', hint: hasCurrentTrack ? 'Right after the current song' : 'At the top of your library', Icon: SkipForward },
  { action: 'add-to-queue', label: 'Add to queue', compactLabel: 'Add to queue', hint: 'At the end of your library', Icon: ListPlus },
];

export default function AddTracksDialog({ tracks, compact = false, hasCurrentTrack = false, onResolve }) {
  const playRef = useRef(null);
  useEffect(() => { playRef.current?.focus(); }, []);
  const { heading, detail, art } = describeAddition(tracks);
  const opts = options(hasCurrentTrack);
  const startDrag = useWindowDrag();

  // The buttons carry only their names; what each one does shows in the hint
  // line under them for the button the pointer is over, else the focused one
  // (Play, to begin with, so the line always says what Enter will do).
  const [hovered, setHovered] = useState(null);
  const [focused, setFocused] = useState('play');
  const hint = opts.find((o) => o.action === (hovered ?? focused))?.hint ?? '';

  return (
    <div className="confirm-modal-backdrop add-dialog-backdrop" onClick={() => onResolve('cancel')}>
      {/* A band over the title bar that moves the window (the backdrop itself keeps
          taking the click-outside-to-cancel, so it cannot be a native drag region).
          Mini has no band: its panel is the whole window and drags from its own
          background. */}
      {!compact && <div className="add-dialog-drag-strip" aria-hidden="true" onMouseDown={startDrag} onClick={(e) => e.stopPropagation()} />}
      <div
        className={`confirm-modal-panel add-dialog${compact ? ' add-dialog--compact' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Add songs to your library"
        onMouseDown={startDrag}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="add-dialog-header">
          <div className="add-dialog-art">
            {art ? <img src={art} alt="" /> : <Music size={compact ? 16 : 22} />}
          </div>
          <div className="add-dialog-text">
            <div className="add-dialog-title">{heading}</div>
            <div className="add-dialog-detail">{detail}</div>
          </div>
          {compact && (
            <button type="button" className="add-dialog-cancel clickable" onClick={() => onResolve('cancel')}>Cancel</button>
          )}
        </div>

        <div className="add-dialog-options">
          {opts.map(({ action, label, compactLabel, Icon, primary }) => (
            <button
              key={action}
              type="button"
              ref={primary ? playRef : undefined}
              className={`add-dialog-option clickable${primary ? ' add-dialog-option--primary' : ''}`}
              onClick={() => onResolve(action)}
              onMouseEnter={() => setHovered(action)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setFocused(action)}
            >
              <Icon size={compact ? 18 : 20} aria-hidden="true" />
              <span className="add-dialog-option-label">{compact ? compactLabel : label}</span>
            </button>
          ))}
        </div>

        {compact ? (
          <div className="add-dialog-hint" aria-live="polite">{hint}</div>
        ) : (
          <div className="add-dialog-footer">
            <div className="add-dialog-hint" aria-live="polite">{hint}</div>
            <button type="button" className="add-dialog-cancel clickable" onClick={() => onResolve('cancel')}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
