import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Now Playing's cover. A song change CROSSFADES from the old cover to the new one (the old stays
// until the new has faded in), and App.jsx only hands over a new song's cover once its sharp
// version is decoded, so a skip goes straight from one sharp cover to the next. When the sharp
// cover was slow and the thumbnail stood in, the SAME song's sharp cover then fades in over the
// thumbnail (UPGRADE_MS) instead of swapping in one cut.
export const ART_FADE_MS = 350;
export const UPGRADE_MS = 250;

export default function ArtCrossfade({ trackKey, src, sharp = true, style }) {
  // Each layer: { key, src, under } — `under` is the stand-in being faded over, if any.
  const [layers, setLayers] = useState(() => [{ key: trackKey, src, sharp, under: null, rev: 0 }]);
  const rev = useRef(1);

  useLayoutEffect(() => {
    setLayers((prev) => {
      const last = prev[prev.length - 1];
      if (last.key === trackKey) {
        if (last.src === src) return prev.map((l, i) => (i === prev.length - 1 && l.sharp !== sharp ? { ...l, sharp } : l));
        return [...prev.slice(0, -1), { key: trackKey, src, sharp, under: last.src, rev: rev.current++ }];
      }
      return [...prev.slice(-1), { key: trackKey, src, sharp, under: null, rev: rev.current++ }]; // at most one outgoing cover
    });
  }, [trackKey, src, sharp]);

  // Drop the outgoing cover and any finished stand-in once their fades are done.
  const busy = layers.length > 1 || layers[layers.length - 1].under;
  useEffect(() => {
    if (!busy) return undefined;
    const t = setTimeout(() => setLayers((l) => [{ ...l[l.length - 1], under: null }]), Math.max(ART_FADE_MS, UPGRADE_MS) + 40);
    return () => clearTimeout(t);
  }, [layers, busy]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {layers.map((l, i) => {
        const outgoing = layers.length > 1 && i < layers.length - 1;
        const incoming = layers.length > 1 && i === layers.length - 1;
        const layerAnim = outgoing ? `np-art-out ${ART_FADE_MS}ms ease-out forwards` : incoming ? `np-art-in ${ART_FADE_MS}ms ease-out both` : undefined;
        return (
          <div key={l.key} data-art-layer={outgoing ? 'out' : incoming ? 'in' : 'current'} style={{ position: 'absolute', inset: 0, animation: layerAnim }}>
            {l.under && <img src={l.under} data-art-under data-sharp="false" style={{ ...style, position: 'absolute', inset: 0 }} />}
            <img
              key={l.rev}
              src={l.src}
              data-sharp={l.sharp ? 'true' : 'false'}
              style={{ ...style, position: 'absolute', inset: 0, animation: l.under ? `np-art-in ${UPGRADE_MS}ms ease-out both` : undefined }}
            />
          </div>
        );
      })}
    </div>
  );
}
