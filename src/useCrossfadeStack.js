import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// A colour (or anything) that changes by CROSSFADING fixed layers, never by animating the layer's
// own paint. Now Playing's lights, the window tint and the cover glow used to change colour with a
// CSS `background` transition: inside a big blur that repaints the whole blurred layer every frame
// for a second (~200 large repaints per skip), which showed as patchwork frames while skipping.
// Each value now gets its own static layer; the newest fades in by opacity (a compositor-only
// animation, no repaint), the older ones fade out and are removed. The caller renders each layer
// with `opacity: shown ? 1 : 0` and an opacity transition of `fadeMs`.
//
// Returns [{ id, key, value, shown, gone, born }], oldest first (`gone`: fading out, about to go); `born` is document.timeline time at
// creation, for keeping looping animations in phase across layers.
const timelineNow = () => (typeof document !== 'undefined' && document.timeline ? document.timeline.currentTime ?? 0 : 0);

export default function useCrossfadeStack(value, keyOf, { fadeMs = 1000, max = 3 } = {}) {
  const key = value == null ? null : keyOf(value);
  const nextId = useRef(1);
  const [layers, setLayers] = useState(() => (value == null ? [] : [{ id: 0, key, value, shown: true, gone: false, born: timelineNow() }]));

  useLayoutEffect(() => {
    setLayers((prev) => {
      const last = prev[prev.length - 1];
      if (last && !last.gone && last.key === key) return prev; // already the current layer
      if (!last && key === null) return prev;
      const faded = prev.map((l) => (l.gone ? l : { ...l, shown: false, gone: true }));
      if (key === null) return faded;
      return [...faded, { id: nextId.current++, key, value, shown: false, gone: false, born: timelineNow() }].slice(-max);
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `value` is identified by its key

  // Reveal the newest layer one frame after it mounted at opacity 0, so its transition runs.
  const newest = layers[layers.length - 1];
  const revealId = newest && !newest.shown && !newest.gone ? newest.id : null;
  useEffect(() => {
    if (revealId == null) return undefined;
    let raf2;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setLayers((ls) => ls.map((l) => (l.id === revealId && !l.gone ? { ...l, shown: true } : l))));
    });
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
  }, [revealId]);

  // Remove layers that have finished fading out.
  const goneIds = layers.filter((l) => l.gone).map((l) => l.id).join(',');
  useEffect(() => {
    if (!goneIds) return undefined;
    const ids = new Set(goneIds.split(',').map(Number));
    const t = setTimeout(() => setLayers((ls) => ls.filter((l) => !ids.has(l.id))), fadeMs + 60);
    return () => clearTimeout(t);
  }, [goneIds, fadeMs]);

  return layers;
}
