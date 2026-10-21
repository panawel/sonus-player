import { useEffect, useMemo, useState } from 'react';
import cx from 'classnames';
import { SkipBack, SkipForward, Play, Pause, Wifi, BatteryFull, Signal, Airplay, ListMusic, MessageSquareQuote, Volume1, Volume2 } from 'lucide-react';
import { quadMatrix3d } from './chillGeometry.js';
import { PHONE_SCREEN_QUAD, PHONE_LOCAL_W, PHONE_LOCAL_H, PHONE_CORNER_RADIUS, PHONE_NOTCH } from './chillBeach.js';

const PHONE_TRANSFORM = quadMatrix3d(PHONE_LOCAL_W, PHONE_LOCAL_H, PHONE_SCREEN_QUAD);

// A 12-hour clock like the phone's status bar ("9:41"), kept current.
const clockText = (d) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;

// The hammock scene's phone screen, redrawn live over the photo's own (whose text
// is garbled and whose pause icon never changes): the artwork, the real title and
// artist, a progress bar and times that move, and a play/pause icon that follows
// the real playback state. It is laid out in a 270x600 local space (2x the
// screen's size in the photo) and mapped onto the screen's quadrilateral by a
// homography, so it has the photo's perspective. Pointer-events are off: it is a
// picture of a phone, not a control.
export default function ChillPhoneScreen({ arts, artworkRgb, title, artist, shown, duration, isPlaying, formatTime }) {
  const [clock, setClock] = useState(() => clockText(new Date()));
  useEffect(() => {
    const id = setInterval(() => setClock(clockText(new Date())), 15000);
    return () => clearInterval(id);
  }, []);

  const pct = duration ? Math.min(100, (shown / duration) * 100) : 0;
  const remaining = Math.max(0, duration - shown);
  const base = useMemo(() => (artworkRgb
    ? `linear-gradient(165deg, rgb(${artworkRgb.r}, ${artworkRgb.g}, ${artworkRgb.b}), rgb(${artworkRgb.r >> 2}, ${artworkRgb.g >> 2}, ${artworkRgb.b >> 2}))`
    : 'linear-gradient(165deg, #6b5a8e, #1d1730)'), [artworkRgb]);

  return (
    <div
      className="chill-phone"
      style={{ width: PHONE_LOCAL_W, height: PHONE_LOCAL_H, borderRadius: PHONE_CORNER_RADIUS, transform: PHONE_TRANSFORM }}
      data-chill-phone
    >
      <div className="chill-phone-bg" style={{ background: base }}>
        {arts.map((a, i) => a.src && <img key={a.id} className={cx({ 'chill-art--fade': i > 0 })} src={a.src} alt="" draggable={false} />)}
      </div>
      <div className="chill-phone-notch" style={{ width: PHONE_NOTCH.w, height: PHONE_NOTCH.h, left: (PHONE_LOCAL_W - PHONE_NOTCH.w) / 2 }} />
      <div className="chill-phone-status">
        <span>{clock}</span>
        <span className="chill-phone-status-icons"><Signal size={13} strokeWidth={2.4} /><Wifi size={13} strokeWidth={2.4} /><BatteryFull size={16} strokeWidth={2} /></span>
      </div>

      <div className="chill-phone-art">
        {arts.map((a, i) => (a.src
          ? <img key={a.id} className={cx({ 'chill-art--fade': i > 0 })} src={a.src} alt="" draggable={false} />
          : <div key={a.id} className="chill-phone-art-blank" />))}
      </div>

      <div className="chill-phone-title" dir="auto">{title}</div>
      <div className="chill-phone-artist" dir="auto">{artist}</div>

      <div className="chill-phone-progress"><div style={{ width: `${pct}%` }} /></div>
      <div className="chill-phone-times"><span>{formatTime(shown)}</span><span>-{formatTime(remaining)}</span></div>

      <div className="chill-phone-controls">
        <SkipBack size={28} fill="currentColor" strokeWidth={0} />
        {isPlaying
          ? <Pause size={38} fill="currentColor" strokeWidth={0} data-chill-phone-state="playing" />
          : <Play size={38} fill="currentColor" strokeWidth={0} data-chill-phone-state="paused" />}
        <SkipForward size={28} fill="currentColor" strokeWidth={0} />
      </div>

      <div className="chill-phone-volume">
        <Volume1 size={14} /><div><div style={{ width: '45%' }} /></div><Volume2 size={14} />
      </div>
      <div className="chill-phone-bottom"><MessageSquareQuote size={18} /><Airplay size={18} /><ListMusic size={18} /></div>
      <div className="chill-phone-home" />
      <div className="chill-phone-glare" />
    </div>
  );
}
