import { useEffect, useRef, useState } from 'react';

// Entrance/exit timings — must match the CSS animation durations in
// index.css (player-pill-bubble-in / player-pill-bubble-out, shared by both
// PlayerPill and PlayerPillNarrow) so the phase state machine hands off at
// the same moment the animation actually finishes.
const ENTER_MS = 450;
const EXIT_MS = 300;

// Bubble appear/disappear phase state machine, shared by PlayerPill (desktop)
// and PlayerPillNarrow — extracted here once both needed the exact same
// logic, rather than duplicating it. A pill can't just conditionally render
// (`{shouldShow && <Pill/>}`) and expect to animate its own exit — an
// unmounted node can't run a CSS transition — so the caller stays mounted
// through both transitions, driven by this hook's `phase`
// ('hidden' | 'entering' | 'visible' | 'exiting') independent of whatever
// top-level condition App.jsx used to decide whether to render the
// component at all.
//
// `hadShownRef` (a ref, not state) is what stops the entrance animation from
// replaying on every ordinary track-to-track change while already visible:
// `currentTrack` gets a new object reference on every such change (skip,
// autoplay, picking another song), so gating on the object itself — rather
// than on "was the pill already visible?" — would replay the bubble-in on
// every song change during normal listening, not just on genuine
// appear/disappear. See docs/ARCHITECTURE.md's "Player pill" section for the
// bug this was originally found as.
export default function usePillPhase(shouldShow, currentTrack) {
  const [displayTrack, setDisplayTrack] = useState(currentTrack);
  const [phase, setPhase] = useState(shouldShow ? 'visible' : 'hidden');
  const hadShownRef = useRef(shouldShow);

  useEffect(() => {
    let timer;
    if (currentTrack) setDisplayTrack(currentTrack);
    if (shouldShow) {
      if (!hadShownRef.current) {
        hadShownRef.current = true;
        setPhase('entering');
        timer = setTimeout(() => setPhase('visible'), ENTER_MS);
      }
      // else: ordinary track-to-track change while already visible — just
      // swap displayTrack above, no animation.
    } else if (hadShownRef.current) {
      hadShownRef.current = false;
      setPhase('exiting');
      timer = setTimeout(() => setPhase('hidden'), EXIT_MS);
    }
    return () => clearTimeout(timer);
  }, [shouldShow, currentTrack]);

  return { phase, displayTrack };
}
