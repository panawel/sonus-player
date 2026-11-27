import { useLayoutEffect, useMemo, useRef } from 'react';
import { toVerses, spotFor, bandAt } from './lyricsSpotlight.js';

// Now Playing's lyrics, as a reading spotlight: big, bold, centred lines in verse blocks, the lines
// in the reading band bright and a touch larger, the ones around them half lit, the rest dim. The
// lyrics start at the top and so does the light; scrolling, it glides down to its place a little
// above the middle (and on to the last lines at the end: bandAt). The lyrics carry no timings (embedded
// text, or lrclib's plain lyrics), so the light follows the reader, not the song.
//
// Cheap on purpose: line positions are measured once (offsetTop, against this scroller) and again
// only on a resize or new lyrics; a scroll only compares numbers and flips a data attribute on the
// lines whose state changed. The look is CSS (`.lyrics-spot*` in index.css): opacity and transform
// only, Reduce Motion drops the transform. Used by the full-width sheet and, centred, at phone width.
export default function LyricsSpotlight({ text, rtl, narrow = false, scrollRef, scrollClassName = '', scrollStyle }) {
  const verses = useMemo(() => toVerses(text), [text]);
  const local = useRef(null);
  const setRef = (el) => { local.current = el; if (scrollRef) scrollRef.current = el; };

  useLayoutEffect(() => {
    const sc = local.current;
    if (!sc) return undefined;
    let lines = [], row = 30, raf = 0;
    const measure = () => {
      lines = [...sc.querySelectorAll('.lyrics-spot-line')].map((el) => ({ el, c: el.offsetTop + el.offsetHeight / 2, s: el.dataset.spot }));
      const first = lines[0]?.el;
      if (first) { const cs = getComputedStyle(first); row = (parseFloat(cs.lineHeight) || first.offsetHeight || 30) + (parseFloat(cs.marginBottom) || 0); }
    };
    const update = () => {
      raf = 0;
      if (!lines.length) return;
      const band = bandAt({ top: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight, height: sc.clientHeight, first: lines[0].c, last: lines[lines.length - 1].c });
      sc.dataset.band = band === null ? '' : String(Math.round(band));
      const mid = sc.scrollTop + (band ?? 0);
      for (const l of lines) {
        const s = band === null ? 'lit' : spotFor((l.c - mid) / row);
        if (s !== l.s) { l.el.dataset.spot = s; l.s = s; }
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    const ro = new ResizeObserver(() => { measure(); update(); });
    ro.observe(sc);
    measure(); update();
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => { ro.disconnect(); sc.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [verses]);

  return (
    <div className={`lyrics-spot${narrow ? ' lyrics-spot--narrow' : ''}`} dir={rtl ? 'rtl' : 'ltr'}>
      <div ref={setRef} className={`lyrics-spot-scroll ${scrollClassName}`} style={scrollStyle}>
        <div className="lyrics-spot-body">
          <div className="lyrics-spot-head">
            <div className="lyrics-spot-kicker">Lyrics</div>
          </div>
          {verses.map((v, i) => (
            <div className="lyrics-spot-verse" key={i}>
              {v.map((line, j) => <span className="lyrics-spot-line" data-spot="dim" key={j}>{line}</span>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
