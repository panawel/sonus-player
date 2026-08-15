import React, { useState, useRef, useLayoutEffect } from 'react';
import { Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, Repeat1, FolderOpen, Music, ListMusic, ChevronRight, ChevronLeft, MoreVertical, Search, X, Volume2, Volume1, VolumeX, Home } from 'lucide-react';
import { FastAverageColor } from 'fast-average-color';
import { arrayMove } from '@dnd-kit/sortable';
import TrackList from './TrackList.jsx';
import TrackListHeader from './TrackListHeader.jsx';
import { useTrackSelection } from './useTrackSelection.js';
import { useTrackSort } from './useTrackSort.js';
import { useMeasuredWidth } from './useMeasuredWidth.js';
import { useIsNarrow } from './useIsNarrow.js';
import HomeView from './HomeView';
import HomeDetailView from './HomeDetailView';
import cx from 'classnames';
import { splitArtists, isRTL } from './audioUtils.js';
import './index.css';

// Below this, Player Panel controls (Skip/Play/volume/repeat/shuffle) shrink
// to give the centered artwork+title block more room — see centerBlockStyle.
const COMPACT_PANEL_BREAKPOINT = 900;
// Below this (narrower still — near the window's minWidth), the left cluster
// restructures from a single row into a stacked column (time label above the
// transport buttons) and the center artwork shrinks, freeing enough room for
// the title/subtitle to stay legible. A second, narrower tier than
// COMPACT_PANEL_BREAKPOINT so icon-shrinking alone still happens first.
const ULTRA_COMPACT_PANEL_BREAKPOINT = 780;

