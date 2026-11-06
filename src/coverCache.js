// Now Playing's sharp covers, loaded AND decoded ahead of being shown.
//
// The library only carries a 300px thumbnail (sonus-thumb://), which looks soft at Now Playing's
// size. The real cover comes from the file (fs:readArtwork, a data URL); it is decoded here before
// anything shows it, so swapping it in never flashes, and a few are kept so that skipping back and
// forth, or to a prefetched next song, is instant. Pure apart from the injected loader/decoder.

export const COVER_CACHE_SIZE = 6;

export function createCoverCache({ load, decode, size = COVER_CACHE_SIZE }) {
  const ready = new Map();     // filePath -> url (decoded), in LRU order
  const inflight = new Map();  // filePath -> Promise<url|null>

  const remember = (key, url) => {
    ready.delete(key);
    ready.set(key, url);
    while (ready.size > size) ready.delete(ready.keys().next().value);
  };

  return {
    // The decoded cover if it is ready now (refreshes its place), else undefined.
    peek(key) {
      if (!ready.has(key)) return undefined;
      const url = ready.get(key);
      remember(key, url);
      return url;
    },
    // Resolves with the decoded cover (or null when the file has none). Concurrent calls share one load.
    get(key) {
      if (ready.has(key)) return Promise.resolve(this.peek(key));
      if (inflight.has(key)) return inflight.get(key);
      const p = (async () => {
        try {
          const url = await load(key);
          if (url) await decode(url);
          remember(key, url ?? null);
          return url ?? null;
        } catch {
          return null;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    },
    prefetch(keys) { for (const k of keys) if (k && !ready.has(k) && !inflight.has(k)) this.get(k); },
    clear() { ready.clear(); },
  };
}

// A cover is identified by its file AND its thumbnail URL, so a changed cover (Tag Editor) is re-read.
export const coverKey = (filePath, thumb) => `${filePath}\n${thumb ?? ''}`;
const pathOf = (key) => key.split('\n')[0];

// The app's instance: covers come from the main process, decoded by the browser.
const decodeImage = (url) => { const img = new Image(); img.src = url; return img.decode().catch(() => {}); };
export const coverCache = createCoverCache({
  load: (key) => (window.electronAPI?.readArtwork ? window.electronAPI.readArtwork(pathOf(key)) : Promise.resolve(null)),
  decode: decodeImage,
});
