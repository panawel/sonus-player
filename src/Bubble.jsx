import { useLayoutEffect, useRef, useState } from 'react';
import { BUBBLE, bubbleSpring, bubbleExitMs } from './bubbleMotion.js';

// A title-strip element that appears and disappears like a glass bubble (see
// bubbleMotion.js for the spring). Two shapes:
//   variant="slot"  (default) an item INSIDE a pill. The wrapper's width springs open and
//                   shut, so the neighbours glide aside, and the content materialises in it.
//   variant="float" a free-standing element (a whole pill, a round button): it scales,
//                   blurs and fades in place, from `origin`.
// The element stays in the document (inert, so unclickable) while it leaves, then
// unmounts. A change of mind mid-animation starts from the live scale/opacity/width, so
// nothing snaps. A first render that is already shown does not animate (no bubbling at
// app start), and so does an environment without the Web Animations API (jsdom).
// `instant` makes THIS change skip the animation (shown or removed at once): used for changes
// the user did not ask for, such as the lyrics button coming and going as the song changes,
// which must not run a layout-animating spring while Now Playing's lights are easing colour.

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function liveState(el) {
  const cs = getComputedStyle(el);
  const m = /matrix\(([^)]+)\)/.exec(cs.transform);
  const parts = m ? m[1].split(',').map(Number) : null;
  return {
    scale: parts ? Math.hypot(parts[0], parts[1]) : 1,
    tx: parts ? parts[4] : 0,
    opacity: Number.isFinite(parseFloat(cs.opacity)) ? parseFloat(cs.opacity) : 1,
    blur: parseFloat(/blur\(([\d.]+)px\)/.exec(cs.filter)?.[1] ?? '0') || 0,
  };
}

