import { useCallback, useRef } from 'react';
import ChillLivingPhoto from './ChillLivingPhoto.jsx';
import ChillPhoneScreen from './ChillPhoneScreen.jsx';
import { BEACH_W, BEACH_H, PHONE_CENTER_X, PHONE_CENTER_Y, swayRampX, swayProfileY } from './chillBeach.js';

// The hammock scene's layers (inside ChillScene's stage = the photo's pixel box):
// the photo, gently alive (ChillLivingPhoto) — including the swing of the hammock
// and the man — and the phone's screen redrawn live on top of it (ChillPhoneScreen).
// The phone sits outside the animated masks, so it is never warped; instead it is
// translated by the same swing the shader applies to the man holding it (the
// photo's loop reports it every frame; the style is written straight to the
// element — re-rendering React 30 times a second for a transform would be waste).
export default function ChillBeach({ scene, framing, dpr, arts, artworkRgb, title, artist, shown, duration, isPlaying, formatTime }) {
  const swayRef = useRef(null);
  const onFrame = useCallback(({ dx, dy }) => {
    // the same two position weights the shader gives the hands holding the phone
    const px = dx * swayRampX(PHONE_CENTER_Y);
    const py = dy * swayProfileY(PHONE_CENTER_X);
    if (swayRef.current) swayRef.current.style.transform = `translate(${px.toFixed(3)}px, ${py.toFixed(3)}px)`;
  }, []);
  return (
    <>
      <ChillLivingPhoto
        photoUrl={scene.photo} fx={scene.fx}
        sceneW={BEACH_W} sceneH={BEACH_H} scale={framing.k * dpr} onFrame={onFrame}
      />
      <div className="chill-phone-sway" ref={swayRef}>
        <ChillPhoneScreen
          arts={arts} artworkRgb={artworkRgb} title={title} artist={artist}
          shown={shown} duration={duration} isPlaying={isPlaying} formatTime={formatTime}
        />
      </div>
    </>
  );
}
