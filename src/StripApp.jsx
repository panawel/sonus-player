import { useEffect, useState } from 'react';
import StripPlayer from './StripPlayer.jsx';
import { glowRgb } from './glowColor.js';

// The strip window's whole app (main.jsx mounts it for ?strip=1). macOS only lets a window with
// no title bar sit in the band beside the Dock, so the strip is its own small window
// (electron/main.js) while the main window is hidden. The music still plays in the main window:
// it reports what is playing ('strip:state', through main) and this window sends back what the
// user did ('strip:command').
const MARQUEE_FADE_PX = 16;
const marqueeFadeMask = `linear-gradient(to right, transparent, black ${MARQUEE_FADE_PX}px, black calc(100% - ${MARQUEE_FADE_PX}px), transparent)`;
const EMPTY = { track: null, isPlaying: false, currentTime: 0, duration: 0, artworkRgb: null, isShuffle: false, repeatMode: 'off' };

export default function StripApp() {
  const [state, setState] = useState(EMPTY);
  useEffect(() => {
    const api = window.electronAPI;
    const unsubscribe = api?.onStripState?.((s) => setState({ ...EMPTY, ...s }));
    api?.getStripState?.().then((s) => { if (s) setState((cur) => (cur === EMPTY ? { ...EMPTY, ...s } : cur)); }).catch(() => {});
    return unsubscribe;
  }, []);
  // the same artwork glow as the main window's players (glowColor.js)
  useEffect(() => { document.documentElement.style.setProperty('--art-rgb', glowRgb(state.artworkRgb)); }, [state.artworkRgb]);
  const send = (cmd, value) => window.electronAPI?.stripCommand?.(cmd, value);
  return (
    <StripPlayer
      currentTrack={state.track}
      isPlaying={state.isPlaying}
      currentTime={state.currentTime}
      duration={state.duration}
      artworkRgb={state.artworkRgb}
      isShuffle={state.isShuffle}
      repeatMode={state.repeatMode}
      marqueeFadeMask={marqueeFadeMask}
      onTogglePlay={() => send('play')}
      onPrev={() => send('prev')}
      onNext={() => send('next')}
      onToggleShuffle={() => send('shuffle')}
      onToggleRepeat={() => send('repeat')}
      onSeek={(t) => { setState((s) => ({ ...s, currentTime: t })); send('seek', t); }}
      onExpand={() => window.electronAPI?.exitStripMode?.()}
    />
  );
}
