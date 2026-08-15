import React, { useState, useRef } from 'react';
import { Music, Search, Save, Check, AlertCircle, FolderOpen, X, LoaderCircle } from 'lucide-react';
import { isRTL } from './audioUtils.js';
import { dedupeSearchResults, SEARCH_FETCH_LIMIT } from './tagSearch.js';
import './index.css';

// fetch() with an AbortController timeout — prevents indefinite hangs when offline.
function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

// Standalone Tag Editor window (electron/main.js creates it as a singleton,
// separate BrowserWindow). Receives its track over IPC (tag-editor:load) —
// this renderer has no `library` state of its own. On save it only writes
// the file and reports local status; the main window's own onTagSaved
// listener (App.jsx) is what merges the change back into `library`/
// `currentTrack` and reloads <audio> if it's the currently-playing track.
export default function TagEditorWindow() {
  const [track, setTrack] = useState(null);
  const [editTags, setEditTags] = useState({ title: '', artist: '', album: '', albumArtist: '', year: '', genre: '', trackNumber: '', trackTotal: '', discNumber: '', discTotal: '', composer: '', comment: '', bpm: '', picture: null, lyrics: '' });
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saved' | 'error'
  const [isTagSearching, setIsTagSearching] = useState(false);
  const [tagSearchResults, setTagSearchResults] = useState(null);
  const [tagSearchError, setTagSearchError] = useState(null);
  const [pickingResult, setPickingResult] = useState(null); // index of card being loaded
  // Results are an overlay, not part of the form: they used to render inline at
  // the bottom of the scrolling panel, which pushed the form past the window's
  // fixed height and made you scroll to reach them. Opens as soon as the search
  // starts so the spinner, any error, and the results all appear in one place.
  const [searchOpen, setSearchOpen] = useState(false);
  // Artwork loads asynchronously (full-res comes from the file via
  // fs:readArtwork — the track object passed over IPC only carries a
  // thumbnail). Save is blocked while true: the WAV writer rebuilds the
  // whole tag chunk, so saving before the original art has loaded would
  // silently strip it.
  const [editArtLoading, setEditArtLoading] = useState(false);
  const [artworkSelected, setArtworkSelected] = useState(false);
  // `track` gets a new reference on every load event even for the same file
  // (it's a fresh object sent over IPC) — guard by filePath so re-renders
  // don't look like "switched to editing a different track".
  const loadedPathRef = useRef(null);
  const fileInputRef = useRef(null);
  const scrollableRef = useRef(null);
  // Set once per genuine track load (batched with the editTags update below),
  // never touched by Search Online/typing/artwork-loading — the window must
  // only auto-fit its height on a real track change, not on any of those.
  const [loadedTrackKey, setLoadedTrackKey] = useState(null);

  React.useEffect(() => {
    document.title = 'Edit Tags';
  }, []);

  // Fires once when the window opens, and again (with a possibly different
  // track) if "Edit Tags…" is invoked on another row while this window is
  // already open — main.js reuses one singleton window rather than opening more.
  React.useEffect(() => {
    const unsub = window.electronAPI?.onTagEditorLoad?.((t) => setTrack(t));
    return unsub;
  }, []);

  React.useEffect(() => {
    if (!window.electronAPI?.onSelectAll) return;
    const unsub = window.electronAPI.onSelectAll(() => {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.select();
    });
    return unsub;
  }, []);

  React.useEffect(() => {
    if (track && loadedPathRef.current !== track.filePath) {
      loadedPathRef.current = track.filePath;
      setEditTags({
        title:       track.title       || '',
        artist:      track.artist      || '',
        album:       track.album       || '',
        albumArtist: track.albumArtist || '',
        year:        track.year        || '',
        genre:       track.genre       || '',
        trackNumber: track.trackNumber || '',
        trackTotal:  track.trackTotal  || '',
        discNumber:  track.discNumber  || '',
        discTotal:   track.discTotal   || '',
        composer:    track.composer    || '',
        comment:     track.comment     || '',
        bpm:         track.bpm         || '',
        picture:     null,
        lyrics:      track.lyrics      || '',
      });
      setSaveStatus('idle');
      setTagSearchResults(null);
      setTagSearchError(null);
      setArtworkSelected(false);
      setLoadedTrackKey(track.filePath);
      // Full-res artwork loads async; the thumbnail stands in meanwhile.
      // Only fill the picture if the user hasn't already picked a new one
      // and we're still editing the same file by the time it resolves.
      if (track.thumb && window.electronAPI?.readArtwork) {
        setEditArtLoading(true);
        const fp = track.filePath;
        window.electronAPI.readArtwork(fp).then(url => {
          if (loadedPathRef.current !== fp) return;
          setEditTags(t => (url && !t.picture) ? { ...t, picture: url } : t);
          setEditArtLoading(false);
        });
      } else {
        setEditArtLoading(false);
      }
    }
  }, [track]);

  // Fires after the form above has actually re-rendered with the new track's
  // fields (loadedTrackKey is set in the same batch as setEditTags, so this
  // effect runs on the commit that follows). Auto-fits the window's height to
  // the form's natural content height on every genuine track load — but never
  // again afterward, so later state changes (Search Online results, typing,
  // the async artwork swap) can't trigger a resize.
  React.useLayoutEffect(() => {
    if (!loadedTrackKey || !scrollableRef.current) return;
    window.electronAPI?.resizeTagEditor?.(scrollableRef.current.scrollHeight);
  }, [loadedTrackKey]);

  // Closing is blocked mid-pick: handlePickResult is still fetching artwork and
  // lyrics, and dismissing the list under it would leave the fields changing
  // with nothing on screen to explain why. Matches the disabled "Use this" buttons.
  const closeSearch = React.useCallback(() => {
    if (pickingResult !== null) return;
    setSearchOpen(false);
    setTagSearchResults(null);
    setTagSearchError(null);
  }, [pickingResult]);

  React.useEffect(() => {
    if (!searchOpen) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') closeSearch(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen, closeSearch]);

  // Automated-test hook, mirroring App.jsx's window.__sonusTest. Only present
  // when the window is loaded with ?test=1 (smoke mode passes it) so the smoke
  // suite can exercise the popup without hitting iTunes/MusicBrainz on every run.
  React.useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('test')) return;
    window.__sonusTagEditorTest = {
      openSearchResults: (rows) => {
        setIsTagSearching(false);
        setTagSearchError(null);
        setTagSearchResults(dedupeSearchResults(rows));
        setSearchOpen(true);
      },
      dedupeSearchResults,
    };
    return () => { delete window.__sonusTagEditorTest; };
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setEditTags({ ...editTags, picture: event.target.result });
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleArtworkKeyDown = async (e) => {
    if (e.metaKey && e.key === 'c') {
      e.preventDefault();
      if (editTags.picture) window.electronAPI?.writeClipboardImage(editTags.picture);
    } else if (e.metaKey && e.key === 'v') {
      e.preventDefault();
      const dataUrl = await window.electronAPI?.readClipboardImage();
      if (dataUrl) setEditTags(t => ({ ...t, picture: dataUrl }));
    } else if (e.key === 'Escape') {
      e.currentTarget.blur();
    }
  };

  const saveTags = async () => {
    if (!track || !window.electronAPI) return;
    const result = await window.electronAPI.writeTag(track.filePath, editTags);
    const success = result === true || result?.success === true;
    if (!success) console.error('Failed to save tags');
    setSaveStatus(success ? 'saved' : 'error');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  const handleTagSearch = async () => {
    const artist = editTags.artist.trim();
    const title = editTags.title.trim();
    const query = [artist, title].filter(Boolean).join(' ');
    if (!query) { setTagSearchError('Add a title or artist first.'); setSearchOpen(true); return; }

    setSearchOpen(true);
    setIsTagSearching(true);
    setTagSearchResults(null);
    setTagSearchError(null);

    try {
      // 1. Try iTunes Search API
      try {
        const res = await fetchWithTimeout(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${SEARCH_FETCH_LIMIT}`);
        const data = await res.json();
        if (data.resultCount > 0) {
          setTagSearchResults(dedupeSearchResults(data.results.map(r => ({
            title:       r.trackName || '',
            artist:      r.artistName || '',
            album:       r.collectionName || '',
            albumArtist: r.collectionArtistName || '',
            year:        r.releaseDate ? r.releaseDate.slice(0, 4) : '',
            genre:       r.primaryGenreName || '',
            trackNumber: r.trackNumber  ? String(r.trackNumber)  : '',
            trackTotal:  r.trackCount   ? String(r.trackCount)   : '',
            discNumber:  r.discNumber   ? String(r.discNumber)   : '',
            discTotal:   r.discCount    ? String(r.discCount)    : '',
            artworkUrl:  r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '600x600bb') : null,
            source: 'iTunes',
          }))));
          return;
        }
      } catch { /* fall through to MusicBrainz */ }

      // 2. Fallback: MusicBrainz
      try {
        const mbQuery = [title && `recording:"${title}"`, artist && `artist:"${artist}"`].filter(Boolean).join(' AND ');
        const res = await fetchWithTimeout(
          `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(mbQuery)}&limit=${SEARCH_FETCH_LIMIT}&fmt=json`,
          { headers: { 'User-Agent': 'Sonus/0.0.0 (sonus-player)' } }
        );
        const data = await res.json();
        const recordings = data.recordings || [];
        if (recordings.length > 0) {
          setTagSearchResults(dedupeSearchResults(recordings.map(r => {
            const release = r.releases?.[0];
            const medium  = release?.media?.[0];
            return {
              title:       r.title || '',
              artist:      r['artist-credit']?.[0]?.artist?.name || '',
              album:       release?.title || '',
              albumArtist: '',
              year:        release?.date ? release.date.slice(0, 4) : '',
              genre:       '',
              trackNumber: '',
              trackTotal:  medium?.['track-count'] ? String(medium['track-count']) : '',
              discNumber:  medium?.position        ? String(medium.position)        : '',
              discTotal:   '',
              artworkUrl:  release ? `https://coverartarchive.org/release/${release.id}/front-250` : null,
              source: 'MusicBrainz',
            };
          })));
        } else {
          setTagSearchError('No results found. Try adjusting the title or artist.');
        }
      } catch {
        setTagSearchError('Search failed — check your internet connection.');
      }
    } finally {
      setIsTagSearching(false);
    }
  };

  const handlePickResult = async (result, idx) => {
    setPickingResult(idx);
    const newTags = {
      ...editTags,
      title:  result.title,
      artist: result.artist,
      album:  result.album,
      year:   result.year,
      genre:  result.genre,
      ...(result.albumArtist && { albumArtist: result.albumArtist }),
      ...(result.trackNumber  && { trackNumber: result.trackNumber }),
      ...(result.trackTotal   && { trackTotal:  result.trackTotal  }),
      ...(result.discNumber   && { discNumber:  result.discNumber  }),
      ...(result.discTotal    && { discTotal:   result.discTotal   }),
    };

    try {
      // Fetch full-res artwork
      if (result.artworkUrl) {
        try {
          const res = await fetchWithTimeout(result.artworkUrl);
          if (res.ok) {
            const blob = await res.blob();
            newTags.picture = await new Promise(resolve => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          }
        } catch { /* keep existing picture */ }
      }

      // Fetch lyrics (MP3 / FLAC / WAV) — lrclib search first, lyrics.ovh as fallback
      if (['.mp3', '.flac', '.wav'].some(e => track?.filePath?.toLowerCase().endsWith(e))) {
        try {
          const params = new URLSearchParams({ artist_name: result.artist, track_name: result.title });
          const res = await fetchWithTimeout(`https://lrclib.net/api/search?${params}`);
          if (res.ok) {
            const results = await res.json();
            const hit = results.find(r => r.plainLyrics);
            if (hit) newTags.lyrics = hit.plainLyrics;
          }
        } catch { /* try fallback */ }

        if (!newTags.lyrics) {
          try {
            const res = await fetchWithTimeout(`https://api.lyrics.ovh/v1/${encodeURIComponent(result.artist)}/${encodeURIComponent(result.title)}`);
            if (res.ok) {
              const data = await res.json();
              if (data.lyrics) newTags.lyrics = data.lyrics;
            }
          } catch { /* no lyrics available */ }
        }
      }

      setEditTags(newTags);
    } finally {
      setPickingResult(null);
      setTagSearchResults(null);
      setSearchOpen(false);
    }
  };

  if (!track) {
    return <div style={{ padding: 40, color: 'var(--text-secondary)' }}>Loading…</div>;
  }

  const fld = { width: '100%', padding: '8px 12px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 8, color: 'var(--text-primary)', outline: 'none', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' };
  const lbl = { display: 'block', fontSize: 10, color: 'var(--text-secondary)', marginBottom: 5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' };
  const numFld = { ...fld, width: 68, textAlign: 'center', paddingLeft: 6, paddingRight: 6 };
  const divider = (text) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
      <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.55, whiteSpace: 'nowrap' }}>{text}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
    </div>
  );
  const fp = track.filePath?.toLowerCase() ?? '';
  const supportsTagEdit = fp.endsWith('.mp3') || fp.endsWith('.flac') || fp.endsWith('.wav');
  const bitrateText = track.bitrate != null
    ? `${track.bitrate} kbps${track.codecProfile ? ` · ${track.codecProfile}` : ''}`
    : null;
  const teaLyricsIsRTL = isRTL(editTags.lyrics || '');

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Empty drag strip — the root content below is `.scrollable`, which opts out
          of -webkit-app-region: drag (see index.css), so this is the only remaining
          background area the window can be dragged by. Matches the main window's
          own 42px title-bar strip (App.jsx's .app-container padding-top). */}
      <div style={{ height: 42, flexShrink: 0 }} />
      <div className="scrollable" ref={scrollableRef} style={{ flex: 1, overflowY: 'auto', padding: '0 32px 32px', boxSizing: 'border-box' }}>
      <div className="glass-panel" style={{ padding: '16px 32px 32px', borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Top row: artwork + identity fields ── */}
        <div style={{ display: 'flex', gap: 28 }}>
          {/* Artwork */}
          <div style={{ flexShrink: 0, width: 200 }}>
            <div style={{ position: 'relative', width: 200, height: 200, marginBottom: 10 }}>
              <div
                tabIndex={0}
                className={`tag-artwork${artworkSelected ? ' tag-artwork--selected' : ''}`}
                style={{ width: '100%', height: '100%', background: 'var(--glass-bg)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer', border: '1px solid var(--glass-border)', outline: 'none' }}
                onClick={() => { setArtworkSelected(true); }}
                onDoubleClick={() => fileInputRef.current?.click()}
                onFocus={() => setArtworkSelected(true)}
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setArtworkSelected(false); }}
                onKeyDown={handleArtworkKeyDown}
              >
                {(editTags.picture || (editArtLoading && track.thumb))
                  ? <img src={editTags.picture || track.thumb} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: editArtLoading && !editTags.picture ? 0.6 : 1 }} />
                  : <Music size={40} color="var(--text-secondary)" />}
              </div>
              {editTags.picture && (
                <button className="clickable" title="Remove artwork"
                  onClick={(e) => { e.stopPropagation(); setEditTags({...editTags, picture: null}); }}
                  style={{ position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.85)', outline: 'none', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(220,50,50,0.75)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.55)'}
                ><X size={13} /></button>
              )}
            </div>
            <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)', opacity: 0.65 }}>
              {artworkSelected ? '⌘C copy · ⌘V paste · double-click to change' : 'Click to select · double-click to upload'}
            </div>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/jpeg, image/png" onChange={handleFileChange} />
          </div>

          {/* Identity fields */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label style={lbl}>Title</label><input className="glass-input" style={fld} value={editTags.title} onChange={e => setEditTags({...editTags, title: e.target.value})} /></div>
            <div><label style={lbl}>Artist</label><input className="glass-input" style={fld} value={editTags.artist} onChange={e => setEditTags({...editTags, artist: e.target.value})} /></div>
            <div><label style={lbl}>Album Artist</label><input className="glass-input" style={fld} placeholder="Same as Artist" value={editTags.albumArtist} onChange={e => setEditTags({...editTags, albumArtist: e.target.value})} /></div>
            <div><label style={lbl}>Album</label><input className="glass-input" style={fld} value={editTags.album} onChange={e => setEditTags({...editTags, album: e.target.value})} /></div>
          </div>
        </div>

        {/* ── Body: left col (Track Info / Credits / Technical) + right col (Lyrics) ── */}
        <div style={{ display: 'flex', gap: 28, alignItems: 'stretch', flexWrap: 'wrap' }}>

          {/* Left column */}
          <div style={{ flex: '1.4 1 320px', minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {divider('Track Info')}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={lbl}>Track</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input className="glass-input" style={numFld} type="number" min="1" placeholder="—" value={editTags.trackNumber} onChange={e => setEditTags({...editTags, trackNumber: e.target.value})} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>of</span>
                  <input className="glass-input" style={numFld} type="number" min="1" placeholder="—" value={editTags.trackTotal} onChange={e => setEditTags({...editTags, trackTotal: e.target.value})} />
                </div>
              </div>
              <div>
                <label style={lbl}>Disc</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input className="glass-input" style={numFld} type="number" min="1" placeholder="—" value={editTags.discNumber} onChange={e => setEditTags({...editTags, discNumber: e.target.value})} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>of</span>
                  <input className="glass-input" style={numFld} type="number" min="1" placeholder="—" value={editTags.discTotal} onChange={e => setEditTags({...editTags, discTotal: e.target.value})} />
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '96px 96px 1fr', gap: 16 }}>
              <div><label style={lbl}>Year</label><input className="glass-input" style={fld} value={editTags.year} onChange={e => setEditTags({...editTags, year: e.target.value})} /></div>
              <div><label style={lbl}>BPM</label><input className="glass-input" style={fld} type="number" min="1" value={editTags.bpm} onChange={e => setEditTags({...editTags, bpm: e.target.value})} /></div>
              <div><label style={lbl}>Genre</label><input className="glass-input" style={fld} value={editTags.genre} onChange={e => setEditTags({...editTags, genre: e.target.value})} /></div>
            </div>

            {divider('Credits')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><label style={lbl}>Composer</label><input className="glass-input" style={fld} value={editTags.composer} onChange={e => setEditTags({...editTags, composer: e.target.value})} /></div>
              <div><label style={lbl}>Comment</label><input className="glass-input" style={fld} value={editTags.comment} onChange={e => setEditTags({...editTags, comment: e.target.value})} /></div>
            </div>

            {divider('Technical')}
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 16, alignItems: 'start' }}>
              <div>
                <label style={lbl}>Bitrate</label>
                <div style={{ padding: '8px 12px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)', opacity: bitrateText ? 0.9 : 0.45, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                  {bitrateText || '—'}
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <label style={lbl}>File</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div title={track.filePath} style={{ flex: 1, padding: '8px 12px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 8, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12 }}>
                    {track.filePath}
                  </div>
                  <button className="glass-button icon-only clickable" style={{ flexShrink: 0, color: 'var(--text-secondary)' }} title="Reveal in Finder" onClick={() => window.electronAPI?.revealInFolder(track.filePath)}>
                    <FolderOpen size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right column — Lyrics (MP3 / FLAC / WAV only) */}
          {supportsTagEdit && (
            <div style={{ flex: '1 1 180px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {divider('Lyrics')}
              <textarea
                className="glass-input"
                placeholder="Paste or type lyrics…"
                value={editTags.lyrics}
                onChange={e => setEditTags({...editTags, lyrics: e.target.value})}
                style={{ flex: 1, minHeight: 200, padding: '8px 12px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 8, color: 'var(--text-primary)', outline: 'none', resize: 'none', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.7, boxSizing: 'border-box', direction: teaLyricsIsRTL ? 'rtl' : 'ltr', textAlign: teaLyricsIsRTL ? 'right' : 'left' }}
              />
            </div>
          )}
        </div>

        {/* ── Actions ── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center', paddingTop: 4 }}>
          {tagSearchError && <span style={{ fontSize: 12, color: 'rgba(255,100,100,0.9)', marginRight: 8 }}>{tagSearchError}</span>}
          <button className="glass-button clickable" style={{ padding: '12px 20px', fontWeight: 600, opacity: isTagSearching ? 0.6 : 1 }} onClick={handleTagSearch} disabled={isTagSearching}>
            <Search size={16} style={{ marginRight: 8 }} />
            {isTagSearching ? 'Searching…' : 'Search Online'}
          </button>
          <button className="glass-button clickable" disabled={editArtLoading} style={{ background: saveStatus === 'saved' ? '#2ecc71' : saveStatus === 'error' ? '#e74c3c' : 'var(--accent-color)', color: '#fff', border: 'none', padding: '12px 24px', fontWeight: 600, transition: 'background 0.2s ease', opacity: editArtLoading ? 0.6 : 1 }} onClick={saveTags}>
            {saveStatus === 'saved' ? <><Check size={18} style={{ marginRight: 8 }} /> Saved</> : saveStatus === 'error' ? <><AlertCircle size={18} style={{ marginRight: 8 }} /> Failed to Save</> : <><Save size={18} style={{ marginRight: 8 }} /> Save Tags to File</>}
          </button>
        </div>

      </div>
      </div>
      {/* Results overlay. Deliberately a SIBLING of the .scrollable form, not
          inside it: rendered inline it inflated the form's scrollHeight past
          the window's fixed height, so the results could only be reached by
          scrolling. As an overlay it needs no resize at all.

          WebkitAppRegion 'no-drag' is load-bearing — index.css makes the whole
          window draggable by its background, and children inherit it. Without
          this, dragging the panel's background would move the WINDOW while its
          buttons still worked: a confusing half-broken state rather than an
          obvious break. Same opt-out App.jsx's confirm modal uses. */}
      {searchOpen && (
        <div
          className="confirm-modal-backdrop tag-search-backdrop"
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)', WebkitAppRegion: 'no-drag',
          }}
        >
          <div className="confirm-modal-panel" style={{ width: 580, maxWidth: 'calc(100vw - 64px)', maxHeight: '62vh', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {isTagSearching
                  ? 'Searching\u2026'
                  : tagSearchError
                    ? 'Search Online'
                    : `${tagSearchResults?.length ?? 0} result${(tagSearchResults?.length ?? 0) === 1 ? '' : 's'} found`}
              </span>
              <button
                className="clickable"
                title="Close"
                onClick={closeSearch}
                disabled={pickingResult !== null}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: pickingResult !== null ? 'default' : 'pointer', padding: 4, display: 'flex', alignItems: 'center', opacity: pickingResult !== null ? 0.4 : 1 }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="scrollable" style={{ overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {isTagSearching ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '44px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
                  <LoaderCircle size={18} className="spin" />
                  Looking this track up…
                </div>
              ) : tagSearchError ? (
                <div style={{ padding: '38px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
                  {tagSearchError}
                </div>
              ) : (
                (tagSearchResults ?? []).map((result, idx) => (
                  <div
                    key={idx}
                    style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 12px', background: 'var(--glass-bg)', borderRadius: 10, border: '1px solid var(--glass-border)' }}
                  >
                    <div style={{ width: 48, height: 48, borderRadius: 6, overflow: 'hidden', background: 'var(--glass-active)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {result.artworkUrl
                        ? <img src={result.artworkUrl} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
                        : <Music size={20} color="var(--text-secondary)" />
                      }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 14 }}>{result.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {[result.artist, result.album, result.year].filter(Boolean).join(' \u00b7 ')}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)', background: 'var(--glass-active)', borderRadius: 4, padding: '2px 6px', flexShrink: 0, fontWeight: 500 }}>
                      {result.source}
                    </span>
                    <button
                      className="glass-button clickable"
                      style={{ flexShrink: 0, padding: '7px 14px', fontSize: 13, fontWeight: 600, opacity: pickingResult === idx ? 0.5 : 1 }}
                      disabled={pickingResult !== null}
                      onClick={() => handlePickResult(result, idx)}
                    >
                      {pickingResult === idx ? 'Loading\u2026' : 'Use this'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