export default function App() {
  const [library, setLibrary] = useState([]);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [view, setView] = useState('library');
  const viewRef = useRef(view);
  viewRef.current = view;
  const [previousView, setPreviousView] = useState('library');
  const [trackMenu, setTrackMenu] = useState(null);
  // { filePaths: string[], anchorRect: DOMRect, context: 'tracklist' | 'now-playing' }

  const [toast, setToast] = useState(null);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState('off'); // 'off', 'all', 'one'
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const prevVolumeRef = useRef(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bgColor, setBgColor] = useState('transparent');
  const [artworkRgb, setArtworkRgb] = useState(null);
  // Full-resolution artwork for the Now Playing overlay, loaded on demand via
  // fs:readArtwork (library objects only carry a small thumbnail URL). The
  // thumbnail is shown upscaled until this resolves, so there's no blank flash.
  const [npArtwork, setNpArtwork] = useState(null);
  // 50%-crossing play counter guard — one count per listen-through. Resets when
  // playback returns below 25% (track restart / repeat-one loop), so replays
  // count again but scrubbing around the middle never double-counts.
  const playRecordedRef = useRef(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [isSeekHovered, setIsSeekHovered] = useState(false);
  const [hoverTime, setHoverTime] = useState(null);
  const [pendingNewTracks, setPendingNewTracks] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Row density shared by every tracklist (persisted).
  const [density, setDensityState] = useState(() => {
    try { return localStorage.getItem('sonus.trackDensity') === 'comfortable' ? 'comfortable' : 'compact'; } catch { return 'compact'; }
  });
  const setDensity = React.useCallback((d) => {
    setDensityState(d);
    try { localStorage.setItem('sonus.trackDensity', d); } catch { /* ignore */ }
  }, []);
  // Sidebar collapse (persisted). Accepts either a value or an updater
  // function (matching useState's own API) so both the toggle tab and the
  // ⌘\ keyboard shortcut can flip it without needing the current value in scope.
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => {
    try { return localStorage.getItem('sonus.sidebarCollapsed') === 'true'; } catch { return false; }
  });
  const setSidebarCollapsed = React.useCallback((updater) => {
    setSidebarCollapsedState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('sonus.sidebarCollapsed', String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  // Library sort (persisted across sessions). sortedLibrary is the *displayed*
  // order — playback next/prev walks it, so "next" always matches what you see.
  const librarySortApi = useTrackSort(library, { storageKey: 'sonus.librarySort' });
  const sortedLibrary = librarySortApi.sorted;
  // Filters against the same fields the Tag Editor exposes (Title/Artist/Album/Year/Genre).
  // Purely a display-time filter over the loaded library - never mutates `library` itself.
  const visibleTracks = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedLibrary;
    return sortedLibrary.filter(t =>
      [t.title, t.artist, t.album, t.year, t.genre].some(field => field && String(field).toLowerCase().includes(q))
    );
  }, [sortedLibrary, searchQuery]);
  const librarySelection = useTrackSelection(visibleTracks);
  // Stable pieces of the selection API for use inside memoized callbacks.
  const { clear: clearLibrarySelection, prune: pruneLibrarySelection, selectedPathsRef: librarySelectedRef } = librarySelection;
  // Whichever tracklist is currently on screen registers here — Cmd+A (App
  // menu IPC, never reaches DOM keydown) routes through it. The Library claims
  // it directly; a HomeDetailView claims it via its own registration effect
  // (see below, after homeDetailItem is declared), so it's only nulled here
  // when neither list is on screen.
  const activeSelectionRef = useRef(null);
  // Global Space handler needs togglePlay before its declaration point.
  const togglePlayRef = useRef(null);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  // Mirror ref (same idiom as viewRef/libraryRef): lets the Services handler
  // insert relative to what's playing without re-subscribing on every track change.
  const currentTrackRef = useRef(currentTrack);
  currentTrackRef.current = currentTrack;
  const [restoreAttempted, setRestoreAttempted] = useState(false);
  // Applied once the restored "current" track's <audio> fires loadedmetadata - can't seek
  // before that, the element has no seekable duration yet.
  const pendingResumeTimeRef = useRef(0);
  // Setting currentTrack on restore changes <audio>'s src, which re-triggers the browser's
  // native autoplay (the autoplay attribute applies to every src change, not just first
  // mount) - this suppresses exactly that one unwanted play. The timeout is a safety net so
  // a flag that's never consumed (e.g. the file fails to load) can't swallow a later,
  // legitimate manual play click.
  const suppressNextAutoplayRef = useRef(false);
  const fac = useRef(new FastAverageColor());
  // blob: URL currently held by navigator.mediaSession artwork (revoked on replace).
  const mediaArtUrlRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const scrollPositionsRef = useRef({});
  const homeDetailScrollsRef = useRef({});
  const showLibraryRef = useRef(false);
  const rowVirtualizerRef = useRef(null);
  // Survives the Tag Editor unmounting Library's content (which collapses .scrollable's
  // scrollHeight and clamps its scrollTop to 0 - see the restore effect below).
  const libraryScrollOffsetRef = useRef(0);
  const lyricsScrollRef = useRef(null);
  const playerTitleWrapRef = useRef(null);
  const playerSubtitleWrapRef = useRef(null);
  const [playerTitleDist, setPlayerTitleDist] = useState(0);
  const [playerSubtitleDist, setPlayerSubtitleDist] = useState(0);
  const [playerTitleDuration, setPlayerTitleDuration] = useState('8s');
  const [playerSubtitleDuration, setPlayerSubtitleDuration] = useState('8s');
  // Real measured widths of the two Player Panel control clusters — the
  // centered artwork+title block's position/size is derived from these
  // (centerBlockStyle below) instead of hardcoded pixel constants, so it
  // stays correct regardless of window width, time-label digit count, or the
  // volume slider opening.
  const leftClusterRef = useRef(null);
  const rightClusterRef = useRef(null);
  const leftClusterWidth = useMeasuredWidth(leftClusterRef);
  const rightClusterWidth = useMeasuredWidth(rightClusterRef);
  const isCompactPanel = useIsNarrow(COMPACT_PANEL_BREAKPOINT);
  const isUltraCompactPanel = useIsNarrow(ULTRA_COMPACT_PANEL_BREAKPOINT);
  // Center the block within the true gap between the two clusters (not the
  // whole row — they're rarely equal width, so naive 50% centering drifts
  // into whichever side is wider), and cap its width to whatever's actually
  // left over. No artificial floor: if there's truly no room, it shrinks
  // toward 0 rather than a fixed size that could overlap either cluster.
  const centerBlockStyle = React.useMemo(() => {
    const offset = (leftClusterWidth - rightClusterWidth) / 2;
    const reserved = leftClusterWidth + rightClusterWidth + 48 /* row padding */ + 32 /* breathing room */;
    return {
      left: `calc(50% + ${offset}px)`,
      maxWidth: `max(0px, calc(100% - ${reserved}px))`,
    };
  }, [leftClusterWidth, rightClusterWidth]);
  const playPauseSize = isCompactPanel ? 52 : 64;
  const playPauseIconSize = isCompactPanel ? 26 : 32;
  const playPauseMargin = isUltraCompactPanel ? 4 : (isCompactPanel ? 8 : 14);
  const controlIconSize = isCompactPanel ? 22 : 28;
  const secondaryIconSize = isCompactPanel ? 18 : 22;
  // Overrides .player-control-button's padding:12px (index.css) only on the
  // two Skip buttons, only when ultra-compact — that class is shared by the
  // volume/repeat/shuffle/⋮ buttons too, which must stay untouched.
  const skipBtnPadding = isUltraCompactPanel ? 6 : 12;
  const playerArtworkSize = isUltraCompactPanel ? 56 : 80;
  const playerArtworkIconSize = isUltraCompactPanel ? 22 : 34;
  const playerArtworkIconMargin = isUltraCompactPanel ? 17 : 23;
  const centerBlockGap = isUltraCompactPanel ? 10 : 16;
  // Soft edge fade for scrolling title/subtitle text, same WebkitMaskImage/
  // maskImage technique HomeView uses for its card-row edges — applied only
  // while that text is actually overflowing (see playerTitleDist/playerSubtitleDist below).
  const MARQUEE_FADE_PX = 16;
  const marqueeFadeMask = `linear-gradient(to right, transparent, black ${MARQUEE_FADE_PX}px, black calc(100% - ${MARQUEE_FADE_PX}px), transparent)`;
  // Precomputed so the subtitle's " • " separators can check whether any
  // artist token actually rendered, not just whether the raw field is
  // truthy — a whitespace-only artist value is truthy but splitArtists()
  // filters it to zero tokens, which used to leave a dangling bullet.
  const playerArtistTokens = currentTrack?.artist ? splitArtists(currentTrack.artist) : [];
  const holdRingSize = playPauseSize + 8;
  const holdRingRadius = holdRingSize / 2 - 2;
  const holdRingCircumference = 2 * Math.PI * holdRingRadius;

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setLibrary((items) => {
        const oldIndex = items.findIndex(t => t.filePath === active.id);
        const newIndex = items.findIndex(t => t.filePath === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };
  
  // History State
  const [playbackHistory, setPlaybackHistory] = useState([]);

  const playTrack = React.useCallback((track, isBack = false) => {
    if (!isBack && currentTrack && currentTrack.filePath !== track.filePath) {
      setPlaybackHistory(prev => {
        const newHistory = [...prev, currentTrack];
        if (newHistory.length > 10) newHistory.shift();
        return newHistory;
      });
    }
    // Asking for the track that's ALREADY loaded gives <audio> an identical
    // src, so React makes no DOM change, autoPlay never re-fires, and the
    // element just sits where it was — paused, mid-track. Restart it by hand.
    // Every "play this" route funnels through here (Finder double-click, the
    // confirm modal's Play, drag-and-drop, row double-click), so this one
    // branch covers all of them.
    if (currentTrack?.filePath === track.filePath && audioRef.current) {
      // A deliberate play request must never be swallowed by the restore-time
      // autoplay suppressor: if that flag happened to be armed, onPlay would
      // immediately re-pause us and reproduce the very bug this fixes.
      suppressNextAutoplayRef.current = false;
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => { /* autoplay policy, or unreadable file — onError handles the latter */ });
    }
    setCurrentTrack(track);
  }, [currentTrack]);

  // Home screen state
  const [homeDetailItem, setHomeDetailItem] = useState(null);
  const [homeDetailOrigin, setHomeDetailOrigin] = useState(null);
  // Cmd+A routing (see activeSelectionRef above): Library claims the ref every
  // render; an open detail view owns it via its registration effect, so leave
  // it alone in that case and null it everywhere else.
  if (view === 'library') {
    activeSelectionRef.current = librarySelection;
  } else if (!(view === 'home' && homeDetailItem)) {
    activeSelectionRef.current = null;
  }
  // Reset detail view whenever the user leaves the home screen.
  React.useEffect(() => { if (view !== 'home' && view !== 'now_playing') { setHomeDetailItem(null); setHomeDetailOrigin(null); } }, [view]);

  // Stable open-detail callback — HomeView is React.memo'd and always mounted;
  // an inline arrow here would break its memo on every App render.
  const openHomeDetail = React.useCallback((item) => {
    setHomeDetailOrigin(null);
    setHomeDetailItem(item);
  }, []);

  // Play a list of tracks in order (or shuffled), queueing the rest via forcedNextQueueRef.
  const playAllTracks = React.useCallback((tracks, shuffle = false) => {
    if (!tracks || tracks.length === 0) return;
    let ordered = shuffle ? [...tracks].sort(() => Math.random() - 0.5) : tracks;
    playTrack(ordered[0], false);
    forcedNextQueueRef.current = ordered.slice(1).map(t => t.filePath);
  }, [playTrack]);

  const [isLyricsOpen, setIsLyricsOpen] = useState(false);

  const audioRef = useRef(null);
  // "Play Next" tracks the user explicitly queued - drained by playNext() ahead of its
  // shuffle/sequential pick, since shuffle's random index otherwise ignores them entirely.
  const forcedNextQueueRef = useRef([]);

  const showToast = React.useCallback((msg) => {
    const id = Date.now();
    setToast({ msg, id });
    setTimeout(() => setToast(t => t?.id === id ? null : t), 3500);
  }, []);

  // Every "this is your library now" path funnels through here: a Finder
  // double-click / Open With, and the confirm modal's Play. Clearing the
  // history and forced queue is load-bearing - both hold filePaths, and the
  // tracks they point at cease to exist the moment the library is swapped
  // (playPrev would otherwise jump to a track that is no longer in the list).
  const replaceLibraryWith = React.useCallback((tracks) => {
    if (!tracks || tracks.length === 0) return;
    setLibrary(tracks);
    clearLibrarySelection();
    setPlaybackHistory([]);
    forcedNextQueueRef.current = [];
    setHomeDetailItem(null);
    setHomeDetailOrigin(null);
    // Now Playing simply swaps to the new track and still reads correctly, so
    // it stays put; every other screen would be describing a library that no
    // longer exists (an artist page with zero tracks, a gutted Home grid).
    setView(v => (v === 'now_playing' ? v : 'library'));
    // Deliberately does NOT setIsPlaying(true) optimistically. playTrack starts
    // the audio (or <audio autoPlay> does, for a genuinely new src) and the
    // element's own play/pause events are the single source of truth. Claiming
    // "playing" before any sound exists is exactly what turned this bug from
    // "nothing happened" into "looks stuck": the button showed Pause over silence.
    playTrack(tracks[0], true);
  }, [playTrack, clearLibrarySelection]);

  // Drag-and-drop and the sidebar's Add Files. Both deliberately keep the
  // confirm modal; only the OS-driven open paths skip it.
  const handleNewTracks = React.useCallback((newTracks) => {
    if (library.length > 0) setPendingNewTracks(newTracks);
    else replaceLibraryWith(newTracks);
  }, [library, replaceLibraryWith]);

  React.useEffect(() => {
    let active = true;
    if (currentTrack?.thumb) {
      fac.current.getColorAsync(currentTrack.thumb)
        .then(color => {
           if (!active) return;
           const [r, g, b] = color.value;
           setBgColor(`rgba(${r}, ${g}, ${b}, 0.5)`);
           setArtworkRgb({ r, g, b });
        })
        .catch(e => console.log(e));
    } else {
      setBgColor('transparent');
      setArtworkRgb(null);
    }

    if ('mediaSession' in navigator && currentTrack) {
      const meta = {
        title: currentTrack.title || 'Unknown Title',
        artist: currentTrack.artist || 'Unknown Artist',
        album: currentTrack.album || 'Unknown Album',
      };
      // Text first, artwork async: MediaImage only accepts http/https/data/blob
      // schemes, so the sonus-thumb:// thumbnail is fetched (CORS-enabled
      // protocol) and handed over as a blob: URL.
      navigator.mediaSession.metadata = new MediaMetadata({ ...meta, artwork: [] });
      if (currentTrack.thumb) {
        fetch(currentTrack.thumb)
          .then(res => res.ok ? res.blob() : null)
          .then(blob => {
            if (!active || !blob) return;
            if (mediaArtUrlRef.current) URL.revokeObjectURL(mediaArtUrlRef.current);
            mediaArtUrlRef.current = URL.createObjectURL(blob);
            navigator.mediaSession.metadata = new MediaMetadata({
              ...meta,
              artwork: [{ src: mediaArtUrlRef.current, sizes: '300x300', type: blob.type || 'image/jpeg' }],
            });
          })
          .catch(() => { /* no artwork in the media widget — fine */ });
      }
    }

    return () => { active = false; };
  }, [currentTrack]);

  React.useEffect(() => {
    if (!window.electronAPI) return;

    // Finder double-click / Open With: the opened files become the library
    // outright, with no confirm dialog (that belongs to drag-and-drop and Add
    // Files). A *cold* launch never arrives here - main.js resolves it inside
    // library:load instead, so there's no restore-then-wipe flash.
    const unsubFile = window.electronAPI.onOpenExternalFile?.((payload) => {
      const tracks = Array.isArray(payload) ? payload : payload?.tracks;
      const failed = Array.isArray(payload) ? 0 : (payload?.failedCount ?? 0);
      if (tracks?.length > 0) replaceLibraryWith(tracks);
      else if (failed > 0) showToast(`Couldn't open ${failed} file${failed > 1 ? 's' : ''}`);
    });

    return () => {
      unsubFile?.();
    };
  }, [replaceLibraryWith, showToast]);

  // Restore the library saved on last quit. Only applies if nothing else (e.g. a
  // double-clicked file arriving via onOpenExternalFile above) has already populated the
  // library by the time this resolves - whichever wins the race, the other backs off.
  React.useEffect(() => {
    if (!window.electronAPI?.loadLibraryState) {
      setRestoreAttempted(true);
      return;
    }
    window.electronAPI.loadLibraryState().then(({ tracks, currentTrackPath, currentTime: savedTime, autoPlay, failedOpenCount }) => {
      // main.js falls back to the saved session when every file handed to us on
      // launch was unreadable - say so rather than silently ignoring the open.
      if (failedOpenCount > 0) {
        showToast(`Couldn't open ${failedOpenCount} file${failedOpenCount > 1 ? 's' : ''}`);
      }
      if (tracks.length > 0 && libraryRef.current.length === 0) {
        setLibrary(tracks);
        const restoredCurrent = currentTrackPath && tracks.find(t => t.filePath === currentTrackPath);
        if (restoredCurrent) {
          // autoPlay means this launch came from a Finder open, which should
          // start playing immediately. A restored session must not, so its
          // <audio autoPlay> is suppressed and the saved position re-applied.
          if (!autoPlay) {
            suppressNextAutoplayRef.current = true;
            setTimeout(() => { suppressNextAutoplayRef.current = false; }, 3000);
            pendingResumeTimeRef.current = savedTime || 0;
          }
          setCurrentTrack(restoredCurrent);
        }
      }
    }).finally(() => setRestoreAttempted(true));
  }, [showToast]);

  // Debounced so rapid changes (bulk add, drag-reorder) don't spam disk writes. Gated on
  // restoreAttempted (and keyed on it) rather than just checking library.length, so once the
  // initial restore settles - whichever side won the open-file race above - this effect
  // reliably re-runs with the final, correct state instead of writing a premature empty
  // library over a save that hasn't been applied yet.
  React.useEffect(() => {
    if (!restoreAttempted) return;
    const timer = setTimeout(() => {
      window.electronAPI?.saveLibraryState?.({
        trackPaths: library.map(t => t.filePath),
        currentTrackPath: currentTrack?.filePath ?? null,
        currentTime: audioRef.current?.currentTime ?? 0
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [library, currentTrack, restoreAttempted]);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.electronAPI && e.dataTransfer.files) {
      const paths = Array.from(e.dataTransfer.files).map(f => window.electronAPI.getPathForFile(f)).filter(Boolean);
      if (paths.length === 0) return;
      const data = await window.electronAPI.parseFiles(paths);
      if (data && data.length > 0) {
        handleNewTracks(data);
      }
    }
  };

  const resolvePendingTracks = (action) => {
    const newTracks = pendingNewTracks;
    setPendingNewTracks(null);
    if (!newTracks || action === 'cancel') return;

    if (action === 'play') {
      replaceLibraryWith(newTracks);
      return;
    }

    const existingPaths = new Set(library.map(t => t.filePath));
    const uniqueNew = newTracks.filter(t => !existingPaths.has(t.filePath));

    if (action === 'play-next') {
      const currentIndex = currentTrack ? library.findIndex(t => t.filePath === currentTrack.filePath) : -1;
      const insertAt = currentIndex === -1 ? 0 : currentIndex + 1;
      setLibrary([...library.slice(0, insertAt), ...uniqueNew, ...library.slice(insertAt)]);
      // Most recent "Play Next" plays first, mirroring the insert-after-current order above.
      forcedNextQueueRef.current = [...uniqueNew.map(t => t.filePath), ...forcedNextQueueRef.current];
    } else if (action === 'add-to-queue') {
      setLibrary([...library, ...uniqueNew]);
    }
  };

  React.useEffect(() => {
    if (!pendingNewTracks) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setPendingNewTracks(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingNewTracks]);

  const removeTracks = React.useCallback((tracksToRemovePaths) => {
    if (!tracksToRemovePaths || tracksToRemovePaths.length === 0) return;

    setLibrary(prevLib => {
      const newLib = prevLib.filter(t => !tracksToRemovePaths.includes(t.filePath));
      return newLib;
    });

    pruneLibrarySelection(tracksToRemovePaths);

    if (currentTrack && tracksToRemovePaths.includes(currentTrack.filePath)) {
       // Advance within the *displayed* (sorted) order, matching what the user sees.
       const currentIndex = sortedLibrary.findIndex(t => t.filePath === currentTrack.filePath);
       const remaining = sortedLibrary.filter(t => !tracksToRemovePaths.includes(t.filePath));
       if (remaining.length > 0) {
         const nextIndex = Math.min(currentIndex, remaining.length - 1);
         playTrack(remaining[nextIndex], isPlaying);
       } else {
         setCurrentTrack(null);
         setIsPlaying(false);
         if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
         }
       }
    }
  }, [currentTrack, sortedLibrary, playTrack, isPlaying, pruneLibrarySelection]);

  // Finder Services ("Add to Queue in Sonus" / "Play Next in Sonus"). Unlike a
  // double-click, these never replace the library and never change what's
  // playing — they only queue, exactly as their menu labels say. Returns how
  // many tracks were actually added (already-present ones are skipped).
  const queueTracksFromService = React.useCallback((action, newTracks) => {
    const lib = libraryRef.current;
    const existingPaths = new Set(lib.map(t => t.filePath));
    const uniqueNew = newTracks.filter(t => !existingPaths.has(t.filePath));
    if (uniqueNew.length === 0) return 0;

    if (action === 'play-next') {
      const ct = currentTrackRef.current;
      const currentIndex = ct ? lib.findIndex(t => t.filePath === ct.filePath) : -1;
      const insertAt = currentIndex === -1 ? 0 : currentIndex + 1;
      setLibrary([...lib.slice(0, insertAt), ...uniqueNew, ...lib.slice(insertAt)]);
      // Repositioning the rows is only the visual half: forcedNextQueueRef is
      // what actually drives playback order, and shuffle ignores list position
      // entirely without it.
      forcedNextQueueRef.current = [...uniqueNew.map(t => t.filePath), ...forcedNextQueueRef.current];
    } else {
      setLibrary([...lib, ...uniqueNew]);
    }
    return uniqueNew.length;
  }, []);

  React.useEffect(() => {
    if (!window.electronAPI) return;
    const unsub = window.electronAPI.onServiceAction?.(({ action, tracks }) => {
      if (!tracks || tracks.length === 0) return;
      const added = queueTracksFromService(action, tracks);
      if (added === 0) {
        showToast('Already in queue');
        return;
      }
      const plural = added > 1 ? 's' : '';
      showToast(action === 'play-next'
        ? `${added} track${plural} playing next`
        : `Added ${added} track${plural} to queue`);
    });
    return unsub;
  }, [queueTracksFromService, showToast]);

  // On window focus: batch-check all library paths and silently remove any that no longer exist.
  React.useEffect(() => {
    let timer = null;
    const handleFocus = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const lib = libraryRef.current;
        if (lib.length === 0 || !window.electronAPI?.checkPaths) return;
        const paths = lib.map(t => t.filePath);
        const exists = await window.electronAPI.checkPaths(paths);
        const missingPaths = paths.filter((_, i) => !exists[i]);
        if (missingPaths.length > 0) {
          removeTracks(missingPaths);
          const n = missingPaths.length;
          showToast(`${n} track${n > 1 ? 's' : ''} removed — file${n > 1 ? 's' : ''} not found`);
        }
      }, 500);
    };
    window.addEventListener('focus', handleFocus);
    return () => { window.removeEventListener('focus', handleFocus); clearTimeout(timer); };
  }, [removeTracks, showToast]);

  // Background library reconciliation pushes from the main process: after the
  // instant cached load, stale entries are re-parsed and missing files dropped.
  React.useEffect(() => {
    if (!window.electronAPI) return;
    const unsubUpdated = window.electronAPI.onLibraryUpdated?.(({ updated, removed }) => {
      if (removed?.length > 0) removeTracks(removed);
      if (updated?.length > 0) {
        const byPath = new Map(updated.map(t => [t.filePath, t]));
        setLibrary(lib => lib.map(t => byPath.get(t.filePath) ?? t));
        setCurrentTrack(ct => ct && byPath.has(ct.filePath) ? byPath.get(ct.filePath) : ct);
      }
    });
    const unsubProgress = window.electronAPI.onReindexProgress?.(({ done, total }) => {
      showToast(done < total ? `Updating library… ${done} / ${total}` : `Library updated — ${total} tracks refreshed`);
    });
    return () => { unsubUpdated?.(); unsubProgress?.(); };
  }, [removeTracks, showToast]);

  // Now Playing full-res artwork: reset to the thumbnail placeholder on every
  // track change, then upgrade once fs:readArtwork resolves. Only fetched while
  // the overlay is actually open.
  React.useEffect(() => {
    setNpArtwork(null);
    if (view !== 'now_playing' || !currentTrack?.thumb || !window.electronAPI?.readArtwork) return;
    let active = true;
    window.electronAPI.readArtwork(currentTrack.filePath).then(url => {
      if (active && url) setNpArtwork(url);
    });
    return () => { active = false; };
  }, [view, currentTrack?.filePath, currentTrack?.thumb]);

  // "Play Next" for tracks already in the library (right-click menu). Repositions them right
  // after the current track - purely a visual cue, since forcedNextQueueRef (below) is what
  // actually drives playback priority and already works correctly under shuffle.
  const playTracksNext = React.useCallback((filePaths) => {
    if (!filePaths || filePaths.length === 0) return;

    // Sort into the library's existing order (not click/selection order) so multi-select
    // lands in a predictable, top-to-bottom sequence rather than whatever order rows were
    // clicked in.
    const indexByPath = new Map(library.map((t, i) => [t.filePath, i]));
    const tracksToQueue = filePaths
      .filter(fp => indexByPath.has(fp) && fp !== currentTrack?.filePath)
      .sort((a, b) => indexByPath.get(a) - indexByPath.get(b))
      .map(fp => library.find(t => t.filePath === fp));

    if (tracksToQueue.length === 0) return;

    if (!currentTrack) {
      // Nothing playing - the first one starts immediately; any rest queue up right after it.
      const [first, ...rest] = tracksToQueue;
      playTrack(first, false);
      if (rest.length > 0) {
        setLibrary(lib => {
          const withoutRest = lib.filter(t => !rest.some(r => r.filePath === t.filePath));
          const insertAt = withoutRest.findIndex(t => t.filePath === first.filePath) + 1;
          return [...withoutRest.slice(0, insertAt), ...rest, ...withoutRest.slice(insertAt)];
        });
        forcedNextQueueRef.current = [...rest.map(t => t.filePath), ...forcedNextQueueRef.current];
      }
      return;
    }

    setLibrary(lib => {
      const withoutQueued = lib.filter(t => !tracksToQueue.some(q => q.filePath === t.filePath));
      const insertAt = withoutQueued.findIndex(t => t.filePath === currentTrack.filePath) + 1;
      return [...withoutQueued.slice(0, insertAt), ...tracksToQueue, ...withoutQueued.slice(insertAt)];
    });
    forcedNextQueueRef.current = [...tracksToQueue.map(t => t.filePath), ...forcedNextQueueRef.current];
  }, [library, currentTrack, playTrack]);

  const openTrackMenu = React.useCallback((filePaths, anchorRect) => {
    setTrackMenu({ filePaths, anchorRect, context: 'tracklist' });
  }, []);

  // Space = global play/pause. Skips text fields (typing) and buttons (space
  // already "clicks" a focused button natively — double-toggling would undo it).
  // Delete/Backspace track removal now lives inside TrackList's keyboard handler.
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== ' ') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'BUTTON')) return;
      e.preventDefault();
      togglePlayRef.current?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  React.useEffect(() => {
    if (!trackMenu) return;
    const close = () => setTrackMenu(null);
    const closeOnEsc = (e) => { if (e.key === 'Escape') setTrackMenu(null); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', closeOnEsc);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', closeOnEsc);
    };
  }, [trackMenu]);

  React.useEffect(() => {
    if (!trackMenu) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const close = () => setTrackMenu(null);
    el.addEventListener('scroll', close, { passive: true });
    return () => el.removeEventListener('scroll', close);
  }, [trackMenu]);

  React.useEffect(() => {
    const handleSeekKeyDown = (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      // Don't hijack the cursor-movement arrow keys while typing (search box, Tag Editor
      // inputs) - same activeElement check used for Cmd+A elsewhere in this file.
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      const audio = audioRef.current;
      if (!audio) return;
      e.preventDefault();
      // Clicking a button leaves it focused with no visible ring, but Chromium's
      // :focus-visible heuristic retroactively shows that ring on the next key press of any
      // kind - blur it so seeking doesn't leave a stray highlight on whatever was clicked last.
      active?.blur?.();
      const delta = e.key === 'ArrowRight' ? 5 : -5;
      const newTime = Math.min(Math.max(audio.currentTime + delta, 0), audio.duration || Infinity);
      audio.currentTime = newTime;
      setCurrentTime(newTime);
    };
    window.addEventListener('keydown', handleSeekKeyDown);
    return () => window.removeEventListener('keydown', handleSeekKeyDown);
  }, []);

  // ⌘\ toggles the sidebar — standard macOS "toggle sidebar" convention
  // (Xcode, Mail). No Electron role/default binding claims this accelerator,
  // so unlike Cmd+A this needs no menu/IPC round-trip - a plain renderer
  // keydown listener is enough, same as the seek shortcut above.
  React.useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== '\\') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      setSidebarCollapsed(v => !v);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setSidebarCollapsed]);

  React.useEffect(() => {
    if (window.electronAPI?.onSelectAll) {
      const unsubscribe = window.electronAPI.onSelectAll(() => {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
          active.select();
        } else {
          activeSelectionRef.current?.selectAll();
        }
      });
      return unsubscribe;
    }
  }, []);

  const handleAddFiles = async () => {
    if (window.electronAPI) {
      const data = await window.electronAPI.readFiles();
      if (data && data.length > 0) {
        handleNewTracks(data);
      }
    }
  };

  const scrollToTrack = React.useCallback((filePath, force = false) => {
    setTimeout(() => {
      if (!showLibraryRef.current) return;
      // The virtualizer is indexed against visibleTracks (the filtered view), not the full
      // library - a track hidden by an active search has no row to scroll to.
      const index = visibleTracks.findIndex(t => t.filePath === filePath);
      if (index === -1) return;
      rowVirtualizerRef.current?.scrollToIndex(index, { align: force ? 'center' : 'auto', behavior: 'smooth' });
    }, 50);
  }, [visibleTracks]);

  const playNext = React.useCallback((isAutoPlay = false) => {
    if (library.length === 0 || !currentTrack) return;
    
    if (isAutoPlay && repeatMode === 'one') {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
      }
      return;
    }

    // Queued "Play Next" tracks take priority over both shuffle and sequential order -
    // they're an explicit request to play a specific track next. Skip over any that were
    // removed from the library before their turn.
    while (forcedNextQueueRef.current.length > 0) {
      const forcedPath = forcedNextQueueRef.current.shift();
      const forcedIndex = library.findIndex(t => t.filePath === forcedPath);
      if (forcedIndex !== -1) {
        playTrack(library[forcedIndex], false);
        scrollToTrack(forcedPath, !isAutoPlay);
        return;
      }
    }

    // Sequential order follows the displayed (sorted) library, not raw insertion order.
    let nextIndex;
    if (isShuffle) {
      nextIndex = Math.floor(Math.random() * sortedLibrary.length);
    } else {
      const currentIndex = sortedLibrary.findIndex(t => t.filePath === currentTrack.filePath);

      if (isAutoPlay && repeatMode === 'off' && currentIndex === sortedLibrary.length - 1) {
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.currentTime = 0;
          audioRef.current.pause();
        }
        return;
      }

      nextIndex = (currentIndex + 1) % sortedLibrary.length;
    }
    playTrack(sortedLibrary[nextIndex], false);
    scrollToTrack(sortedLibrary[nextIndex].filePath, !isAutoPlay);
  }, [library, sortedLibrary, currentTrack, repeatMode, isShuffle, playTrack, scrollToTrack]);

  const playPrev = React.useCallback(() => {
    if (library.length === 0 || !currentTrack) return;
    
    if (playbackHistory.length > 0) {
       const historyCopy = [...playbackHistory];
       const prevTrack = historyCopy.pop();
       setPlaybackHistory(historyCopy);
       playTrack(prevTrack, true);
       scrollToTrack(prevTrack.filePath, true);
    } else {
       const currentIndex = sortedLibrary.findIndex(t => t.filePath === currentTrack.filePath);
       const prevIndex = (currentIndex - 1 + sortedLibrary.length) % sortedLibrary.length;
       playTrack(sortedLibrary[prevIndex], true);
       scrollToTrack(sortedLibrary[prevIndex].filePath, true);
    }
  }, [library, sortedLibrary, currentTrack, playbackHistory, playTrack, scrollToTrack]);

  const togglePlay = React.useCallback(() => {
    if (!currentTrack) {
      // Nothing loaded yet (no double-click has happened) - the <audio> element doesn't
      // exist in this case, so there's nothing for audioRef to play/pause. Pick a starting
      // track instead: the single highlighted row if there is one, else the first track
      // (or a random one if shuffle is on). playTrack mounts <audio autoPlay>, which starts
      // playback itself once the new element is inserted - no manual .play() call needed here.
      if (sortedLibrary.length === 0) return;
      const selected = librarySelectedRef.current;
      let startTrack = selected.length === 1 ? sortedLibrary.find(t => t.filePath === selected[0]) : null;
      if (!startTrack) {
        const startIndex = isShuffle ? Math.floor(Math.random() * sortedLibrary.length) : 0;
        startTrack = sortedLibrary[startIndex];
      }
      playTrack(startTrack, false);
      scrollToTrack(startTrack.filePath, true);
      return;
    }
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  }, [currentTrack, sortedLibrary, isShuffle, playTrack, scrollToTrack, isPlaying, librarySelectedRef]);
  togglePlayRef.current = togglePlay;

  // Long-press (0.7s) on the Play/Pause button jumps the tracklist to the currently playing
  // song - only meaningful while actually looking at the Library, since that's the only view
  // where the jump would be visible.
  const [isHoldingPlayPause, setIsHoldingPlayPause] = useState(false);
  const longPressTimerRef = useRef(null);
  const ringDelayTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const pressStartTimeRef = useRef(0);
  // Below this, a release is a genuine quick click (toggle as normal). Between this and the
  // 700ms long-press, the button was clearly held longer than a tap but the jump never
  // completed - an aborted long-press, not a click, so it does nothing at all. Also used to
  // delay the ring's first appearance, so a normal quick click never flashes it for a frame.
  const QUICK_CLICK_MS = 250;

  const handlePlayPausePressStart = () => {
    if (view !== 'library') return;
    longPressTriggeredRef.current = false;
    pressStartTimeRef.current = Date.now();
    // The ring only shows once a press has clearly left "quick click" territory - the
    // underlying 700ms action timer below still runs from this same moment, untouched, so
    // the actual hold-to-jump duration doesn't change.
    ringDelayTimerRef.current = setTimeout(() => setIsHoldingPlayPause(true), QUICK_CLICK_MS);
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setIsHoldingPlayPause(false);
      if (currentTrack) {
        const index = visibleTracks.findIndex(t => t.filePath === currentTrack.filePath);
        if (index !== -1) {
          rowVirtualizerRef.current?.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
        }
      }
    }, 700);
  };

  const handlePlayPausePressEnd = () => {
    setIsHoldingPlayPause(false);
    if (ringDelayTimerRef.current) {
      clearTimeout(ringDelayTimerRef.current);
      ringDelayTimerRef.current = null;
    }
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePlayPauseClick = () => {
    if (view !== 'library') {
      togglePlay();
      return;
    }
    // A click still fires on release regardless of hold duration - if the long-press already
    // completed its jump, swallow this click instead of also toggling play/pause.
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    if (Date.now() - pressStartTimeRef.current >= QUICK_CLICK_MS) {
      return;
    }
    togglePlay();
  };

  const toggleRepeat = () => {
    if (repeatMode === 'off') setRepeatMode('all');
    else if (repeatMode === 'all') setRepeatMode('one');
    else setRepeatMode('off');
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (val > 0) setIsMuted(false);
    else setIsMuted(true);
    if (audioRef.current) audioRef.current.volume = val;
  };

  const toggleMute = () => {
    if (isMuted) {
      const restored = prevVolumeRef.current > 0 ? prevVolumeRef.current : 1;
      setVolume(restored);
      setIsMuted(false);
      if (audioRef.current) audioRef.current.volume = restored;
    } else {
      prevVolumeRef.current = volume;
      setIsMuted(true);
      if (audioRef.current) audioRef.current.volume = 0;
    }
  };

  const expandNowPlaying = () => {
    if (view !== 'now_playing') setPreviousView(view);
    setView('now_playing');
  };
  const collapseNowPlaying = () => setView(previousView);

  React.useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => togglePlay());
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNext(false));
    }
  }, [togglePlay, playPrev, playNext]);

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isSeeking) {
      setCurrentTime(audio.currentTime);
    }
    // Play counting: one count per listen-through, at the 50% mark. Re-arms
    // below 25% so repeat-one loops and deliberate restarts count again.
    if (currentTrack && audio.duration > 0) {
      const progress = audio.currentTime / audio.duration;
      if (playRecordedRef.current && progress < 0.25) {
        playRecordedRef.current = false;
      } else if (!playRecordedRef.current && progress >= 0.5) {
        playRecordedRef.current = true;
        const fp = currentTrack.filePath;
        window.electronAPI?.recordPlay?.(fp).then(stats => {
          if (!stats) return;
          setLibrary(lib => lib.map(t => t.filePath === fp
            ? { ...t, playCount: stats.playCount, lastPlayed: stats.lastPlayed }
            : t));
        });
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      if (pendingResumeTimeRef.current > 0) {
        audioRef.current.currentTime = pendingResumeTimeRef.current;
        setCurrentTime(pendingResumeTimeRef.current);
        pendingResumeTimeRef.current = 0;
      }
    }
  };

  const handleSeekChange = (e) => {
    setSeekValue(Number(e.target.value));
  };

  const handleSeekMouseDown = () => {
    setIsSeeking(true);
    setSeekValue(currentTime);
  };

  const handleSeekMouseUp = (e) => {
    const time = Number(e.target.value);
    setIsSeeking(false);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const formatTime = (timeInSeconds) => {
    if (isNaN(timeInSeconds)) return "0:00";
    const m = Math.floor(timeInSeconds / 60);
    const s = Math.floor(timeInSeconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // The Tag Editor now lives in its own window (TagEditorWindow.jsx) and only
  // writes the file + reports local save status there. This is where the
  // main window learns a save happened and merges it into library/currentTrack
  // — ported from the old inline saveTags()'s post-save logic.
  React.useEffect(() => {
    if (!window.electronAPI) return;
    const unsub = window.electronAPI.onTagSaved?.(({ filePath, thumb, ...savedFields }) => {
      setLibrary(lib => lib.map(t => t.filePath === filePath ? { ...t, ...savedFields, thumb } : t));

      setCurrentTrack(ct => {
        if (!ct || ct.filePath !== filePath) return ct;
        // writeTag rewrites the whole file on disk (node-id3's update() isn't a
        // patch), and <audio> has that exact file open for streaming/decoding -
        // overwriting it out from under an active read can stall the decoder
        // (timeupdate stops firing). Force a clean reload and restore position.
        const audio = audioRef.current;
        if (audio) {
          const resumeTime = audio.currentTime;
          const wasPlaying = !audio.paused;
          const onLoaded = () => {
            audio.currentTime = resumeTime;
            if (wasPlaying) audio.play();
            audio.removeEventListener('loadedmetadata', onLoaded);
          };
          audio.addEventListener('loadedmetadata', onLoaded);
          if (!wasPlaying) suppressNextAutoplayRef.current = true;
          audio.load();
        }
        return { ...ct, ...savedFields, thumb };
      });
    });
    return unsub;
  }, []);

  const isNowPlayingOpen = view === 'now_playing';
  const npBackLabel = (() => {
    if (previousView === 'home' && homeDetailItem) {
      if (homeDetailItem.type === 'missing-metadata') {
        return { art: 'Missing Art', year: 'Missing Year', lyrics: 'Missing Lyrics' }[homeDetailItem.key] ?? homeDetailItem.key;
      }
      return homeDetailItem.key;
    }
    return { library: 'Library', home: 'Home' }[previousView] ?? 'Back';
  })();
  const showLibrary = view === 'library' || (isNowPlayingOpen && previousView === 'library');
  showLibraryRef.current = showLibrary;

  const lyricsIsRTL = isRTL(currentTrack?.lyrics);

  React.useEffect(() => {
    setPlayerTitleDist(0);
    setPlayerSubtitleDist(0);
    if (!currentTrack) return;
    let rafId;
    // Longer overflow gets a proportionally longer cycle (floor 4s so tiny
    // overflows aren't rushed, ceiling 14s so huge titles don't crawl).
    const marqueeDuration = (d) => `${Math.min(14, Math.max(4, 3 + d / 30))}s`;
    const measure = () => {
      if (playerTitleWrapRef.current) {
        const d = playerTitleWrapRef.current.scrollWidth - playerTitleWrapRef.current.clientWidth;
        const dist = d > 0 ? Math.ceil(d) : 0;
        setPlayerTitleDist(dist);
        if (dist > 0) setPlayerTitleDuration(marqueeDuration(dist));
      }
      if (playerSubtitleWrapRef.current) {
        const d = playerSubtitleWrapRef.current.scrollWidth - playerSubtitleWrapRef.current.clientWidth;
        const dist = d > 0 ? Math.ceil(d) : 0;
        setPlayerSubtitleDist(dist);
        if (dist > 0) setPlayerSubtitleDuration(marqueeDuration(dist));
      }
    };
    rafId = requestAnimationFrame(() => requestAnimationFrame(measure));
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measure);
    };
  }, [currentTrack?.filePath, currentTrack?.title, currentTrack?.artist, currentTrack?.album, currentTrack?.year]);

  // Restores the scroll position lost when Tag Editor's much shorter content collapses
  // .scrollable's scrollHeight (clamping scrollTop to 0) - runs whenever Library's content
  // remounts, e.g. returning from the Tag Editor.
  React.useEffect(() => {
    if (showLibrary) {
      rowVirtualizerRef.current?.scrollToOffset(libraryScrollOffsetRef.current);
    }
  }, [showLibrary]);

  // Restore scroll position when switching views. Position is saved continuously
  // via onScroll (not here) so it's never read after a display collapse clamps it.
  // When returning to view='home' while a detail item is still open (e.g. closing
  // the Tag Editor), restore the detail view's position, not the home grid position.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (view === 'home' && homeDetailItem) {
      const detailKey = `home_detail:${homeDetailItem.type}:${homeDetailItem.key}`;
      el.scrollTop = scrollPositionsRef.current[detailKey] ?? 0;
    } else {
      el.scrollTop = scrollPositionsRef.current[view] ?? 0;
    }
  }, [view]); // intentionally omits homeDetailItem — read at effect-fire time

  // Restore scroll when entering or leaving a detail view. view stays 'home' the
  // whole time, so the [view] effect above never fires — this one handles it instead.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (homeDetailItem !== null) {
      // Entering a detail view — restore its last scroll (0 on first visit)
      const detailKey = `home_detail:${homeDetailItem.type}:${homeDetailItem.key}`;
      el.scrollTop = scrollPositionsRef.current[detailKey] ?? 0;
    } else if (view === 'home') {
      // Going back to the home main screen — restore the grid scroll
      el.scrollTop = scrollPositionsRef.current['home'] ?? 0;
    }
    // If homeDetailItem was reset because we navigated to Library/NP/etc.,
    // do nothing — the [view] effect already handled scroll restoration there.
  }, [homeDetailItem]); // intentionally omits view — read at effect-fire time

  React.useEffect(() => {
    if (lyricsScrollRef.current) lyricsScrollRef.current.scrollTop = 0;
    playRecordedRef.current = false;
  }, [currentTrack?.filePath]);

  React.useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume;
  }, [currentTrack]);

  // Now Playing text and controls use fixed white/static colors — no artwork-color tinting.

  // Automated-test hook — only exists when the page is loaded with ?test=1
  // (electron --smoke does this; the normal app never passes the query).
  React.useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('test')) return;
    window.__sonusTest = {
      setLibrary,
      getLibrary: () => libraryRef.current,
      setView,
      getView: () => viewRef.current,
      openDetail: (item) => { setHomeDetailOrigin(null); setView('home'); setHomeDetailItem(item); },
      closeDetail: () => setHomeDetailItem(null),
    };
    return () => { delete window.__sonusTest; };
  }, []);

  return (
    <div 
      className="app-container"
      style={{ background: bgColor, transition: 'background 1s ease', position: 'relative' }}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Lives in the draggable title-bar strip above the Library panel, not inside it -
          centered over the panel's own width (sidebar width + half the remainder), not the
          full window, so it doesn't drift over the sidebar or the "Library" title below. */}
      {view === 'library' && (
        <div style={{ position: 'fixed', top: 9, left: sidebarCollapsed ? '50vw' : 'calc(88px + (100vw - 88px) / 2)', transform: 'translateX(-50%)', zIndex: 50, WebkitAppRegion: 'no-drag', transition: 'left 0.25s ease' }}>
          <div style={{ position: 'relative', width: 224 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
            <input
              type="text"
              className="wow-search-input"
              placeholder="Search..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setSearchQuery(''); }}
              style={{ width: '100%', height: 25, padding: '0 30px', background: 'var(--glass-bg)', borderWidth: 1, borderStyle: 'solid', borderRadius: 8, color: 'var(--text-primary)', outline: 'none', fontSize: 12, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                title="Clear search"
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 4 }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div style={{ width: sidebarCollapsed ? 0 : 88, overflow: 'hidden', flexShrink: 0, display: 'flex', flexDirection: 'column', padding: sidebarCollapsed ? '24px 0 0' : '0 8px', paddingTop: 24, transition: 'width 0.25s ease, padding 0.25s ease' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: sidebarCollapsed ? 0 : 1, transition: 'opacity 0.15s ease' }}>
          <button
            className={cx("glass-button clickable", { active: view === 'home' })}
            style={{ width: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '10px 4px', background: view === 'home' ? 'var(--glass-active)' : undefined }}
            onClick={() => setView('home')}
          >
            <Home size={18} />
            <span style={{ fontSize: 10, lineHeight: 1, textAlign: 'center' }}>Home</span>
          </button>
          <button
            className={cx("glass-button", { active: view === 'library' })}
            style={{ width: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '10px 4px', background: view === 'library' ? 'var(--glass-active)' : undefined }}
            onClick={() => setView('library')}
          >
            <ListMusic size={18} />
            <span style={{ fontSize: 10, lineHeight: 1, textAlign: 'center' }}>Library</span>
          </button>
        </div>

        <div style={{ marginTop: 'auto', marginBottom: 24, opacity: sidebarCollapsed ? 0 : 1, transition: 'opacity 0.15s ease' }}>
          <button
            className="glass-button"
            style={{ width: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '10px 4px' }}
            onClick={handleAddFiles}
          >
            <Music size={18} />
            <span style={{ fontSize: 10, lineHeight: 1, textAlign: 'center' }}>Add Files</span>
          </button>
        </div>
      </div>

      {/* Sidebar toggle tab — a sibling of the sidebar (not nested inside it), so its
          position animates between two fixed points rather than being carried to a
          negative/off-window coordinate as the sidebar's own width collapses to 0. */}
      <button
        className="clickable sidebar-toggle-tab"
        title={sidebarCollapsed ? 'Show sidebar (⌘\\)' : 'Hide sidebar (⌘\\)'}
        style={{ left: sidebarCollapsed ? 4 : 84 }}
        onClick={() => setSidebarCollapsed(v => !v)}
      >
        {sidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      {/* Main Content Area */}
      <div className="glass-panel" style={{ flex: 1, borderRadius: sidebarCollapsed ? 16 : '16px 0 0 16px', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', transition: 'border-radius 0.25s ease' }}>
        {/* Column header, deliberately a SIBLING above .scrollable rather than
            sticky inside it — rows then physically cannot pass behind the
            labels, so the bar needs no background and never changes on scroll.
            Horizontal padding mirrors .scrollable's so the labels stay aligned
            with the row columns. */}
        {showLibrary && library.length > 0 && (
          // paddingRight is 32 + 6: the header sits outside the scroller, so
          // unlike the rows it does not lose width to the scrollbar. Pairing
          // this with scrollbar-gutter: stable below keeps that 6px constant
          // whether or not the list is long enough to scroll — otherwise a short
          // library would misalign in the opposite direction. The smoke suite
          // asserts Time sits exactly over the duration column.
          <div style={{ flexShrink: 0, padding: '16px 38px 6px 32px', visibility: isNowPlayingOpen ? 'hidden' : 'visible' }}>
            <TrackListHeader
              sort={librarySortApi.sort}
              onCycleColumn={librarySortApi.cycleColumn}
              density={density}
              onDensityChange={setDensity}
              showAlbum={false}
            />
          </div>
        )}
        <div
          className="scrollable"
          ref={scrollContainerRef}
          onScroll={(e) => {
            if (showLibrary) libraryScrollOffsetRef.current = e.currentTarget.scrollTop;
            if (view === 'home' && homeDetailItem) {
              const detailKey = `home_detail:${homeDetailItem.type}:${homeDetailItem.key}`;
              scrollPositionsRef.current[detailKey] = e.currentTarget.scrollTop;
            } else {
              scrollPositionsRef.current[view] = e.currentTarget.scrollTop;
            }
          }}
          style={{
            flex: 1,
            // No top padding for Library: the header block above the scroller
            // already supplies it, and rows should start immediately under the
            // rule. Home and the detail views keep the original 32px.
            padding: showLibrary ? '0 32px 32px' : 32,
            overflowY: 'auto',
            // Reserve the scrollbar gutter on Library so the header above (which
            // is outside this scroller) can compensate with a fixed 6px rather
            // than a width that changes with the library's length.
            scrollbarGutter: showLibrary ? 'stable' : undefined,
            // Hidden the instant Now Playing opens, no delay: unlike the old slide-up (whose
            // panel hadn't physically reached this area yet at t=0, so hiding instantly left a
            // blank gap), the fade+scale panel's full footprint already covers this area from
            // frame 1, just at low opacity - so there's no gap to avoid. Keeping Library
            // rendered any longer than this just lets it bleed through the panel's translucent
            // tint for the rest of the fade, with nothing gained.
            visibility: isNowPlayingOpen ? 'hidden' : 'visible',
          }}
        >

          {showLibrary && (
            <div style={{ height: '100%' }}>
              {library.length === 0 ? (
                // Truly empty library: no bar at all. There's nothing to count
                // or sort, so a full-bleed empty state reads as deliberate.
                <div style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: 100 }}>
                  <FolderOpen size={48} style={{ opacity: 0.5, marginBottom: 16, margin: '0 auto' }} />
                  <p style={{ marginBottom: 16, fontSize: 16 }}>Drag and drop files here, or click <b>Add Files</b> in the sidebar to start listening.</p>
                </div>
              ) : (
                // A search that matches nothing keeps the bar (and so the count
                // and sort controls) — TrackList renders emptyState in place of
                // its rows rather than App swapping the whole tracklist out.
                <TrackList
                  tracks={visibleTracks}
                  emptyState={
                    <div style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: 80 }}>
                      <Search size={48} style={{ opacity: 0.5, marginBottom: 16, margin: '0 auto' }} />
                      <p style={{ marginBottom: 16, fontSize: 16 }}>No tracks match "{searchQuery.trim()}".</p>
                    </div>
                  }
                  currentTrack={currentTrack}
                  isPlaying={isPlaying}
                  density={density}
                  selection={librarySelection}
                  sort={librarySortApi.sort}
                  playTrack={playTrack}
                  togglePlay={togglePlay}
                  onShowMenu={openTrackMenu}
                  onRemoveTracks={removeTracks}
                  canDrag={librarySortApi.isManual && searchQuery.trim().length === 0 && library.length > 1 && library.length <= 5000}
                  onDragEnd={handleDragEnd}
                  scrollElRef={scrollContainerRef}
                  virtualizerRef={rowVirtualizerRef}
                  showAlbum={false}
                />
              )}
            </div>
          )}

          {/* HomeView: always mounted so useMemo caches survive view switches.
              Toggled with display:none — zero layout cost when hidden, instant
              to show again since no re-mount or re-computation is needed. */}
          <div style={{ display: view === 'home' && !homeDetailItem ? 'block' : 'none' }}>
            <HomeView
              library={library}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              playTrack={playTrack}
              playAllTracks={playAllTracks}
              onOpenDetail={openHomeDetail}
              isActive={view === 'home' && !homeDetailItem}
            />
          </div>
          {view === 'home' && homeDetailItem && (
            <HomeDetailView
              item={homeDetailItem}
              library={library}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              playTrack={playTrack}
              togglePlay={togglePlay}
              playAllTracks={playAllTracks}
              onShowMenu={openTrackMenu}
              onRemoveTracks={removeTracks}
              density={density}
              onDensityChange={setDensity}
              selectionRegistryRef={activeSelectionRef}
              backLabel={homeDetailOrigin === 'library' ? 'Library' : homeDetailOrigin === 'now_playing' ? 'Now Playing' : 'Home'}
              onBack={() => {
                if (homeDetailOrigin && homeDetailOrigin !== 'home') {
                  setView(homeDetailOrigin);
                  setHomeDetailOrigin(null);
                }
                setHomeDetailItem(null);
              }}
              savedScrollTop={homeDetailScrollsRef.current[`${homeDetailItem.type}:${homeDetailItem.key}`] ?? 0}
              onScrollChange={(pos) => { homeDetailScrollsRef.current[`${homeDetailItem.type}:${homeDetailItem.key}`] = pos; }}
            />
          )}

        </div>

        {/* Now Playing: always mounted, fades + scales in over the current page / back out.
            The outer wrapper owns position/pointer-events/no-drag and never itself carries
            a `transform` - Electron's native -webkit-app-region drag-region mask doesn't
            track a no-drag carve-out correctly when it's declared on the same element that
            also has an animated `transform` (confirmed: real OS mouse events stopped
            reaching the renderer entirely over the chevron while paused, which only
            playback's frequent repaints happened to mask). The fade/scale transform lives on
            the inner child instead, which carries no app-region opt-out of its own.
            Deliberately NOT a slide-up: a translating panel covers different screen rows at
            different times, so the still-visible Library underneath would always be exposed
            to the panel's translucent blur for *some* window during the motion no matter how
            its opacity/blur was tuned (tried several rounds of this - every fix just moved the
            bleed-through artifact around). A uniform opacity/scale fade covers its whole area
            at the same rate everywhere, so there's no moving wipe-line and nothing to bleed
            through position-dependently - the panel's own translucency genuinely doesn't matter
            here since the whole thing (panel + content) fades as one unit. */}
        <div
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 124,
            pointerEvents: isNowPlayingOpen ? 'auto' : 'none',
            zIndex: 5,
            WebkitAppRegion: 'no-drag',
            clipPath: 'inset(0 0 0 0 round 16px 0 0 0)',
          }}
        >
          <div
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              opacity: isNowPlayingOpen ? 1 : 0,
              transform: isNowPlayingOpen ? 'scale(1)' : 'scale(0.96)',
              transformOrigin: 'bottom center',
              transition: 'opacity 0.28s cubic-bezier(0.32, 0.72, 0, 1), transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
              willChange: 'opacity, transform',
            }}
          >
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)' }} />
            {/* Ambient color wash — solid circles inside a heavy blur furnace */}
            {artworkRgb && (
              <div style={{
                position: 'absolute', inset: 0, overflow: 'hidden',
                pointerEvents: 'none',
                opacity: isPlaying ? 1 : 0,
                transition: 'opacity 1.5s ease',
              }}>
                {/* Blur furnace: extends 15% past panel edges so blur's own soft edge stays hidden */}
                <div style={{
                  position: 'absolute',
                  top: '-15%', left: '-15%', right: '-15%', bottom: '-15%',
                  filter: 'blur(100px)',
                }}>
                  <div style={{
                    position: 'absolute', width: '60%', aspectRatio: '1/1',
                    top: '5%', left: '5%', borderRadius: '50%',
                    background: `rgba(${artworkRgb.r}, ${artworkRgb.g}, ${artworkRgb.b}, 0.9)`,
                    animation: 'np-flare-1 8s ease-in-out infinite',
                    animationPlayState: isPlaying ? 'running' : 'paused',
                  }} />
                  <div style={{
                    position: 'absolute', width: '50%', aspectRatio: '1/1',
                    bottom: '5%', right: '5%', borderRadius: '50%',
                    background: `rgba(${artworkRgb.r}, ${artworkRgb.g}, ${artworkRgb.b}, 0.8)`,
                    animation: 'np-flare-2 13s ease-in-out infinite',
                    animationPlayState: isPlaying ? 'running' : 'paused',
                  }} />
                  <div style={{
                    position: 'absolute', width: '40%', aspectRatio: '1/1',
                    top: '25%', right: '10%', borderRadius: '50%',
                    background: `rgba(${artworkRgb.r}, ${artworkRgb.g}, ${artworkRgb.b}, 0.7)`,
                    animation: 'np-flare-3 18s ease-in-out infinite',
                    animationPlayState: isPlaying ? 'running' : 'paused',
                  }} />
                </div>
              </div>
            )}
            <button
              className="player-control-button clickable"
              style={{ position: 'absolute', top: 16, left: 16, zIndex: 2, display: 'flex', alignItems: 'center', gap: 4, color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: 600, maxWidth: 'calc(50% - 32px)' }}
              onClick={(e) => { e.stopPropagation(); collapseNowPlaying(); }}
            >
              <ChevronLeft size={18} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{npBackLabel}</span>
            </button>
            <div style={{
              position: 'relative', display: 'flex',
              flexDirection: 'row',
              alignItems: 'stretch',
              height: '100%',
              paddingTop: 56,
              paddingBottom: 24,
              WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale',
            }}>
              {!currentTrack ? (
                 <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', textAlign: 'center' }}>
                      <Music size={48} style={{ opacity: 0.5, marginBottom: 16, margin: '0 auto' }} />
                      <p>Play a track to see it here.</p>
                 </div>
              ) : (
                <>
                  {/* Left column: artwork + text */}
                  <div style={{
                    position: 'relative',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    width: isLyricsOpen ? '50%' : '100%',
                    transition: 'width 0.4s cubic-bezier(0.32, 0.72, 0, 1)',
                    flexShrink: 0,
                    minWidth: 0,
                    '--np-scale': isLyricsOpen
                      ? 'min(calc((100vw - 152px) / 2 - 48px), calc(80vh - 190px), 410px)'
                      : 'min(calc(100vw - 152px), calc(80vh - 100px), 640px)',
                  }}>
                    {/* Artwork wrapper — keyed so CSS animations restart on every track change */}
                    <div
                      key={currentTrack.filePath}
                      className={cx('np-artwork', { 'np-artwork-paused': !isPlaying })}
                      style={{ position: 'relative', width: 'clamp(160px, var(--np-scale), 640px)', flexShrink: 0, marginBottom: 0 }}
                    >
                      {/* Ambient color glow radiating from behind the artwork */}
                      {artworkRgb && (
                        <div style={{
                          position: 'absolute', inset: '-35%', borderRadius: '50%',
                          filter: 'blur(70px)',
                          background: `rgba(${artworkRgb.r}, ${artworkRgb.g}, ${artworkRgb.b}, 0.5)`,
                          zIndex: 0, pointerEvents: 'none', transition: 'background 0.5s ease',
                        }} />
                      )}
                      {/* Artwork card */}
                      <div style={{
                        position: 'relative', zIndex: 1, width: '100%', aspectRatio: '1 / 1',
                        borderRadius: 24, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)',
                        boxShadow: artworkRgb
                          ? `0 32px 80px rgba(${artworkRgb.r}, ${artworkRgb.g}, ${artworkRgb.b}, 0.5), 0 8px 32px rgba(0,0,0,0.8), 0 2px 8px rgba(0,0,0,0.5)`
                          : '0 32px 80px rgba(0,0,0,0.6), 0 8px 32px rgba(0,0,0,0.8)',
                      }}>
                        {(npArtwork || currentTrack.thumb) ? (
                          <img src={npArtwork || currentTrack.thumb} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', background: 'var(--glass-active)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Music style={{ width: 'clamp(50px, calc(var(--np-scale) * 0.30), 196px)', height: 'clamp(50px, calc(var(--np-scale) * 0.30), 196px)' }} color="var(--text-secondary)" />
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Lyrics toggle — › to open (glow hint), ‹ to close (no glow) */}
                    {(currentTrack.lyrics || isLyricsOpen) && (
                      <button
                        className={cx('lyrics-open-btn clickable', { 'lyrics-open-btn--open': isLyricsOpen })}
                        onClick={(e) => { e.stopPropagation(); setIsLyricsOpen(v => !v); }}
                      >
                        {isLyricsOpen ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
                      </button>
                    )}
                  </div>
                  {/* Lyrics panel — outer: transitions width */}
                  <div style={{
                    position: 'relative',
                    width: isLyricsOpen ? '50%' : '0%',
                    flexShrink: 0,
                    transition: 'width 0.4s cubic-bezier(0.32, 0.72, 0, 1)',
                  }}>
                    {/* Inner: clips content, fades in, border on left */}
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                      overflow: 'hidden',
                      opacity: isLyricsOpen ? 1 : 0,
                      transition: 'opacity 0.35s ease 0.1s',
                      borderLeft: '1px solid rgba(255,255,255,0.1)',
                    }}>
                      <div ref={lyricsScrollRef} style={{ height: '100%', overflowY: 'auto', padding: '24px 16px 24px 32px', boxSizing: 'border-box' }}>
                        {currentTrack.lyrics ? (
                          <>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, direction: lyricsIsRTL ? 'rtl' : 'ltr', textAlign: lyricsIsRTL ? 'center' : 'left' }}>Lyrics</div>
                            <div style={{ fontSize: 16, lineHeight: 1.85, color: 'rgba(255,255,255,0.82)', whiteSpace: 'pre-wrap', direction: lyricsIsRTL ? 'rtl' : 'ltr', textAlign: lyricsIsRTL ? 'center' : 'left' }}>{currentTrack.lyrics}</div>
                          </>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.35)', fontSize: 14, fontStyle: 'italic' }}>No lyrics for this track.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Player Controls */}
        <div
          className="clickable"
          onClick={isNowPlayingOpen ? collapseNowPlaying : expandNowPlaying}
          style={{ height: 124, position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--glass-panel)', backdropFilter: 'blur(40px)', cursor: 'default', zIndex: 6 }}
        >
          {/* Full-width seek bar — replaces the old borderTop */}
          <div
            style={{ position: 'relative', width: '100%', flexShrink: 0, height: 24, marginTop: -8, paddingTop: 8, zIndex: 6 }}
            onClick={(e) => {
              e.stopPropagation();
              if (!duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const time = pct * duration;
              setCurrentTime(time);
              if (audioRef.current) audioRef.current.currentTime = time;
            }}
            onMouseMove={(e) => {
              if (!duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              setHoverTime(pct * duration);
            }}
            onMouseEnter={() => setIsSeekHovered(true)}
            onMouseLeave={() => { setIsSeekHovered(false); setHoverTime(null); }}
          >
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={isSeeking ? seekValue : currentTime}
              onChange={handleSeekChange}
              onMouseDown={handleSeekMouseDown}
              onMouseUp={handleSeekMouseUp}
              onTouchStart={handleSeekMouseDown}
              onTouchEnd={handleSeekMouseUp}
              className={cx("clickable top-progress-bar wow-slider", { 'top-progress-bar--hovered': isSeekHovered || isSeeking })}
              style={{ '--progress': `${duration ? ((isSeeking ? seekValue : currentTime) / duration) * 100 : 0}%` }}
            />
            {(isSeeking || (isSeekHovered && hoverTime !== null)) && duration > 0 && (
              <div style={{
                position: 'absolute',
                bottom: 'calc(100% + 4px)',
                left: `${(isSeeking ? seekValue : hoverTime) / (duration || 1) * 100}%`,
                transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.75)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 500,
                padding: '2px 6px',
                borderRadius: 4,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                zIndex: 10,
              }}>
                {formatTime(isSeeking ? seekValue : hoverTime)}
              </div>
            )}
          </div>


          {/* Controls row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, padding: '0 24px', position: 'relative' }}>
           <div ref={leftClusterRef} style={{ display: 'flex', alignItems: 'center', flexDirection: isUltraCompactPanel ? 'column' : 'row', gap: isUltraCompactPanel ? 4 : 0 }}>
              {isUltraCompactPanel && (
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}>
                  {formatTime(isSeeking ? seekValue : currentTime)} / {formatTime(duration)}
                </span>
              )}
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button className="player-control-button skip-btn clickable" style={{ color: 'var(--text-primary)', padding: skipBtnPadding }} onClick={(e) => { e.stopPropagation(); playPrev(); }}>
                  <SkipBack size={controlIconSize} fill="currentColor" />
                </button>
                <button
                  className={cx("clickable play-pause-btn", { 'play-pause-btn--playing': isPlaying })}
                  style={{ width: playPauseSize, height: playPauseSize, color: 'var(--text-primary)', margin: `0 ${playPauseMargin}px`, position: 'relative' }}
                  onClick={(e) => { e.stopPropagation(); handlePlayPauseClick(e); }}
                  onMouseDown={handlePlayPausePressStart}
                  onMouseUp={handlePlayPausePressEnd}
                  onMouseLeave={handlePlayPausePressEnd}
                  onTouchStart={handlePlayPausePressStart}
                  onTouchEnd={handlePlayPausePressEnd}
                >
                  {isHoldingPlayPause && (
                    <svg width={holdRingSize} height={holdRingSize} viewBox={`0 0 ${holdRingSize} ${holdRingSize}`} style={{ position: 'absolute', top: -4, left: -4, pointerEvents: 'none' }}>
                      <circle
                        cx={holdRingSize / 2} cy={holdRingSize / 2} r={holdRingRadius}
                        fill="none"
                        stroke="#00f2fe"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeDasharray={holdRingCircumference}
                        strokeDashoffset={holdRingCircumference}
                        transform={`rotate(-90 ${holdRingSize / 2} ${holdRingSize / 2})`}
                        className="hold-ring-circle"
                      />
                    </svg>
                  )}
                  {isPlaying ? (
                    <Pause size={playPauseIconSize} fill="currentColor" />
                  ) : (
                    <Play size={playPauseIconSize} fill="currentColor" style={{ marginLeft: 2 }} />
                  )}
                </button>
                <button className="player-control-button skip-btn clickable" style={{ color: 'var(--text-primary)', padding: skipBtnPadding }} onClick={(e) => { e.stopPropagation(); playNext(false); }}>
                  <SkipForward size={controlIconSize} fill="currentColor" />
                </button>
              </div>
              {!isUltraCompactPanel && (
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', marginLeft: 12, flexShrink: 0, pointerEvents: 'none' }}>
                  {formatTime(isSeeking ? seekValue : currentTime)} / {formatTime(duration)}
                </span>
              )}
           </div>

           {currentTrack && (
             <div style={{ position: 'absolute', left: centerBlockStyle.left, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: centerBlockGap, maxWidth: centerBlockStyle.maxWidth, overflow: 'hidden', pointerEvents: 'none' }}>
               <div
                 className="player-artwork"
                 style={{ width: playerArtworkSize, height: playerArtworkSize, borderRadius: 12, background: 'var(--glass-border)', overflow: 'hidden', cursor: 'pointer', flexShrink: 0, pointerEvents: 'auto' }}
               >
                 {currentTrack.thumb ? <img src={currentTrack.thumb} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music size={playerArtworkIconSize} style={{ margin: playerArtworkIconMargin }} color="var(--text-secondary)" />}
               </div>
               <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, flex: 1, gap: 4, pointerEvents: 'auto' }}>
                 <div ref={playerTitleWrapRef} style={{ overflow: 'hidden', whiteSpace: 'nowrap', width: '100%', fontWeight: 700, fontSize: 20, lineHeight: 1.2, WebkitMaskImage: playerTitleDist > 0 ? marqueeFadeMask : undefined, maskImage: playerTitleDist > 0 ? marqueeFadeMask : undefined }}>
                   <span className={playerTitleDist > 0 ? 'marquee-scroll' : undefined} style={{ display: 'inline-block', '--marquee-distance': `${playerTitleDist}px`, '--marquee-duration': playerTitleDuration }}>
                     {currentTrack.title}
                   </span>
                 </div>
                 <div ref={playerSubtitleWrapRef} style={{ overflow: 'hidden', whiteSpace: 'nowrap', width: '100%', fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.2, WebkitMaskImage: playerSubtitleDist > 0 ? marqueeFadeMask : undefined, maskImage: playerSubtitleDist > 0 ? marqueeFadeMask : undefined }}>
                   <span className={playerSubtitleDist > 0 ? 'marquee-scroll' : undefined} style={{ display: 'inline-block', '--marquee-distance': `${playerSubtitleDist}px`, '--marquee-duration': playerSubtitleDuration }}>
                     {playerArtistTokens.map((token, i) => (
                       // Index-qualified key: duplicate keys corrupt React's keyed
                       // reconciliation (stale artist text survived track changes).
                       <span key={`${i}:${token}`}>
                         {i > 0 && ' & '}
                         <span className="player-meta-link" onClick={(e) => { e.stopPropagation(); setHomeDetailOrigin(view); setView('home'); setHomeDetailItem({ type: 'artist', key: token }); }}>{token}</span>
                       </span>
                     ))}
                     {playerArtistTokens.length > 0 && currentTrack.album && ' • '}
                     {currentTrack.album && <span className="player-meta-link" onClick={(e) => { e.stopPropagation(); setHomeDetailOrigin(view); setView('home'); setHomeDetailItem({ type: 'album', key: currentTrack.album }); }}>{currentTrack.album}</span>}
                     {(playerArtistTokens.length > 0 || currentTrack.album) && currentTrack.year && ' • '}
                     {currentTrack.year && <span className="player-meta-link" onClick={(e) => { e.stopPropagation(); setHomeDetailOrigin(view); setView('home'); setHomeDetailItem({ type: 'year', key: String(currentTrack.year) }); }}>{currentTrack.year}</span>}
                   </span>
                 </div>
               </div>
               <button
                 className="player-control-button clickable"
                 style={{ color: 'var(--text-secondary)', flexShrink: 0, pointerEvents: 'auto' }}
                 onClick={(e) => { e.stopPropagation(); if (trackMenu) { setTrackMenu(null); return; } setTrackMenu({ filePaths: [currentTrack.filePath], anchorRect: e.currentTarget.getBoundingClientRect(), context: 'now-playing' }); }}
               >
                 <MoreVertical size={22} />
               </button>
             </div>
           )}

           <div style={{ width: '30%', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
             {/* Inner auto-width wrapper is the actual measurement target — the
                 outer 30%-wide div never changes size regardless of content
                 (e.g. the volume slider opening), so a ref on it can't detect that. */}
             <div ref={rightClusterRef} style={{ display: 'flex', alignItems: 'center' }}>
              <div
                style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
                onMouseEnter={() => setIsVolumeOpen(true)}
                onMouseLeave={() => setIsVolumeOpen(false)}
              >
                {isVolumeOpen && (
                  // Popup is a DOM descendant of this same hover-listening div,
                  // flush against the button below with zero gap (see index.css's
                  // .volume-popup comment) — that's what actually avoids the
                  // mouseleave-through-a-gap bug the earlier pill attempt hit.
                  <div className="volume-popup">
                    <div className="volume-popup-track">
                      <input
                        type="range"
                        min="0" max="1" step="0.01"
                        value={isMuted ? 0 : volume}
                        onChange={handleVolumeChange}
                        className="clickable volume-slider volume-slider--vertical wow-slider"
                        style={{ '--progress': `${(isMuted ? 0 : volume) * 100}%` }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                )}
                <button
                  className="player-control-button clickable"
                  style={{ color: isMuted ? 'var(--text-secondary)' : 'var(--text-primary)' }}
                  onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                >
                  {isMuted || volume === 0 ? <VolumeX size={secondaryIconSize} /> : volume < 0.5 ? <Volume1 size={secondaryIconSize} /> : <Volume2 size={secondaryIconSize} />}
                </button>
              </div>
              <button className={cx("player-control-button clickable")} style={{ color: repeatMode !== 'off' ? 'var(--accent-color)' : 'var(--text-secondary)' }} onClick={(e) => { e.stopPropagation(); toggleRepeat(); }}>
                {repeatMode === 'one' ? <Repeat1 size={secondaryIconSize} /> : <Repeat size={secondaryIconSize} />}
              </button>
              <button className={cx("player-control-button clickable")} style={{ color: isShuffle ? 'var(--accent-color)' : 'var(--text-secondary)' }} onClick={(e) => { e.stopPropagation(); setIsShuffle(!isShuffle); }}>
                <Shuffle size={secondaryIconSize} />
              </button>
             </div>
           </div>
          </div>
        </div>
      </div>
      
      {currentTrack && (
        <audio 
          ref={audioRef}
          src={window.electronAPI ? window.electronAPI.getAudioSrc(currentTrack.filePath) : ''}
          autoPlay
          onPlay={() => {
            if (suppressNextAutoplayRef.current) {
              suppressNextAutoplayRef.current = false;
              audioRef.current?.pause();
              return;
            }
            setIsPlaying(true);
          }}
          onPause={() => setIsPlaying(false)}
          onEnded={() => playNext(true)}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onError={async () => {
            if (!currentTrack || !window.electronAPI?.checkPaths) return;
            const [exists] = await window.electronAPI.checkPaths([currentTrack.filePath]);
            if (!exists) {
              const name = currentTrack.title || currentTrack.filePath.split('/').pop();
              showToast(`"${name}" removed — file not found`);
              removeTracks([currentTrack.filePath]);
            } else {
              playNext(false);
            }
          }}
        />
      )}

      {pendingNewTracks && (
        <div
          className="confirm-modal-backdrop"
          style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', WebkitAppRegion: 'no-drag' }}
          onClick={() => resolvePendingTracks('cancel')}
        >
          <div
            className="confirm-modal-panel"
            style={{ borderRadius: 16, padding: 24, width: 340, display: 'flex', flexDirection: 'column', gap: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, color: 'var(--text-primary)' }}>
              Add {pendingNewTracks.length} track{pendingNewTracks.length > 1 ? 's' : ''} to your library?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="glass-button clickable" style={{ background: 'var(--accent-color)', color: '#fff', border: 'none', fontWeight: 600 }} onClick={() => resolvePendingTracks('play')}>
                Play
              </button>
              <button className="glass-button confirm-modal-button clickable" onClick={() => resolvePendingTracks('play-next')}>
                Play Next
              </button>
              <button className="glass-button confirm-modal-button clickable" onClick={() => resolvePendingTracks('add-to-queue')}>
                Add to Queue
              </button>
              <button className="glass-button confirm-modal-button clickable" onClick={() => resolvePendingTracks('cancel')}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom dropdown — track list 3-dots and Now Playing ⋮ */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 140, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(24,24,28,0.95)', backdropFilter: 'blur(20px)',
          color: 'var(--text-primary)', padding: '10px 18px', borderRadius: 10,
          fontSize: 13, fontWeight: 500, zIndex: 2000,
          border: '1px solid var(--glass-border)', boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          {toast.msg}
        </div>
      )}

      {trackMenu && (
          <div
            className="track-dropdown"
            style={{
              position: 'fixed',
              zIndex: 1000,
              ...(trackMenu.anchorRect.top > window.innerHeight / 2
                ? { bottom: window.innerHeight - trackMenu.anchorRect.top + 4 }
                : { top: trackMenu.anchorRect.bottom + 4 }),
              ...(trackMenu.anchorRect.right > window.innerWidth / 2
                ? { right: window.innerWidth - trackMenu.anchorRect.right }
                : { left: trackMenu.anchorRect.left }),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {trackMenu.context === 'tracklist' && (
              <div
                className="track-dropdown-item"
                onClick={() => { playTracksNext(trackMenu.filePaths); setTrackMenu(null); }}
              >
                {trackMenu.filePaths.length > 1 ? `Play ${trackMenu.filePaths.length} Tracks Next` : 'Play Next'}
              </div>
            )}
            {trackMenu.filePaths.length === 1 && (
              <>
                {trackMenu.context === 'tracklist' && <div className="track-dropdown-separator" />}
                <div
                  className={cx('track-dropdown-item', { disabled: !['.mp3', '.flac', '.wav'].some(e => trackMenu.filePaths[0].toLowerCase().endsWith(e)) })}
                  onClick={() => {
                    const fp = trackMenu.filePaths[0];
                    const track = library.find(t => t.filePath === fp) ?? (currentTrack?.filePath === fp ? currentTrack : null);
                    if (track) window.electronAPI?.openTagEditor(track);
                    setTrackMenu(null);
                  }}
                >
                  Edit Tags…
                </div>
                <div
                  className="track-dropdown-item"
                  onClick={() => { window.electronAPI?.revealInFolder(trackMenu.filePaths[0]); setTrackMenu(null); }}
                >
                  Reveal in Finder
                </div>
                <div
                  className="track-dropdown-item"
                  onClick={() => {
                    const fp = trackMenu.filePaths[0];
                    const track = library.find(t => t.filePath === fp);
                    if (track) {
                      const fallback = fp.split('/').pop().replace(/\.[^/.]+$/, '');
                      const query = [track.artist, track.title].filter(Boolean).join(' ') || fallback;
                      window.electronAPI?.openExternalUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
                    }
                    setTrackMenu(null);
                  }}
                >
                  Search in YouTube
                </div>
              </>
            )}
            {trackMenu.context === 'tracklist' && (
              <>
                <div className="track-dropdown-separator" />
                <div
                  className="track-dropdown-item danger"
                  onClick={() => { removeTracks(trackMenu.filePaths); setTrackMenu(null); }}
                >
                  {trackMenu.filePaths.length > 1 ? `Remove ${trackMenu.filePaths.length} tracks` : 'Remove from list'}
                </div>
              </>
            )}
          </div>
      )}
    </div>
  );
}
