// The bundled Chill-mode scenes. A scene = a photo + the geometry measured from
// it + how it is framed; ChillScene.jsx renders whichever is chosen. Adding one
// means a new photo, a new measurements module like chillBeach.js, and a layers
// component (ChillTurntable.jsx / ChillBeach.jsx).
import turntablePhoto from './assets/chill/turntable.jpg';
import turntableThumb from './assets/chill/turntable-thumb.jpg';
import beachPhoto from './assets/chill/beach.jpg';
import beachThumb from './assets/chill/beach-thumb.jpg';
import beachMask from './assets/chill/beach-mask.png';
import beachBody from './assets/chill/beach-body.png';
import { TURNTABLE_FRAMING } from './chillScene.js';
import roomPhoto from './assets/chill/room.jpg';
import roomThumb from './assets/chill/room-thumb.jpg';
import roomMask from './assets/chill/room-mask.png';
import roomGlare from './assets/chill/room-glare.png';
import { BEACH_FRAMING } from './chillBeach.js';
import { ROOM_FRAMING } from './chillRoom.js';
import { createRoomFx } from './chillRoomFx.js';
import { createBeachFx } from './chillBeachFx.js';

export const CHILL_SCENES = [
  { id: 'turntable', label: 'Turntable', kind: 'turntable', photo: turntablePhoto, thumb: turntableThumb, framing: TURNTABLE_FRAMING },
  { id: 'beach', label: 'Hammock', kind: 'beach', photo: beachPhoto, thumb: beachThumb, fx: createBeachFx({ mask: beachMask, body: beachBody }), framing: BEACH_FRAMING },
  { id: 'room', label: 'Study room', kind: 'room', photo: roomPhoto, thumb: roomThumb, fx: createRoomFx({ mask: roomMask }), glare: roomGlare, framing: ROOM_FRAMING },
];

export const DEFAULT_CHILL_SCENE = 'turntable';
export const CHILL_SCENE_STORAGE_KEY = 'sonus.chillScene';

export const getChillScene = (id) => CHILL_SCENES.find((s) => s.id === id) || CHILL_SCENES[0];

// The remembered choice. localStorage can throw or be empty (private windows,
// cleared data), so every access is guarded and falls back to the default.
export function loadChillSceneId() {
  try {
    const id = window.localStorage.getItem(CHILL_SCENE_STORAGE_KEY);
    return CHILL_SCENES.some((s) => s.id === id) ? id : DEFAULT_CHILL_SCENE;
  } catch { return DEFAULT_CHILL_SCENE; }
}
export function saveChillSceneId(id) {
  try { window.localStorage.setItem(CHILL_SCENE_STORAGE_KEY, id); } catch { /* not persisted */ }
}
