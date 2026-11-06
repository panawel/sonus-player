import { useEffect, useRef, useState } from 'react';

// How long Chill mode's chrome (the bottom bar, the title strip's tabs/search/
// add/exit buttons, and the traffic lights) stays up with nothing happening.
export const CHILL_IDLE_MS = 3500;
// The traffic lights can't fade — macOS draws them — so they vanish when the
// 0.6s opacity fade of everything else has finished (index.css .chill-chrome-fade).
export const CHILL_LIGHTS_DELAY_MS = 600;
// A pause only counts once it has lasted this long. When a track ends, the <audio>
// reports "paused" for a moment before the next one starts playing; treating that
// gap as a real pause showed the chrome (and re-armed the quiet clock) at every song
// change with nobody touching anything. A gap between songs is well under this (the
// next track normally starts within a few hundred ms); a deliberate pause is not.
export const CHILL_PAUSE_GRACE_MS = 1500;

// One idle clock for ALL of Chill mode's chrome, so it appears and disappears
// as a unit. Returns { visible }.
//
//   visible = !active || awake || !playing || hold
//
// Hidden only while playing, quiet, and nothing is holding it up (`hold`: the
// search panel, a menu or a dialog is open). Paused always shows it - once the pause
// has lasted CHILL_PAUSE_GRACE_MS, so the brief "paused" between one song ending and
// the next starting (and the playback change back) is not mistaken for one: it
// neither shows the chrome nor restarts the quiet clock.
//
// What wakes it: any mouse movement / press / key / wheel in the page, AND
// cursor movement reported by the main process — the title strip is a window-drag
// area, so the page never sees the pointer over it (see electron/pointerMotion.mjs).
// Resting the pointer on a chrome element (data-chill-chrome) keeps it up. Whether
// it IS resting there is asked of the browser (`:hover`) at the moment the idle timer
// fires — never remembered from an earlier mouse move: a remembered flag went stale
// whenever the pointer left without an event to say so (the window resized away
// from a parked cursor, the user tabbed away) and then held the chrome up forever.
//
// Also drives the traffic lights through main: shown at once whenever the chrome
// is visible, hidden CHILL_LIGHTS_DELAY_MS after it fades. main.js puts them back
// whenever tracking stops, so leaving Chill mode any way at all restores them.
export default function useChillChrome({ active, playing, hold }) {
  const [awake, setAwake] = useState(true);
  const awakeRef = useRef(true);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const timerRef = useRef(null);
  const wakeRef = useRef(() => {});

  wakeRef.current = () => {
    if (!awakeRef.current) { awakeRef.current = true; setAwake(true); }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(function hide() {
      const restingOnChrome = !!document.querySelector('[data-chill-chrome]:hover');
      if (restingOnChrome || holdRef.current) { timerRef.current = setTimeout(hide, CHILL_IDLE_MS); return; }
      awakeRef.current = false;
      setAwake(false);
    }, CHILL_IDLE_MS);
  };

  useEffect(() => {
    if (!active) return undefined;
    const wake = () => wakeRef.current();
    window.addEventListener('mousemove', wake);
    window.addEventListener('mousedown', wake);
    window.addEventListener('keydown', wake);
    window.addEventListener('wheel', wake, { passive: true });
    const unsubscribe = window.electronAPI?.onPointerMoved?.(wake);
    window.electronAPI?.setChillChromeTracking?.(true);
    awakeRef.current = true;
    setAwake(true);
    wake();
    return () => {
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('mousedown', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('wheel', wake);
      unsubscribe?.();
      clearTimeout(timerRef.current);
      window.electronAPI?.setChillChromeTracking?.(false);
    };
  }, [active]);

  // `playing`, minus the gap between two songs: false only once it has stayed false
  // for the grace period, true again the moment playback is.
  const [settledPlaying, setSettledPlaying] = useState(playing);
  useEffect(() => {
    if (playing) { setSettledPlaying(true); return undefined; }
    const t = setTimeout(() => setSettledPlaying(false), CHILL_PAUSE_GRACE_MS);
    return () => clearTimeout(t);
  }, [playing]);

  // Restart the quiet clock when playback resumes (after a real pause) or a hold is released.
  useEffect(() => { if (active) wakeRef.current(); }, [active, settledPlaying, hold]);

  const visible = !active || awake || !settledPlaying || hold;

  useEffect(() => {
    if (!active) return undefined;
    if (visible) { window.electronAPI?.setWindowButtonsVisible?.(true); return undefined; }
    const t = setTimeout(() => window.electronAPI?.setWindowButtonsVisible?.(false), CHILL_LIGHTS_DELAY_MS);
    return () => clearTimeout(t);
  }, [active, visible]);

  return { visible };
}
