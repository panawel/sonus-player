import { useCallback, useRef } from 'react';
import ChillLivingPhoto from './ChillLivingPhoto.jsx';
import ChillPosters from './ChillPosters.jsx';
import ChillLaptopScreen from './ChillLaptopScreen.jsx';
import { ROOM_W, ROOM_H } from './chillRoom.js';

// The study-room scene's layers (inside ChillScene's stage = the photo's pixel box): the
// photo, alive (ChillLivingPhoto: rain on the glass and falling outside, her typing and
// stopping, her breathing, the twinkling lights), then the artwork on some of the posters
// and the live document on the laptop's screen. Those are DOM, outside the shader, which
// is fine: the posters and the laptop don't move; only the laptop's CONTENT does, and it
// follows what the typing clock says through `onFrame`, which also carries the lightning
// flash they must share with the shader.
export default function ChillRoom({ scene, framing, dpr, arts, isPlaying, lyrics }) {
  const laptopApi = useRef(null);
  const overlaysRef = useRef(null);
  const lastFlash = useRef('0.00');
  const onFrame = useCallback((values) => {
    laptopApi.current?.update(values);
    // Lightning lights the posters and the laptop too: one CSS variable that they all read
    // (written only when it changes, straight to the element — not through React state).
    const f = (values && values.flash ? values.flash : 0).toFixed(2);
    if (f !== lastFlash.current && overlaysRef.current) {
      lastFlash.current = f;
      overlaysRef.current.style.setProperty('--flash', f);
      overlaysRef.current.dataset.flash = f;
    }
  }, []);
  return (
    <>
      <ChillLivingPhoto
        photoUrl={scene.photo} fx={scene.fx} liveState={{ isPlaying, lyrics }}
        sceneW={ROOM_W} sceneH={ROOM_H} scale={framing.k * dpr} onFrame={onFrame}
      />
      <div className="chill-room-overlays" ref={overlaysRef} data-chill-room-overlays data-flash="0.00">
        <ChillPosters arts={arts} />
        {arts.some((a) => a.src) && <img className="chill-glare" src={scene.glare} alt="" draggable={false} data-chill-glare />}
        <ChillLaptopScreen apiRef={laptopApi} />
      </div>
    </>
  );
}
