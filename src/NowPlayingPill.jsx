import { Mic2, ListMusic, TreePalm } from 'lucide-react';
import Bubble from './Bubble.jsx';

// Now Playing's own pill at the top right of the title strip (only while the song is open, never in
// Chill): Lyrics · Chill.
//
// Lyrics has a lit glass thumb behind it while the lyrics are beside the song; tapping it again
// turns them off (the thumb shrinks away). Chill is a plain button, never lit. Lyrics comes and goes
// in its own spring slot (only while the song has lyrics), the divider with it. The toggle can hold
// a second either-or button (`library`, unused: the Library beside the song is the top bar's
// Library tab since the two tabs became toggles), the thumb springing between the two.
const TOOL = 28; // .nav-tool-btn
const HIDDEN = { visible: false };
const GAP = 2;   // .np-pill-toggle's gap
const DIVIDER = 7; // .nav-pill-divider: 1px + 3px margins

export default function NowPlayingPill({ show, lyrics, library = HIDDEN, onChill, chillTitle = 'Chill mode' }) {
  const on = lyrics.visible && lyrics.on ? 'lyrics' : library.visible && library.on ? 'library' : null;
  const x = on === 'library' && lyrics.visible ? TOOL + GAP : 0;
  const toggle = (key, o, Icon, label, extraClass) => (
    <Bubble show={o.visible} variant="slot" width={TOOL}>
      <button
        type="button"
        className={`clickable nav-tool-btn np-pill-btn${extraClass ? ` ${extraClass}` : ''}${on === key ? ' active' : ''}`}
        data-np-tool={key}
        title={on === key ? `Hide the ${label.toLowerCase()}` : `Show the ${label.toLowerCase()}`}
        aria-label={label}
        aria-pressed={on === key}
        onClick={o.onClick}
      >
        <Icon size={15} />
      </button>
    </Bubble>
  );
  return (
    <Bubble
      show={show}
      variant="float"
      origin="100% 50%"
      className="nav-right-pill np-pill"
      data-np-pill=""
      style={{ position: 'fixed', top: 5, right: 16, zIndex: 51, WebkitAppRegion: 'no-drag' }}
    >
      <div className="np-pill-toggle" data-np-toggle={on ?? 'none'}>
        <span
          className="np-pill-thumb"
          aria-hidden="true"
          style={{ transform: `translateX(${x}px) scale(${on ? 1 : 0.4})`, opacity: on ? 1 : 0 }}
        />
        {toggle('lyrics', lyrics, Mic2, 'Lyrics', 'nav-lyrics-btn')}
        {toggle('library', library, ListMusic, 'Library')}
      </div>
      <Bubble show={lyrics.visible || library.visible} variant="slot" width={DIVIDER}>
        <span className="nav-pill-divider" aria-hidden="true" />
      </Bubble>
      <button
        type="button"
        className="clickable nav-tool-btn np-pill-btn chill-enter-btn"
        data-np-tool="chill"
        title={chillTitle}
        aria-label="Chill mode"
        onClick={onChill}
      >
        <TreePalm size={15} />
      </button>
    </Bubble>
  );
}
