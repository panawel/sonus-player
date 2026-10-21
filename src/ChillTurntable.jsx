import { useEffect, useRef } from 'react';
import cx from 'classnames';
import {
  DISC_PX, SPIN_MS,
  ARM_POLYGON, PIN_POLYGON, ARM_SHADOW_POLYGON, PIN_SHADOW,
  polygonClipPath, discMatrix3d,
} from './chillScene.js';

const DISC_TRANSFORM = discMatrix3d();
const ARM_CLIP = polygonClipPath(ARM_POLYGON);
const PIN_CLIP = polygonClipPath(PIN_POLYGON);
const ARM_SHADOW_CLIP = polygonClipPath(ARM_SHADOW_POLYGON);
const PIN_SHADOW_CLIP = `ellipse(${PIN_SHADOW.rx}px ${PIN_SHADOW.ry}px at ${PIN_SHADOW.cx}px ${PIN_SHADOW.cy}px)`;

// The turntable scene's layers (rendered inside ChillScene's stage, which is the
// photo's own pixel box, scaled as a unit so the disc stays glued to the record):
//   photo → disc (artwork [spins] + fixed grooves/lighting) → contact shadows
//   → a copy of the photo clipped to the tonearm → another clipped to the pin.
// The last two are what keep the arm and pin IN FRONT of the artwork without any
// image editing. Only the artwork rotates; the lighting stays put, which is what
// makes it read as a real object.
//
// The spin is a Web Animations rotation, so at steady state it runs on the
// compositor (nothing on the main thread per frame); play/pause only ease its
// playbackRate for a second or two (see "the spin" below for the catch).
export default function ChillTurntable({ photoUrl, arts, isPlaying, labelRgb, onTogglePlay }) {
  const spinRef = useRef(null);
  const animRef = useRef(null);

  // ── the spin ───────────────────────────────────────────────────────────
  // A Web Animations rotation: at steady state it runs on the compositor.
  // Easing it up and down is the delicate part. Changing playbackRate EVERY
  // FRAME (the obvious rAF loop) keeps the animation permanently pending —
  // its currentTime does not advance until the changes stop, so the record
  // would sit still through the whole ramp and then jump to full speed.
  // Measured: updatePlaybackRate in coarse ~90ms steps tracks the expected
  // angle to within ~10ms over a 2s ramp, and looks smooth at 200°/s.
  const rateRef = useRef(0);
  useEffect(() => {
    const el = spinRef.current;
    if (!el?.animate) return undefined;
    const a = el.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: SPIN_MS, iterations: Infinity });
    a.pause();
    rateRef.current = 0;
    animRef.current = a;
    return () => { a.cancel(); animRef.current = null; };
  }, []);

  useEffect(() => {
    const a = animRef.current;
    if (!a) return undefined;
    const target = isPlaying ? 1 : 0;
    const tau = isPlaying ? 0.5 : 0.55; // spin-up / coast-down time constants (s)
    const TICK_MS = 90;
    let id = 0;
    const tick = () => {
      const next = rateRef.current + (target - rateRef.current) * (1 - Math.exp(-TICK_MS / 1000 / tau));
      const done = Math.abs(target - next) < 0.02;
      rateRef.current = done ? target : next;
      if (done && target === 0) { a.pause(); clearInterval(id); return; }
      a.updatePlaybackRate(rateRef.current);
      if (a.playState !== 'running') a.play();
      if (done) clearInterval(id);
    };
    tick();
    id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [isPlaying]);

  return (
    <>
      <img className="chill-photo" src={photoUrl} alt="" draggable={false} />

      <div className="chill-disc" style={{ width: DISC_PX, height: DISC_PX, transform: DISC_TRANSFORM }} onClick={onTogglePlay}>
        <div className="chill-spin" ref={spinRef}>
          {arts.map((a, i) => (
            a.src
              ? <img key={a.id} className={cx('chill-art', { 'chill-art--fade': i > 0 })} src={a.src} alt="" draggable={false} />
              : <div key={a.id} className={cx('chill-art', 'chill-blank', { 'chill-art--fade': i > 0 })} style={{ '--label': labelRgb }} />
          ))}
        </div>
        <div className="chill-warm" />
        <div className="chill-grooves" />
        <div className="chill-shade" />
        <div className="chill-gloss" />
        <div className="chill-lid" />
        <div className="chill-rim" />
      </div>

      <div className="chill-shadow" style={{ clipPath: ARM_SHADOW_CLIP }} />
      <div className="chill-shadow chill-shadow--pin" style={{ clipPath: PIN_SHADOW_CLIP }} />
      <div className="chill-cut" style={{ backgroundImage: `url(${photoUrl})`, clipPath: ARM_CLIP }} />
      <div className="chill-cut chill-cut--pin" style={{ backgroundImage: `url(${photoUrl})`, clipPath: PIN_CLIP }} />
    </>
  );
}
