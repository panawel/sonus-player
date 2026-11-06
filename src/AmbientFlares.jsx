import useCrossfadeStack from './useCrossfadeStack.js';

// The artwork-coloured, slowly drifting lights behind Now Playing — three solid
// circles inside a heavy blur, on 8/13/18 second loops (np-flare-1..3 in
// index.css), moving only while music plays and fading out when it doesn't.
// Shared so the mini player gets exactly the same lights instead of a copy
// that could drift out of step with this one.
//
// `blur` is the only knob: Now Playing's full-panel 100px is far too diffuse
// for the mini player's much smaller window, which passes a scaled value.
// Everything else (sizes, opacities, loop lengths) is deliberately identical.
//
// A new cover's colour CROSSFADES in (useCrossfadeStack): each colour is its own static set of
// circles, faded by opacity. It used to be a 1s `background` transition on the circles, which
// inside the 100px blur repainted the whole blurred layer every frame for a second on every song
// change (the patchwork flicker when skipping). The layers' loops are kept in phase (a negative
// animation-delay from the document timeline), so the lights never jump during a crossfade.
// Only the CURRENT layer's circles carry `.ambient-flare`.
export const FLARE_FADE_MS = 1000;
const FLARES = [
  { box: { width: '60%', top: '5%', left: '5%' }, alpha: 0.9, name: 'np-flare-1', period: 8000 },
  { box: { width: '50%', bottom: '5%', right: '5%' }, alpha: 0.8, name: 'np-flare-2', period: 13000 },
  { box: { width: '40%', top: '25%', right: '10%' }, alpha: 0.7, name: 'np-flare-3', period: 18000 },
];
const rgbKey = (c) => `${c.r},${c.g},${c.b}`;

export default function AmbientFlares({ artworkRgb, isPlaying, blur = '100px' }) {
  const layers = useCrossfadeStack(artworkRgb, rgbKey, { fadeMs: FLARE_FADE_MS });
  if (layers.length === 0) return null;
  const playState = isPlaying ? 'running' : 'paused';
  const current = layers[layers.length - 1];
  return (
    <div
      className="ambient-flares"
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        pointerEvents: 'none',
        opacity: isPlaying ? 1 : 0,
        transition: 'opacity 1.5s ease',
      }}
    >
      {layers.map((layer) => {
        const { r, g, b } = layer.value;
        const isCurrent = layer === current && !layer.gone;
        return (
          // Blur furnace: extends 15% past the edges so the blur's own soft edge stays hidden
          <div
            key={layer.id}
            data-flare-layer={isCurrent ? 'current' : 'out'}
            style={{
              position: 'absolute', top: '-15%', left: '-15%', right: '-15%', bottom: '-15%', filter: `blur(${blur})`,
              opacity: layer.shown ? 1 : 0, transition: `opacity ${FLARE_FADE_MS}ms ease`,
            }}
          >
            {FLARES.map((f) => (
              <div
                key={f.name}
                className={isCurrent ? 'ambient-flare' : 'ambient-flare-out'}
                style={{
                  position: 'absolute', aspectRatio: '1/1', borderRadius: '50%',
                  background: `rgba(${r}, ${g}, ${b}, ${f.alpha})`,
                  animation: `${f.name} ${f.period / 1000}s ease-in-out infinite`,
                  animationDelay: `${-(layer.born % f.period)}ms`,
                  animationPlayState: playState,
                  ...f.box,
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
