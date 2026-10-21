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
// The circles' colour eases between tracks (a 1s background transition, same
// as the pill's own halo) rather than snapping when the cover changes.
export default function AmbientFlares({ artworkRgb, isPlaying, blur = '100px' }) {
  if (!artworkRgb) return null;
  const { r, g, b } = artworkRgb;
  const playState = isPlaying ? 'running' : 'paused';
  const circle = (extra, alpha, animation) => ({
    position: 'absolute', aspectRatio: '1/1', borderRadius: '50%',
    background: `rgba(${r}, ${g}, ${b}, ${alpha})`,
    transition: 'background 1s ease',
    animation, animationPlayState: playState,
    ...extra,
  });
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
      {/* Blur furnace: extends 15% past the edges so the blur's own soft edge stays hidden */}
      <div style={{ position: 'absolute', top: '-15%', left: '-15%', right: '-15%', bottom: '-15%', filter: `blur(${blur})` }}>
        <div className="ambient-flare" style={circle({ width: '60%', top: '5%', left: '5%' }, 0.9, 'np-flare-1 8s ease-in-out infinite')} />
        <div className="ambient-flare" style={circle({ width: '50%', bottom: '5%', right: '5%' }, 0.8, 'np-flare-2 13s ease-in-out infinite')} />
        <div className="ambient-flare" style={circle({ width: '40%', top: '25%', right: '10%' }, 0.7, 'np-flare-3 18s ease-in-out infinite')} />
      </div>
    </div>
  );
}
