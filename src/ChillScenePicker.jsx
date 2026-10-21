import { useEffect, useRef } from 'react';
import cx from 'classnames';

// The Chill-mode scene picker: a small popup of thumbnails under the title strip's
// scene button (App.jsx). It closes on a click outside it (the button itself is
// exempt: it toggles) and on Escape — which is claimed first, in the capture
// phase, so ChillScene's own Escape-to-exit never also fires.
export default function ChillScenePicker({ scenes, activeId, onSelect, onClose }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onPointerDown = (e) => {
      const t = e.target;
      if (!(t instanceof Element) || t.closest('.chill-picker, .chill-scene-btn')) return;
      onCloseRef.current();
    };
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  return (
    <div className="chill-picker" data-chill-chrome role="listbox" aria-label="Chill scenes">
      {scenes.map((s) => (
        <button
          key={s.id}
          className={cx('clickable chill-picker-item', { active: s.id === activeId })}
          role="option"
          aria-selected={s.id === activeId}
          data-scene-id={s.id}
          onClick={() => onSelect(s.id)}
        >
          <img src={s.thumb} alt="" draggable={false} />
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  );
}
