import { useEffect } from 'react';

// macOS-style scrollbars: visible while an element scrolls, fading away shortly after. The app's
// custom ::-webkit-scrollbar style replaces the system's auto-hiding overlay bar, and Chromium
// keeps a custom bar on screen whenever the content overflows, so hiding it is up to us. Only the
// thumb's colour changes (index.css, --sb-thumb); the bar keeps its width, so no layout moves.
// One capture-phase listener covers every scroller: scroll events don't bubble, but they do capture.
export const SCROLLBAR_IDLE_MS = 900;

export default function useAutoHideScrollbars(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    const timers = new Map();
    const onScroll = (e) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      el.classList.add('sb-fade', 'sb-scrolling');
      clearTimeout(timers.get(el));
      timers.set(el, setTimeout(() => { el.classList.remove('sb-scrolling'); timers.delete(el); }, SCROLLBAR_IDLE_MS));
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      for (const [el, t] of timers) { clearTimeout(t); el.classList.remove('sb-scrolling'); }
    };
  }, [enabled]);
}
