import cx from 'classnames';
import { quadMatrix3d } from './chillGeometry.js';
import { POSTERS, posterLocalSize, flashWeight } from './chillRoom.js';

// The song's artwork on the room's posters, prints and polaroids — only the cover image,
// no text. Each is a flat box in its own local space mapped onto the print's four corners
// in the photo by a homography (the same technique as the hammock's phone screen), so it
// has the wall's perspective. They differ (POSTERS[].look: the full cover, a black-and-
// white print, zoomed-in details) so it isn't one image pasted two dozen times.
//
// The softness is the PRINT'S: each carries `fit.blur`, the Gaussian sigma (photo px) measured from
// its own edge by scripts/fit-chill-room-posters.py, converted here to the box's local pixels
// (the filter runs before the homography). The colour is the ROOM'S: every print carries `light` (measured from the original photo
// by scripts/make-chill-room-mask.py) — a colour cast (--tl, --tr: the multiply colour at
// its left and right side, so it falls off across the print the way the light does) and a
// dimness (--dim: prints in shade are darker than ones by the lamp) — applied in
// index.css `.chill-poster`. With no artwork there is nothing to draw and the room keeps
// its own posters. `arts` is the scene's crossfading list, so a new track fades in on
// every print.
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const TRANSFORMS = POSTERS.map((p) => {
  const { w, h } = posterLocalSize(p.quad);
  const photoW = (dist(p.quad[0], p.quad[1]) + dist(p.quad[3], p.quad[2])) / 2;
  return { w, h, matrix: quadMatrix3d(w, h, p.quad), blur: Math.max(0.3, (p.fit.blur || 1.2) * (w / photoW)) };
});
const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(', ')})`;

export default function ChillPosters({ arts }) {
  if (!arts.some((a) => a.src)) return null;
  return (
    <>
      {POSTERS.map((p, i) => {
        const { w, h, matrix, blur } = TRANSFORMS[i];
        const style = { width: w, height: h, transform: matrix, '--blur': `${blur.toFixed(2)}px` };
        // how much of the lightning this print gets: more toward the window, like the photo
        style['--fw'] = flashWeight((p.quad[0][0] + p.quad[1][0]) / 2).toFixed(3);
        if (p.look === 'detail') { style['--zoom'] = p.zoom; style['--ox'] = `${p.at[0]}%`; style['--oy'] = `${p.at[1]}%`; }
        if (p.light) {
          style['--tl'] = rgb(p.light.left.map((v, k) => v * (p.light.tint[k] / 255)));
          style['--tr'] = rgb(p.light.right.map((v, k) => v * (p.light.tint[k] / 255)));
          style['--dim'] = p.light.dim;
        }
        return (
          <div key={p.id} className={cx('chill-poster', `chill-poster--${p.look}`)} data-chill-poster={p.id} style={style}>
            {arts.map((a, k) => a.src && (
              <img key={a.id} className={cx({ 'chill-art--fade': k > 0 })} src={a.src} alt="" draggable={false} />
            ))}
          </div>
        );
      })}
    </>
  );
}
