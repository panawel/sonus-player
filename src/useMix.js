import { useState, useEffect, useRef, useCallback } from 'react';
import { splitArtists } from './audioUtils.js';
import {
  pickBestRecording, pickBestArtist, matchSongsToLibrary, matchArtistsToLibrary,
  mergeArtistNames, buildMix,
} from './mixMatch.js';

// All three services are free and keyless — see docs/ARCHITECTURE.md's "Mix"
// section for why (MusicBrainz + ListenBrainz Labs + Deezer, verified live
// against real data before committing to this design). MusicBrainz's own API
// etiquette asks for an identifying User-Agent on unauthenticated requests.
const MB_USER_AGENT = 'Sonus/1.0 (+https://github.com/panawel/sonus-player)';
// Fixed algorithm identifiers ListenBrainz Labs requires — not configurable,
// just the specific dataset/model version being queried. See useMix.test.js
// (or the ARCHITECTURE.md note) for how these were found: the endpoint
// rejects any other value and lists the valid set in its 400 response.
const LB_RECORDINGS_ALGORITHM = 'session_based_days_7500_session_300_contribution_5_threshold_15_limit_50_skip_30';
const LB_ARTISTS_ALGORITHM = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';

// fetch() with a timeout — prevents indefinite hangs when offline. Same
// pattern TagEditorWindow.jsx already uses for Search Online.
function fetchWithTimeout(url, options = {}, ms = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function fetchJson(url, options) {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// In-memory only, cleared on relaunch — deliberately not persisted, since
// nothing about a Mix is ever "saved" (see the design discussion in
// ARCHITECTURE.md). This purely avoids re-hitting three free APIs every time
// the same song's mix is reopened within one sitting.
const mixCache = new Map();

async function resolveAndFetch(seedTrack) {
  const artist = splitArtists(seedTrack.artist)[0] || seedTrack.artist || '';
  const title = seedTrack.title || '';
  if (!artist) throw new Error('no-artist');

  const mbHeaders = { 'User-Agent': MB_USER_AGENT };
  let recordingMbid = null;
  let artistMbid = null;

  // MusicBrainz's public API is shared/free and occasionally answers a
  // perfectly normal request with 503 "the web server is currently busy" —
  // documented, transient, self-recovering behavior on their end, not
  // something a retry-once can't ride out. One retry after a short delay.
  const fetchMbJson = async (url) => {
    try {
      return await fetchJson(url, { headers: mbHeaders });
    } catch (err) {
      if (!String(err.message).startsWith('503')) throw err;
      await new Promise(r => setTimeout(r, 800));
      return fetchJson(url, { headers: mbHeaders });
    }
  };

  // One MusicBrainz recording search usually resolves both IDs at once — the
  // matched recording's own artist-credit already carries the artist's MBID,
  // so a separate artist search is only needed when this comes up empty
  // (e.g. a mistagged or very obscure track). Both wrapped individually —
  // MusicBrainz being unavailable must not sink Deezer's own, independent
  // similar-artists lookup below, which needs neither of these IDs.
  if (title) {
    try {
      const recQuery = `recording:${encodeURIComponent(title)} AND artist:${encodeURIComponent(artist)}`;
      const recData = await fetchMbJson(`https://musicbrainz.org/ws/2/recording/?query=${recQuery}&fmt=json&limit=10`);
      const best = pickBestRecording(recData?.recordings);
      if (best) {
        recordingMbid = best.id;
        artistMbid = best['artist-credit']?.[0]?.artist?.id ?? null;
      }
    } catch { /* ignore — falls through to the artist-only search below */ }
  }
  if (!artistMbid) {
    try {
      const artData = await fetchMbJson(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(`artist:${artist}`)}&fmt=json&limit=5`);
      artistMbid = pickBestArtist(artData?.artists)?.id ?? null;
    } catch { /* ignore — Deezer's independent lookup below can still carry the mix */ }
  }

  // Deezer needs its own artist-name search for its own internal artist id —
  // a bonus/second source, so a failure here shouldn't sink the whole mix.
  let deezerArtistId = null;
  try {
    const dzData = await fetchJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(artist)}&limit=1`);
    deezerArtistId = dzData?.data?.[0]?.id ?? null;
  } catch { /* ignore — ListenBrainz alone is still a complete mix */ }

  const [songResults, lbArtistResults, dzArtistResults] = await Promise.all([
    recordingMbid
      ? fetchJson(`https://labs.api.listenbrainz.org/similar-recordings/json?recording_mbids=${recordingMbid}&algorithm=${LB_RECORDINGS_ALGORITHM}`).catch(() => [])
      : Promise.resolve([]),
    artistMbid
      ? fetchJson(`https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=${artistMbid}&algorithm=${LB_ARTISTS_ALGORITHM}`).catch(() => [])
      : Promise.resolve([]),
    deezerArtistId
      ? fetchJson(`https://api.deezer.com/artist/${deezerArtistId}/related`).then(d => d?.data ?? []).catch(() => [])
      : Promise.resolve([]),
  ]);

  return { songResults, lbArtistResults, dzArtistResults };
}

// Drives a `homeDetailItem` of type 'mix' (item.key = seed track's filePath).
// Returns { status: 'idle'|'loading'|'ready'|'empty'|'error', tracks, retry }.
// A no-op (status stays 'idle') for any other item type, so HomeDetailView
// can call this unconditionally alongside its existing synchronous types.
export function useMix(item, library) {
  const [state, setState] = useState({ status: 'idle', tracks: [] });
  const requestIdRef = useRef(0);

  const run = useCallback(() => {
    if (!item || item.type !== 'mix') { setState({ status: 'idle', tracks: [] }); return; }
    const seedTrack = library.find(t => t.filePath === item.key);
    if (!seedTrack) { setState({ status: 'error', tracks: [] }); return; }

    const cacheKey = `${(seedTrack.artist || '').toLowerCase()}::${(seedTrack.title || '').toLowerCase()}`;
    const cached = mixCache.get(cacheKey);
    if (cached) { setState({ status: cached.length ? 'ready' : 'empty', tracks: cached }); return; }

    const requestId = ++requestIdRef.current;
    setState({ status: 'loading', tracks: [] });

    resolveAndFetch(seedTrack).then(({ songResults, lbArtistResults, dzArtistResults }) => {
      if (requestIdRef.current !== requestId) return; // a newer mix was requested meanwhile
      const songMatches = matchSongsToLibrary(songResults, library);
      const artistNames = mergeArtistNames(
        (lbArtistResults ?? []).map(a => a.name),
        (dzArtistResults ?? []).map(a => a.name),
      );
      const artistMatches = matchArtistsToLibrary(artistNames, library, { excludeArtist: seedTrack.artist });
      const tracks = buildMix({ seedTrack, songMatches, artistMatches });
      mixCache.set(cacheKey, tracks);
      setState({ status: tracks.length ? 'ready' : 'empty', tracks });
    }).catch(() => {
      if (requestIdRef.current !== requestId) return;
      setState({ status: 'error', tracks: [] });
    });
  }, [item, library]);

  useEffect(() => { run(); }, [run]);

  return { ...state, retry: run };
}

// Test-only escape hatch (mirrors window.__sonusTagEditorTest.openSearchResults)
// — lets the smoke suite seed the in-memory cache directly, so it can drive
// every Mix UI state without ever making a real network call.
export function __setMixCacheForTest(seedTrack, tracks) {
  const cacheKey = `${(seedTrack.artist || '').toLowerCase()}::${(seedTrack.title || '').toLowerCase()}`;
  mixCache.set(cacheKey, tracks);
}
