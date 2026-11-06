// The state machine behind switching between Chill scenes (ChillScene.jsx). Pure,
// so it is unit-tested without a DOM.
//
// The point: the scene you are looking at stays on screen, fully alive, while the
// one you asked for loads out of sight behind it; only when that one is READY
// (photo decoded, textures uploaded, first frame drawn) does it fade in over the
// old one, which is then removed. Nothing half-loaded is ever shown.
//
//   current : { sceneId, seq } | null   the visible, ready scene (null while the very
//                                       first scene is still loading: nothing to show yet)
//   target  : { sceneId, seq } | null   the scene being loaded (hidden), or fading in
//   fading  : true while `target` is crossfading in over `current`
//   queued  : a scene asked for DURING a fade; it starts loading once the fade ends
//             (never three scenes at once: each animated scene owns a WebGL context)
//
// `seq` makes every request a distinct layer, so asking for the same scene again
// later gets a fresh mount, and a late "ready" from an abandoned load is ignored.

export const CHILL_FADE_MS = 800;
export const CHILL_FADE_REDUCED_MS = 150;     // prefers-reduced-motion: still a fade, just brief
export const CHILL_LOAD_TIMEOUT_MS = 8000;    // a scene that never reports ready is shown anyway

export const initialTransition = (sceneId) => ({ current: null, target: { sceneId, seq: 1 }, fading: false, queued: null, seq: 1 });

export function transitionReducer(state, action) {
  switch (action.type) {
    case 'request': {
      const want = action.sceneId;
      if (state.fading) {
        // Wait for the fade to finish; asking for what is already fading in is a no-op.
        if (want === state.target.sceneId) return state.queued === null ? state : { ...state, queued: null };
        return state.queued === want ? state : { ...state, queued: want };
      }
      if (state.target && want === state.target.sceneId) return state;            // already on its way
      if (state.current && want === state.current.sceneId) {
        // Back to what is on screen: drop the load in progress.
        return state.target ? { ...state, target: null, queued: null, seq: state.seq + 1 } : state;
      }
      const seq = state.seq + 1;
      return { ...state, target: { sceneId: want, seq }, queued: null, seq };
    }
    case 'ready': {
      // Only the layer currently being loaded can become ready.
      if (state.fading || !state.target || state.target.seq !== action.seq || state.target.sceneId !== action.sceneId) return state;
      // The first scene has nothing to fade over: it just takes its place (the whole
      // Chill layer fades in instead).
      if (!state.current) return { ...state, current: state.target, target: null };
      return { ...state, fading: true };
    }
    case 'faded': {
      if (!state.fading) return state;
      const next = { ...state, current: state.target, target: null, fading: false };
      if (state.queued && state.queued !== state.target.sceneId) {
        const seq = state.seq + 1;
        return { ...next, target: { sceneId: state.queued, seq }, queued: null, seq };
      }
      return { ...next, queued: null };
    }
    default:
      return state;
  }
}

// True while a scene the user asked for is still being prepared: what the scene
// button's spinner shows.
export const isTransitionLoading = (state) => !!state.target && !state.fading;
