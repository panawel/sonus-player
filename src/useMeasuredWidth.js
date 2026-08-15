import { useState, useLayoutEffect } from 'react';

// Live offsetWidth of a ref'd element, kept in sync via ResizeObserver — reacts
// to window-resize reflow *and* content-driven changes (text length, sibling
// elements changing size, etc.), not just viewport width. ResizeObserver is
// feature-detected and skipped when absent (jsdom, this project's vitest
// environment, doesn't implement it) so mounting in tests never throws; the
// width simply stays at its initial measurement (or 0) in that environment.
export function useMeasuredWidth(ref) {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.offsetWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(entry.target.offsetWidth);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}
