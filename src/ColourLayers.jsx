import useCrossfadeStack from './useCrossfadeStack.js';

// A surface whose colour follows the cover by CROSSFADING fixed-colour layers (see
// useCrossfadeStack): the window's artwork tint, and the glow and coloured shadow behind Now
// Playing's cover. Each used to be a `background`/`box-shadow` transition, which repaints the
// (blurred, very large) surface every frame while it eases; an opacity crossfade repaints nothing.
// `layerStyle(rgb)` gives one layer's look; every layer is absolutely positioned by it.
const rgbKey = (c) => `${c.r},${c.g},${c.b}`;

export default function ColourLayers({ rgb, layerStyle, fadeMs = 1000, className }) {
  const layers = useCrossfadeStack(rgb, rgbKey, { fadeMs });
  return layers.map((l) => (
    <div
      key={l.id}
      aria-hidden="true"
      className={className}
      data-colour-layer={l.gone ? 'out' : 'current'}
      style={{ ...layerStyle(l.value), pointerEvents: 'none', opacity: l.shown ? 1 : 0, transition: `opacity ${fadeMs}ms ease` }}
    />
  ));
}
