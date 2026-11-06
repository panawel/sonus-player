// Getting a scene's pictures decoded BEFORE they are needed, so that switching to
// it is quick and its fade-in never waits on an image. Every call returns a promise
// that resolves (never rejects): a missing or broken image must not stop a scene
// from appearing: it just shows without that picture.
//
// Decoded images are kept by URL for the session. That is memory on purpose (a scene
// photo is ~2752x1536, ~17MB decoded) and the reason this is called on intent (the
// picker opening, a thumbnail being hovered) rather than for every scene up front.

const cache = new Map();

// Test-only slowness: with ?test=1 (the smoke suite is the only thing that passes it) and
// window.__sonusChillLoadDelayMs set, every image takes at least that long to be reported
// ready. A scene's loading window is otherwise a few dozen milliseconds on a fast Mac, too
// short for a test to observe "nothing is shown before it is ready" rather than hope for it.
const testDelayMs = () => {
  try { return new URLSearchParams(window.location.search).has('test') ? Number(window.__sonusChillLoadDelayMs) || 0 : 0; } catch { return 0; }
};

export function decodeImage(url) {
  const delay = testDelayMs();
  const ready = decodeImageNow(url);
  return delay ? ready.then((img) => new Promise((resolve) => setTimeout(() => resolve(img), delay))) : ready;
}

function decodeImageNow(url) {
  if (!url) return Promise.resolve(null);
  if (!cache.has(url)) {
    cache.set(url, new Promise((resolve) => {
      const img = new Image();
      const done = () => resolve(img);
      img.onload = done;
      img.onerror = done;
      img.src = url;
      // decode() resolves once the bitmap is ready to paint, so the first paint doesn't
      // stall on it; where it is missing, onload is the best there is.
      if (typeof img.decode === 'function') img.decode().then(done, done);
    }));
  }
  return cache.get(url);
}

// Every image a scene draws: the photo, its effect masks, the glare overlay.
export function sceneImageUrls(scene) {
  return [scene.photo, scene.glare, ...(scene.fx?.masks || []).map((m) => m.url)].filter(Boolean);
}

export function preloadChillScene(scene) {
  return Promise.all(sceneImageUrls(scene).map(decodeImage));
}

// For tests.
export const _clearPreloadCache = () => cache.clear();