export default function Bubble({
  show, instant = false, variant = 'slot', width = 0, index = 0, origin = '50% 50%', slide = BUBBLE.slidePx,
  as: Tag = 'div', className = '', style, inert, children, ...rest
}) {
  const [mounted, setMounted] = useState(show);
  const slotRef = useRef(null);   // slot: the wrapper whose width animates; float: the element itself
  const bodyRef = useRef(null);   // slot: the content; float: unused (the element itself)
  const animsRef = useRef([]);
  const tokenRef = useRef(0);
  const prevMounted = useRef(show);
  const firstRun = useRef(true);

  if (show && !mounted) setMounted(true); // derived state: mount in the same render pass

  const cancelAll = () => { animsRef.current.forEach((a) => { try { a.cancel(); } catch { /* already gone */ } }); animsRef.current = []; };

  useLayoutEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    const justMounted = mounted && !prevMounted.current;
    prevMounted.current = mounted;
    if (!mounted) return undefined;

    const slot = slotRef.current;
    const body = variant === 'float' ? slot : bodyRef.current;
    if (!slot || !body || typeof body.animate !== 'function') {
      if (!show) setMounted(false);
      return undefined;
    }
    if (first && show) return undefined; // already shown at first paint: no entrance
    if (instant) { // shown or removed at once, and any animation still running is dropped
      cancelAll();
      tokenRef.current++;
      if (!show) setMounted(false);
      return undefined;
    }

    const token = ++tokenRef.current;
    const reduced = prefersReducedMotion();
    // Only an animation that is still playing makes this an interruption. Finished ones linger in the
    // list (fill: backwards leaves them there), and measuring then reads the slot AFTER React has
    // already committed its new inline width (0 when leaving): the exit then animated 0 -> 0 and the
    // pill snapped narrower in one cut.
    const running = animsRef.current.some((a) => a.playState === 'running' || a.playState === 'pending');
    const live = running ? liveState(body) : null;
    const liveWidth = running && variant === 'slot' ? slot.getBoundingClientRect().width : null;
    cancelAll();
    const play = (target, keyframes, opts) => { const a = target.animate(keyframes, opts); animsRef.current.push(a); return a; };

    if (show) {
      const spring = bubbleSpring();
      const dur = reduced ? 160 : spring.durationMs;
      const delay = reduced || !justMounted ? 0 : index * BUBBLE.staggerMs;
      const from = justMounted || !live ? { scale: BUBBLE.startScale, tx: variant === 'slot' ? slide : 0, opacity: 0, blur: BUBBLE.blurPx } : live;
      if (reduced) {
        play(body, [{ opacity: from.opacity }, { opacity: 1 }], { duration: dur, easing: 'ease-out', fill: 'backwards' });
      } else {
        play(body, [{ transform: `translateX(${from.tx}px) scale(${from.scale})` }, { transform: 'translateX(0) scale(1)' }], { duration: dur, delay, easing: spring.easing, fill: 'backwards' });
        play(body, [{ opacity: from.opacity, filter: `blur(${from.blur}px)` }, { opacity: 1, filter: 'blur(0px)' }], { duration: dur * 0.55, delay, easing: 'ease-out', fill: 'backwards' });
        const rimTarget = body.querySelector?.('button') ?? (Tag === 'button' ? body : null);
        if (justMounted && rimTarget) {
          play(rimTarget, [{ boxShadow: `inset 0 0 0 1.5px rgba(255,255,255,${BUBBLE.rimAlpha})` }, { boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0)' }], { duration: dur * 0.9, delay, easing: 'ease-out', fill: 'backwards' });
        }
        if (variant === 'slot') {
          play(slot, [{ width: `${justMounted || liveWidth == null ? 0 : liveWidth}px` }, { width: `${width}px` }], { duration: dur, delay, easing: spring.easing, fill: 'backwards' });
        }
      }
    } else {
      const dur = reduced ? 120 : bubbleExitMs();
      const from = live ?? { scale: 1, tx: 0, opacity: 1, blur: 0 };
      let last;
      if (reduced) {
        last = play(body, [{ opacity: from.opacity }, { opacity: 0 }], { duration: dur, easing: 'ease-out', fill: 'forwards' });
      } else {
        last = play(body, [{ transform: `translateX(${from.tx}px) scale(${from.scale})` }, { transform: `translateX(${variant === 'slot' ? slide * 0.7 : 0}px) scale(${BUBBLE.exitScale})` }], { duration: dur, easing: BUBBLE.exitEase, fill: 'forwards' });
        play(body, [{ opacity: from.opacity, filter: `blur(${from.blur}px)` }, { opacity: 0, filter: `blur(${BUBBLE.blurPx * 0.9}px)` }], { duration: dur * 0.8, easing: BUBBLE.exitEase, fill: 'forwards' });
        if (variant === 'slot') {
          last = play(slot, [{ width: `${liveWidth ?? width}px` }, { width: '0px' }], { duration: dur, easing: BUBBLE.widthExitEase, fill: 'forwards' });
        }
      }
      // Do NOT cancel the animations here: with fill 'forwards' they hold the element hidden until
      // React removes it. Cancelling first snaps it back to fully visible for the frame before the
      // unmount (a pop at the end of every exit); unmounting cancels them anyway.
      last.onfinish = () => { if (tokenRef.current === token) setMounted(false); };
    }
    return undefined;
  }, [show, mounted]); // eslint-disable-line react-hooks/exhaustive-deps -- width/index/slide only matter at the moment of the change

  useLayoutEffect(() => () => cancelAll(), []);

  if (!mounted) return null;
  const isInert = inert || !show ? true : undefined;
  const phase = show ? 'in' : 'out';

  if (variant === 'float') {
    return (
      <Tag ref={slotRef} className={className} data-bubble={phase} inert={isInert} style={{ ...style, transformOrigin: origin }} {...rest}>
        {children}
      </Tag>
    );
  }
  return (
    <span ref={slotRef} className={`bubble-slot ${className}`} data-bubble={phase} inert={isInert} style={{ ...style, width: show ? width : 0 }}>
      <span ref={bodyRef} className="bubble-body">{children}</span>
    </span>
  );
}
