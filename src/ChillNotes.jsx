import { useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import { quadMatrix3d } from './chillGeometry.js';
import { NOTES, posterLocalSize, flashWeight } from './chillRoom.js';
import { pickNotes, seedUnit } from './chillNotes.js';
import { isRTL } from './audioUtils.js';

// The song's lyrics, handwritten on the two papers on the room's right-hand wall: the big white
// sheet (the song's title as its heading, a random verse under it, signed with the artist) and the
// small yellow sticky (a different verse). Each is a flat box in its own local space mapped onto the
// paper's four corners in the photo by a homography - the same technique as the posters, and it
// takes the SAME room: the paper is the colour the photo's own paper has in this light (`paper`,
// measured by scripts/make-chill-room-mask.py - the room is dim and warm, so it is a brown-grey, not
// white; the left/right values keep the light's fall-off across it), softened by the paper's own
// measured blur, with the photo's grain on top, and it flashes with the lightning. Opaque on purpose:
// it has to cover the photo's own (garbled) handwriting.
//
// Which verses is chillNotes.js (random, but the same for the same song). With no lyrics there is
// nothing to write and the papers keep the photo's own writing, as the posters keep theirs without
// artwork. A new song fades its verses in over the old ones.
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const TRANSFORMS = NOTES.map((n) => {
  const { w, h } = posterLocalSize(n.quad);
  const photoW = (dist(n.quad[0], n.quad[1]) + dist(n.quad[3], n.quad[2])) / 2;
  return { w, h, matrix: quadMatrix3d(w, h, n.quad), blur: Math.max(0.3, (n.fit.blur || 1.0) * (w / photoW)) };
});

function NoteBody({ kind, picked }) {
  const rtl = isRTL(picked.lines.join(' '));
  const lines = picked.lines.map((l, i) => <div key={i} className="chill-note-line" dir={rtl ? 'rtl' : 'ltr'}>{l}</div>);
  if (kind === 'yellow') return <div className="chill-note-page">{lines}</div>;
  return (
    <div className="chill-note-page">
      {picked.heading ? <div className="chill-note-head" dir="auto">{picked.heading}</div> : null}
      <div className="chill-note-body">{lines}</div>
      {picked.sign ? <div className="chill-note-sign" dir="auto">{picked.sign}</div> : null}
    </div>
  );
}

export default function ChillNotes({ lyrics, trackKey, title, artist }) {
  const picked = useMemo(
    () => pickNotes(lyrics, trackKey, { title, artist }),
    [lyrics, trackKey, title, artist],
  );
  // a stable identity for "these verses": a change of song (or of its lyrics) fades the new ones in
  const identity = picked ? `${trackKey}|${seedUnit(String(lyrics)).toFixed(6)}|${title}|${artist}` : '';
  const [layers, setLayers] = useState(() => (picked ? [{ id: 0, key: identity, picked }] : []));
  const idRef = useRef(0);
  useEffect(() => {
    setLayers((prev) => {
      if (!picked) return prev.length ? [] : prev;
      const last = prev[prev.length - 1];
      if (last && last.key === identity) return prev;
      idRef.current += 1;
      return last ? [last, { id: idRef.current, key: identity, picked }] : [{ id: idRef.current, key: identity, picked }];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `picked` is a function of `identity`
  }, [identity]);
  useEffect(() => {
    if (layers.length < 2) return undefined;
    const t = setTimeout(() => setLayers((prev) => prev.slice(-1)), 900);
    return () => clearTimeout(t);
  }, [layers]);

  if (!layers.length) return null;
  return (
    <>
      {NOTES.map((n, i) => {
        const { w, h, matrix, blur } = TRANSFORMS[i];
        const style = { width: w, height: h, transform: matrix, '--blur': `${blur.toFixed(2)}px` };
        style['--fw'] = flashWeight((n.quad[0][0] + n.quad[1][0]) / 2).toFixed(3);
        if (n.paper) {
          style['--pl'] = `rgb(${n.paper.left.join(', ')})`;
          style['--pr'] = `rgb(${n.paper.right.join(', ')})`;
        }
        return layers.map((layer, k) => (
          <div
            key={`${n.id}:${layer.id}`}
            className={cx('chill-poster', 'chill-note', `chill-note--${n.kind}`, { 'chill-art--fade': k > 0 })}
            data-chill-note={n.kind}
            style={style}
          >
            <NoteBody kind={n.kind} picked={layer.picked[n.kind]} />
          </div>
        ));
      })}
    </>
  );
}
