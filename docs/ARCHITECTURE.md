# Sonus — architecture reference

Deep-dive companion to `CLAUDE.md`. Load the section you need; `CLAUDE.md` links here by anchor.

## Contents

- [Home view (`src/HomeView.jsx`, `src/HomeDetailView.jsx`)](#home-view-srchomeviewjsx-srchomedetailviewjsx)
- [Scroll position preservation across views (`App.jsx`)](#scroll-position-preservation-across-views-appjsx)
- [Tracklist engine (`TrackList.jsx` + `TrackRow.jsx` + `TrackListHeader.jsx` + hooks)](#tracklist-engine-tracklistjsx-trackrowjsx-tracklistheaderjsx-hooks)
- [Column-cycle sorting (no Sort dropdown)](#column-cycle-sorting-no-sort-dropdown)
- [The column header lives OUTSIDE the scroll container](#the-column-header-lives-outside-the-scroll-container)
- [Player panel layout and stacking context](#player-panel-layout-and-stacking-context)
- [Sidebar (Home/Library, collapsible)](#sidebar-homelibrary-collapsible)
- [Track context menu (`trackMenu` state)](#track-context-menu-trackmenu-state)
- [IPC channel surface (`electron/preload.cjs` ↔ `electron/main.js`)](#ipc-channel-surface-electronpreloadcjs-electronmainjs)
- [Launch behavior: what library the app starts with](#launch-behavior-what-library-the-app-starts-with)
- [Finder Services integration ("Add to Queue" / "Play Next")](#finder-services-integration-add-to-queue-play-next)
- [Metadata index, thumbnails, play stats (`electron/indexStore.mjs` + `main.js`)](#metadata-index-thumbnails-play-stats-electronindexstoremjs-mainjs)
- [Artwork normalization and repair (`electron/artwork.mjs`)](#artwork-normalization-and-repair-electronartworkmjs)
- [Custom application menu (`buildAppMenu` in `main.js`)](#custom-application-menu-buildappmenu-in-mainjs)
- [Vibrancy and forced dark mode](#vibrancy-and-forced-dark-mode)
- [Artwork-derived color (`artworkRgb` / `bgColor`)](#artwork-derived-color-artworkrgb-bgcolor)
- [Now Playing glass backdrop — contrast guarantee](#now-playing-glass-backdrop-contrast-guarantee)
- [Now Playing artwork sizing](#now-playing-artwork-sizing)
- [Volume control](#volume-control)
- [Lyrics feature](#lyrics-feature)
- [Background playback / window lifecycle (macOS-specific)](#background-playback-window-lifecycle-macos-specific)
- [Tag Editor — a separate window, not a `view`](#tag-editor-a-separate-window-not-a-view)
- [Now Playing navigation and `previousView` invariants](#now-playing-navigation-and-previousview-invariants)
- [Missing file handling](#missing-file-handling)

## Home view (`src/HomeView.jsx`, `src/HomeDetailView.jsx`)

The Home view is the first of the two sidebar entries (see "Sidebar" below). It shows: genre filter chips, decade filter chips, a library stats micro-line, a Featured Artist hero banner, Quick Picks grid, New Releases, Artists, and Albums horizontal card rows (with a Top Artists ranked sub-section beneath the Artists row). All data comes exclusively from the loaded library — no network calls.

**Section order:** Quick Picks → New Releases → Artists (+ Top Artists sub-section) → Albums → Songs by Year → Library Stats (Sound Quality + Completeness) → Languages.

**Always-mounted with `display: none` (critical performance constraint)**

`HomeView` is rendered unconditionally in `App.jsx` inside a wrapper div whose `display` toggles between `'block'` and `'none'` based on `view === 'home' && !homeDetailItem`. It is **never unmounted** while the app is running. This is load-bearing: base64 artwork images are decoded synchronously by the browser when their `<img>` elements enter the DOM; unmounting and remounting `HomeView` on every navigation would re-decode all visible artwork images on every visit. With always-mounted, that cost is paid exactly once (first visit). Do not change this to conditional rendering (`{view === 'home' && <HomeView />}`) — the freeze comes back immediately.

`HomeDetailView` (album/artist drill-down) is still conditionally mounted: it's a simpler component with no artwork grid, so its mount cost is negligible. Its track list is **virtualized** via `useVirtualizer` with its own inner scroll container (`overflowY: 'auto'`) separate from the shared `.scrollable` — the outer div has `overflow: 'hidden'` and `height: '100%'`. Scroll position is preserved via `savedScrollTop` / `onScrollChange` props + `initialOffset` on the virtualizer + a `useLayoutEffect` on mount.

**App.jsx state owned by the Home view:**
- `homeDetailItem` — `{ type: 'album'|'artist', key }` or `null`; drives which detail view is shown. Resets to `null` whenever `view` leaves `'home'`, **except** for `'now_playing'` — treated as a temporary overlay, so `homeDetailItem` is preserved through it so the back button returns to the correct detail view. (The Tag Editor is no longer a `view` value at all — see "Tag Editor" below — so it never entered into this reset logic in the first place.) The reset effect is: `if (view !== 'home' && view !== 'now_playing') { setHomeDetailItem(null); setHomeDetailOrigin(null); }`.
- `homeDetailOrigin` — stores which view the user was on before entering a HomeDetailView. Set by the player panel artist/album clicks (`setHomeDetailOrigin(view)` before navigating to Home). Set to `null` by HomeView card clicks (navigating from within Home). Used by `onBack` in HomeDetailView to return to the correct screen; passed as `backLabel` prop. Without this, the back button always returned to Home main regardless of where you came from.
- `playAllTracks(tracks, shuffle)` — callback passed to both `HomeView` and `HomeDetailView`. Sets `forcedNextQueueRef.current` to the remaining tracks after playing the first one, so the queue fills without touching library state.
- `isPlaying` — passed as a prop so `QuickPickRow` can render animated equalizer bars (`.eq-bar` CSS, `@keyframes eq-bounce`) over the current track's artwork thumbnail.

**Decade + genre filters:**
Both filters can be active simultaneously — `filteredLibrary` chains them. Decade chips appear in a second row below genre chips (both inside one always-rendered wrapper div; the decades chips were previously nested inside the `{genres.length > 0}` block — this was a bug, now fixed). The hero `useMemo` bypasses its filter-aware logic and uses the full `allArtists` pool when neither filter is active.

**Top Artists sub-section:**
`topArtists` (top 5 by track count from the current filtered artists, via `useMemo`) renders as `TopArtistsPanel` → `TopArtistRow` components directly inside the Artists section, after the horizontal card row. No glass wrapper — it's a sub-section, not a standalone panel. Requires ≥2 artists to show. Each row has an animated fill bar (width driven by `pct = tracks.length / max * 100`) that expands on mount via `setFilled(true)` in a `useEffect` staggered by `index * 75ms`.

**Library stats micro-line:**
`allAlbumsCount` and `totalDuration` are both `useMemo` values derived from the unfiltered `library` (same dep array as `allArtists`). The stats line (`N songs · N artists · N albums · Xh Ym`) always reflects the full library, not `filteredLibrary`. `formatDuration(sec)` is a module-level helper that formats seconds as `143h 12m` (or just `12m` if under an hour).

**Seeded PRNG (`mulberry32` + `seededShuffle`)**

Module-level helpers in `HomeView.jsx`. `mulberry32(seed)` returns a deterministic float in [0,1); `seededShuffle(arr, seed)` returns a new shuffled copy without mutating the input. Each shuffled section has its own `useState(() => Math.random())` seed — `quickPickSeed`, `albumSeed`, `artistSeed`, `releasesSeed`, `heroSeed`. Changing any seed triggers only that section's `useMemo` to recompute.

**Auto-refresh timers (HomeView):**
- **Hero**: `setInterval` every 8 seconds. On each tick, fades out (opacity 0, 300ms CSS transition), swaps `heroSeed`, fades back in. Pauses when the mouse is over the banner (`heroHoveredRef`).
- **Sections** (Quick Picks, Latest Releases, Artists, Albums): single `setInterval` every 60 seconds, rotating through the four sections in order. On each tick checks `isActiveRef.current` — skips silently if the user is not on the Home main screen (in Library, Now Playing, or a detail view; the Tag Editor is a separate `BrowserWindow` so it can never make this `false` by itself). Also checks `sectionsHoveredRef.current` — skips if mouse is over any of the four section wrappers. Same fade pattern as the hero. The `isActive` prop (`view === 'home' && !homeDetailItem`) is synced to `isActiveRef` via `useEffect([isActive])`, never put in the interval's dep array (mount-only `[]` avoids timer restarts on navigation).
- **`HomeView` is wrapped in `React.memo`** — prevents re-renders during `currentTime` ticks (which update App.jsx 4× per second during playback). All props passed to HomeView are stable: `playTrack`/`playAllTracks`/`onOpenDetail` are `useCallback`; `library`, `currentTrack`, `isPlaying`, `isActive` only change on meaningful events.

**Section caps and grid:**
- Quick Picks: 12 tracks, 4-column CSS grid (`repeat(4, 1fr)`, drops to 2 at ≤900px)
- Albums / Artists / New Releases: `MAX_SECTION_CARDS = 20` each
- New Releases: sorts all albums by their most recent track year (descending), takes the top-30 as a recency pool, shuffles within that pool using `releasesSeed`, displays up to 20. This always fills the section regardless of library age — the section is meaningfully different from Albums (which draws from all albums randomly rather than the newest 30).

**`groupByAlbum` / `groupByArtist`** — module-level helpers in `HomeView.jsx`.

`groupByAlbum` groups tracks into `{ name, artist, year, artwork, tracks }` objects. Case-insensitive: Map key is `track.album.toLowerCase()`. Display name uses most-common casing variant across the group's tracks.

`groupByArtist` uses **token-based splitting** (see `splitArtists` below) — each track is added to *every* artist token group it belongs to. A track with `artist: "Inna & Bob Taylor"` contributes to both the "Inna" group and the "Bob Taylor" group. This means artist cards, Top Artists counts, and `allArtists` track counts all correctly reflect total appearances across solo tracks and collaborations. Case-insensitive grouping and most-common-casing display name resolution are preserved.

**`splitArtists(str)` — `src/audioUtils.js`**

Exported utility that splits an artist field into individual artist tokens by common separators: ` & `, ` and `, ` feat. ` / ` feat `, ` ft. ` / ` ft `, ` x ` (space-bounded — "Alex" is not split), `,`. Returns trimmed, non-empty strings. **Repeated-token rule:** if the split yields the same token twice (case-insensitive), the whole string is returned as a single artist — a real collab never lists the same artist twice, so repetition means the separator is part of the name (e.g. "Years & Years"; splitting it into duplicate tokens caused duplicate React keys → corrupted player-panel subtitle text, plus double-counted tracks in `groupByArtist`). Imported by `HomeView.jsx`, `HomeDetailView.jsx`, and `App.jsx`. Language-agnostic: works for Hebrew and other languages because music metadata internationally uses these English separators even for non-English content.

**`detectScript(title)` — `src/audioUtils.js`**

Exported utility that returns the dominant Unicode script of a track title: `'Hebrew'`, `'Arabic'`, `'Cyrillic'`, `'CJK'`, or `'English'` (catch-all for Latin and any title with no letter characters). Iterates every character, skips non-letters (`\p{L}`), tallies by codepoint range (Hebrew `0590–05FF`, Arabic `0600–06FF`, Cyrillic `0400–04FF`, CJK `4E00–9FFF` / `3040–30FF` / `AC00–D7AF`, everything else → English), returns the script with the highest count. Tie-breaks toward whichever came first in the sort. Used by `HomeView.jsx` (`scriptData` useMemo) and `HomeDetailView.jsx` (`type: 'language'` track filter).

**Languages section (HomeView):**
`scriptData` useMemo groups `filteredLibrary` (genre+decade filtered) by `detectScript(t.title)`, sorted by count descending (highest % first). Only shown when ≥2 distinct scripts are present. Rendered as a `LanguageDonut` component — same `donutSlice` / `polarToCart` SVG helpers as `DonutChart` (Sound Quality). `LANG_COLORS` map assigns fixed colors per script (`Hebrew: '#a855f7'`, `English: '#4facfe'`, `Arabic: '#10b981'`, `Cyrillic: '#f59e0b'`, `CJK: '#ef4444'`). Clicking a segment or legend row navigates to `onOpenDetail({ type: 'language', key: script })` — it does not filter in place.

**HomeDetailView artist filter** uses token matching: `splitArtists(t.artist).some(a => a.toLowerCase() === item.key.toLowerCase())`. The `item.key` is always a single artist token (never a compound string like "Inna & Bob Taylor") — the player panel click handler extracts `splitArtists(currentTrack.artist)[0]` as the key so it always navigates to the primary artist's page.

**Hero banner:**
Picks via `seededShuffle(eligibleArtists, heroSeed)[0]` where eligible = artists with ≥2 tracks (falls back to all artists). When a genre filter is active, prefers an artist present in the filtered set; falls back to the most-tracked filtered artist. No manual Refresh button — the hero auto-rotates every 8 seconds (see Auto-refresh timers above). The banner has `onHoverChange` prop that sets `heroHoveredRef.current` to pause rotation while the user's mouse is over it.

**Horizontal card row two-div split (load-bearing — do not collapse back to one div):**

Each card row is split into two elements:
- **`.home-card-row-outer`** — the scroll container (`overflow-x: auto`, `scroll-snap-type: x mandatory`, `padding: 20px 12px 48px`, dynamic `mask-image`). The `ref` for scroll-button logic and `onScroll` for fade state live here.
- **`.home-card-row`** — the inner flex row (`display: flex`, `gap: 16px`, no overflow). Cards live here.

This split is required because CSS spec forces `overflow-y: auto` whenever `overflow-x: auto` is set (they cannot be mixed with `visible`). Without the split, `transform: scale(1.05)` on hovered cards is clipped at the container boundary on all four sides — the hover scale looks like it hits a wall. The outer's `padding: 20px 12px 48px` provides the actual clipping boundary room: 20px/48px contain the card's `box-shadow: 0 10px 36px` (extends ~18px above, ~46px below), and 12px each side contains the ~3.5px horizontal scale of the first/last card.

**`getFlushTarget`** reads `el.firstElementChild.children` (cards inside the inner div), not `el.children` (which is just the one inner div). Using `el.children` directly would give wrong `getBoundingClientRect` positions.

**Dynamic fade mask (`scrollFades` state, `getFadeMask`, `updateFade`):**
Three fade states per row (`albums`, `artists`, `releases`) stored in one `useState` object. `updateFade(key, el)` computes `atStart = el.scrollLeft <= PAD` and `atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - PAD` (where `PAD = 12` matches the horizontal padding). `getFadeMask` returns a gradient offset inward by `PAD` so the fade zone starts at the card edge, not the container edge — preventing the left fade from clipping the first card when scrolled slightly. States: `'right'` (at start), `'left'` (at end), `'both'` (middle), `'none'` (all content fits). Initialized to `'right'` (correct default since all rows start unscrolled).

**HomeDetailView:**
Receives `{ type, key }` and filters `library` to matching tracks. Shows a hero (160×160 artwork, round for artists), subtitle line (artist · year · N tracks · duration), Play All + Shuffle buttons, and a virtualized scrollable track list. `playAllTracks` is the same callback from `App.jsx`. No IPC calls — pure renderer computation.

Supported `type` values: `'album'`, `'artist'`, `'year'`, `'bitrate'`, `'missing-metadata'`, `'language'`.

`type: 'language'` — filters with `detectScript(t.title) === item.key`, sorted by artist then title. Hero is a **2×2 mosaic grid** of up to 4 unique track artworks (deduplicated by thumb URL, first-come order); empty cells show a faint `Music` icon. Type label reads "Language"; title reads the script name (e.g. "Hebrew").

Accepts a `backLabel` prop (default `'Home'`) that drives the back breadcrumb label. When opened from the player panel artist/album links, `backLabel` reflects the origin view ("Library", "Now Playing", etc.) and `onBack` returns to that view instead of Home main.

The detail track list is the same unified `<TrackList>` engine the Library uses (see "Tracklist engine"), configured with no drag, per-open sort (`useTrackSort` with `resetKey` = the item identity), its own `useTrackSelection`, and `showAlbum={item.type !== 'album'}` (the Album/Year column is hidden inside a single album's page). `HomeDetailView` owns the inner scroll container (`innerScrollRef`), passes it as `scrollElRef`, and renders `<TrackListHeader>` **itself, above** that container (`TrackList` never renders the header — see "The column header lives OUTSIDE the scroll container"), plus `initialOffset={savedScrollTop}` for scroll restoration. It registers its selection into App's `activeSelectionRef` via an every-render effect so Cmd+A routes to it while open.

## Scroll position preservation across views (`App.jsx`)

All views share a single `.scrollable` scroll container. Positions are preserved across navigation via `scrollPositionsRef` (a `useRef({})` map of `view → scrollTop`).

**Three load-bearing constraints:**

1. **Save on `onScroll`, never in cleanup.** The `.scrollable` div's `onScroll` handler writes `scrollPositionsRef.current[view] = e.currentTarget.scrollTop`. A `useLayoutEffect` cleanup that reads `scrollTop` is wrong: setting `display: none` on a child collapses the element's `scrollHeight`, clamping `scrollTop` to 0 before cleanup runs, so the saved position is always 0.

2. **Two separate `useLayoutEffect` restores.** One fires on `[view]` change (handles all view switches). A second fires on `[homeDetailItem]` change (handles the back button from a detail view) — because `view` stays `'home'` the entire time the detail view is open, the `[view]` effect never fires on back-navigation. The `onScroll` handler guards against overwriting the home position while the detail view is open: `if (!(view === 'home' && homeDetailItem)) { scrollPositionsRef.current[view] = ... }`.

3. **`showLibraryRef` pattern for `scrollToTrack`.** `scrollToTrack` is a `useCallback` that calls `rowVirtualizer.scrollToIndex` inside a `setTimeout`. It must not add `view` to its dependency array (causes re-creation on every navigation). Instead, `showLibraryRef.current = showLibrary` is set each render; the `setTimeout` callback reads the ref. Without the guard, `scrollToTrack` (called on track advance/autoplay) would fire `rowVirtualizer.scrollToIndex` even when the Home view was visible, resetting its scroll position.

## Tracklist engine (`TrackList.jsx` + `TrackRow.jsx` + `TrackListHeader.jsx` + hooks)

One unified engine renders both the Library and every HomeDetailView track list — they are two configurations of the same `<TrackList>` component. Pieces:

- **`trackUtils.js`** — single source for `formatTime` (row semantics: `--:--` for missing), `ROW_HEIGHTS`/`ART_SIZES` (compact 44/30, comfortable 56/40), `SORT_FIELDS` (title/artist/album/duration only), `COLUMN_CYCLES` + `nextInCycle` + `activeFieldForColumn` (see "Column-cycle sorting"), `compareBy` (locale-aware, numeric-aware, missing values always last in *both* directions, stable), `sortTracks` (`'manual'` returns the input array untouched).
- **`useTrackSort.js`** — `{ sort, cycleColumn, setManual, sorted, isManual }`. `cycleColumn(columnId)` advances that column's cycle. `storageKey` persists to localStorage (Library: `'sonus.librarySort'`); `resetKey` snaps back to manual when it changes (Details per-open reset). `readStored` validates against the current `SORT_FIELDS`, so a persisted field that no column can reach falls back to manual instead of stranding the user.
- **`useTrackSelection.js`** — Set-based selection over the *displayed* array: macOS click semantics (plain/cmd/shift), keyboard cursor (`moveFocus`/`focusIndex`), `selectAll`/`clear`/`prune`. Deliberately does **not** auto-prune when `tracks` changes — hiding rows behind a search must not drop their selection; `removeTracks` calls `prune` explicitly.
- **`TrackRow.jsx`** — config-driven row: leading cell (grip in drag mode / 1-based index otherwise), artwork with overlay (EQ bars while the current track plays un-hovered, Play/Pause icon on hover; clicking toggles without selecting), **combined adaptive cells** (Title/Artist stack — the sorted field becomes the bold primary line, so sorting by artist promotes artist; the Album/Year stack no longer flips, since year isn't sortable), `Mic2` lyrics indicator, and a duration⇄⋮ cell where both are always mounted and crossfaded (zero layout shift). There is no contextual trailing column. Also exports `SortableRowShell`, the *only* place `useSortable` is called — rows outside a DndContext never touch dnd hooks.
- **`TrackListHeader.jsx`** — the hairline column line (`.track-list-header`). Rendered by the layout owner **above its scroll container, never inside it** — see "The column header lives OUTSIDE the scroll container" below, which is the single most important constraint in this area. **There is no Sort chip or dropdown** — sorting is driven entirely by clicking a column label, which walks that column's cycle (see "Column-cycle sorting"). A leading spacer stands in for the row's index + artwork cells so every label sits over the column it sorts.
- **`TrackList.jsx`** — rows only; it deliberately does **not** render the header (see below). Owns the `useVirtualizer` (fixed `estimateSize` per density, `overscan: 10`, **no `measureElement`** — rows are fixed-height), keyboard handling on a focusable container (↑/↓ nav, Shift ranges, Home/End, Enter plays, Delete/Backspace removes via `onRemoveTracks`, Escape clears; ←/→ deliberately fall through to the global seek), and mounts `DndContext`/`SortableContext` **only when `canDrag`**.

**`showAlbum` prop** (default `true`, threaded through `TrackList`/`TrackListHeader`/the `scrollMargin` measurement effect) hides the Album/Year column entirely when `false`. The Library passes `showAlbum={false}` — the Album column was deliberately removed from the Library screen; Year remains a valid, selectable sort field (`SORT_FIELDS`), it's just not rendered as its own column there. `HomeDetailView` passes `showAlbum={item.type !== 'album'}` (see "Home view" above) — the opposite case, hiding it only when already inside a single album's own page where an Album column would be redundant.

**Load-bearing constraints (several inherited from the old implementation):**

1. **`scrollElRef` must point at the actual scrolling ancestor** (Library: `.scrollable` in `App.jsx`; Details: `HomeDetailView`'s `innerScrollRef`). A `flex:1` div nested in a non-flex parent has unbounded height and never truly overflows — attaching the virtualizer there silently mounts every row.
2. **`scrollMargin`**: TrackList measures the offset from the scroll container's content top to the first row (`useLayoutEffect` on density/showAlbum/first-rows-appearing) and feeds it to the virtualizer; rows translate by `virtualRow.start - scrollMargin`. This keeps windowing and `scrollToIndex` exact with the title + sticky header above the rows.
3. **Drag gate**: `canDrag = isManual && no-search && 1 < count ≤ 5000`. dnd-kit's per-row `useSortable` context broadcasts are why unvirtualized/ungated large lists were slow — `React.memo` blocks prop-driven re-renders but not context-driven ones, so capping how many rows are *mounted* is the only real fix. Don't reintroduce an ungated path. In sorted mode the leading cell shows the position index instead of a grip. (Originally measured on a 1272-song library: mounted rows 1272 → ~18, click-select latency ~135ms → ~8ms.)
4. `scrollToTrack` (next/prev/autoplay-advance) goes through `rowVirtualizerRef.current.scrollToIndex(...)` — TrackList assigns its virtualizer into the `virtualizerRef` prop; off-screen rows don't exist in the DOM.
5. **Playback follows the displayed order**: `App.jsx` derives `sortedLibrary` from `useTrackSort` and `playNext`/`playPrev`/`removeTracks`-advance/`togglePlay`-start all walk it, so "next" always matches what the user sees. Manual order (the raw `library` array) is what `library:save` persists; sorting is a view over it and survives sessions via localStorage.
6. **Cmd+A routing**: the App-menu IPC (`menu-select-all`) can't be seen by DOM keydown, so App keeps `activeSelectionRef` — assigned to `librarySelection` when `view === 'library'`, claimed by an open HomeDetailView via its registration effect, nulled otherwise. The rows-block is keyed on `${sort.field}:${sort.dir}` for a soft fade on sort changes (`.track-rows-appear`).
7. **Interaction model**: single click selects; double-click and Enter play; the global Space handler in `App.jsx` toggles play/pause (skips INPUT/TEXTAREA/BUTTON focus); Delete/Backspace removal lives inside TrackList's keydown (the old global handler is gone) — the list container self-focuses on mousedown so keyboard works after any click. The context menu opens on button-2 `mousedown` (earliest possible signal) **and** on `contextmenu` (covers macOS Ctrl+click, which never produces a button-2 mousedown), guarded by `lastMenuOpenRef` so the contextmenu that follows a handled mousedown within ~400ms is a no-op.
8. **Row callbacks must stay referentially stable** (`latestRef` idiom in `TrackList.jsx`: callbacks are `useCallback(..., [])` and read live values through a per-render-updated ref). Before this, every App render re-rendered all ~25 mounted memo'd rows and menu-open→paint measured ~70ms; after, ~22ms. Same reason `DraggableTrackRow` is a memoized component rather than a render-prop shell — a render-prop's fresh `sortable` object busted row memoization in drag mode. Don't pass freshly-created objects/closures as row props.

## Column-cycle sorting (no Sort dropdown)

Clicking a column header advances that column's cycle. The cycles are **data** (`COLUMN_CYCLES` in `trackUtils.js`), not branching logic:

| Column | Cycle |
| --- | --- |
| Title | title↑ → title↓ → **artist↑ → artist↓** → manual → ⟲ |
| Album (Details only) | album↑ → album↓ → manual → ⟲ |
| Time | duration↑ → duration↓ → manual → ⟲ |

Title folds in Artist because both share one combined cell — `TrackRow`'s `StackedCell` already promotes whichever is sorted to its bold primary line. The label renames itself **only for a borrowed field** (`activeFieldForColumn` + the `active !== columnId` check in `HeaderZone`), so the Title column reads "Artist" while sorted by artist but Time stays "Time" rather than becoming "Duration". Manual shows the column's own name with no arrow.

**Every cycle must end at manual.** `canDrag` keys off `isManual`, so without that step one click on any header would disable drag-to-reorder permanently, with no affordance anywhere to restore it (the dropdown that used to offer "Manual order" is gone). `nextInCycle` relies on a not-found `findIndex` returning `-1` so `(-1+1) % len` lands on index 0 — that is what makes clicking a *different* column start its cycle from the top, and what rescues a persisted-but-unreachable field.

`year`, `dateAdded`, `playCount` and `lastPlayed` were **removed** from `SORT_FIELDS` along with the dropdown — a field with no column header would be unreachable. `CONTEXTUAL_FIELDS`, `formatContextValue`, `formatRelative` and `TrackRow`'s contextual trailing column went with them. Note the consequence: **play stats are still recorded** (`stats:recordPlay`, `play-stats.json`) but are no longer displayed anywhere. That data is intact for a future UI.

## The column header lives OUTSIDE the scroll container

**This is the central structural decision, and reverting it reintroduces a bug that has already been fixed twice.**

`TrackList` does **not** render the header. Each layout owner places `<TrackListHeader>` as a **sibling above its own scroll container** — `App.jsx` above `.scrollable`, `HomeDetailView` above its `innerScrollRef`.

Why it matters: a sticky header *inside* a scroller has rows passing behind it, so it must paint an opaque fill to stay legible. That fill is what made the bar visibly darken on scroll, and no amount of colour tuning removes it — the fill is load-bearing as long as anything can get behind the labels. Moving the header out means **nothing is ever behind it**, so it needs no background, no blur, and no scrolled state at all. It is text over a 1px rule and looks identical at every scroll position.

Consequences worth knowing:

- There is no `--scrolled` class, no scroll listener, and no elevation state anywhere. All of that was deleted, not restyled.
- `.track-list-header` is `position: relative`, not `sticky`. It carries no `z-index` (nothing overlaps it any more, including dragged rows).
- `scrollMargin` in `TrackList` is now ~0, but is still **measured rather than assumed** — a caller may put content above the rows inside its scroller.
- The Library screen carries **no title, song count or total duration at all** — no `<h2>Library</h2>`, and nothing in the title-bar strip either. The sidebar already marks the active view, and the same counts remain on Home's stats line. Panel top → first row went from **135px to ~48px**. The smoke suite asserts none of it comes back.

**The scrollbar-gutter compensation.** Because the header sits outside the scroller, it does not lose width to the scrollbar the way the rows do — which put `TIME` 6px right of the duration column on *both* screens. Both scrollers therefore set `scrollbar-gutter: stable` (so the gutter is reserved even when the list is too short to scroll, keeping the offset constant), and both headers add a matching **6px right padding** (`App.jsx` uses `padding: '16px 38px 6px 32px'`; `HomeDetailView` uses `paddingRight: 6`). The smoke suite asserts label-over-column alignment to the pixel on both screens — that is the guard, since the arithmetic is otherwise easy to break.

**Testing "nothing is behind it" requires a hit-test, not a rect comparison.** `getBoundingClientRect` still reports geometry for rows scrolled out of view and clipped by the scroller, so a rect-overlap check flags invisible rows and proves nothing. The smoke suite uses `document.elementFromPoint` across the header and asserts no `.track-row` is ever the painted element.

**Density's only entry point is the `.track-header-density` toggle**, in the 20px header slot that lines up with the row's lyrics indicator. It used to live in the Sort dropdown; when that was removed it would have been orphaned, and it is persisted (`sonus.trackDensity`) and shared with detail views. That slot is the only free space that does not push `Time` out of alignment with the duration column.

**Empty states:** `TrackList` takes an `emptyState` node that replaces its default "No tracks found." block. A search matching nothing renders through `TrackList` so the header (and its sort controls) stays on screen; only a genuinely empty `library` hides the header entirely for a full-bleed prompt, since there is then nothing to sort.

## Player panel layout and stacking context

The player panel (`height: 124`, `position: relative`, `flexDirection: column`, `zIndex: 6`) is a flex column with two layers:

1. **Full-width seek bar** — a wrapper div with `marginTop: -8, paddingTop: 8, height: 24, zIndex: 6`. The negative margin extends the hover zone 8px *above* the panel edge into the content area; `paddingTop: 8` pushes the 2px `<input>` back down to `y=0` of the panel so the track line sits flush at the top. The `<input>` uses classes `top-progress-bar wow-slider`; `.top-progress-bar--hovered` (added when `isSeekHovered || isSeeking`) drives the 2px→4px track expansion via CSS class rather than CSS `:hover`. `hoverTime` (set by `onMouseMove`) drives the tooltip to show the time at the cursor position. The separate absolute-positioned left/right timestamp divs have been removed — time is now shown inline (see Controls row below).
2. **Controls row** — `flex: 1`, vertically centered, `position: relative`, `padding: '0 24px'`, `justifyContent: space-between`. Three sections:
   - **Left:** prev/play/next buttons, left-aligned (`width: auto`, no centering). At normal/compact widths, an inline `{currentTime} / {duration}` time label (13px, `var(--text-secondary)`, `fontVariantNumeric: tabular-nums`, `marginLeft: 12`, `pointerEvents: none`) follows the SkipForward button in the same row. Below `ULTRA_COMPACT_PANEL_BREAKPOINT` the whole cluster restructures into a column instead — see "Ultra-compact tier" below.
   - **Center:** track artwork + text details, **absolutely centered** via `position: absolute, left: centerBlockStyle.left, transform: 'translateX(-50%)'`. `pointerEvents: none` on the wrapper; `pointerEvents: auto` restored on individual interactive children. Always visible regardless of NP state (`currentTrack` only, no `!isNowPlayingOpen` guard).
   - **Right:** volume (a hover popup, not inline — see "Volume control" below) + mute + repeat + shuffle (no ⋮ button — it moved to the center block).

**Center block positioning is measured, not hardcoded** (`centerBlockStyle`, a `useMemo` in `App.jsx`): this used to be a hand-derived constant (`maxWidth: calc(100% - 660px)`, `left: calc(50% + 29px)`), calibrated once against whatever was on screen at the time — which broke the moment the *actual* left-cluster content changed (a longer time string, the volume slider opening). It's now driven by real measurement:
- `leftClusterRef` (wraps Skip Back/Play/Skip Forward/the time label) and `rightClusterRef` feed `useMeasuredWidth(ref)` (`src/useMeasuredWidth.js` — live `offsetWidth` via `ResizeObserver`, feature-detected/no-op'd for jsdom so `App.test.jsx`'s mount never throws).
- `offset = (leftClusterWidth - rightClusterWidth) / 2` → `left: calc(50% + ${offset}px)` — centers the block within the *actual gap* between the two clusters, not the whole row; naive `left: 50%` drifts toward whichever cluster is wider (they're rarely equal).
- `reserved = leftClusterWidth + rightClusterWidth + 48 (row padding) + 32 (breathing room)` → `maxWidth: max(0px, calc(100% - ${reserved}px))` — no artificial floor; if there's truly no room it shrinks toward 0 rather than a fixed size that could overlap either cluster.
- **`rightClusterRef` gotcha:** it must sit on an *auto-width* wrapper around the volume/mute/repeat/shuffle group, not the outer `width: '30%'` div those buttons live inside — that 30%-wide div never changes size regardless of content (e.g. the volume slider opening adds ~90px), so a `ResizeObserver` on it can't detect anything. The real content-width target is an inner wrapper with no explicit width.
- **Compact mode** (`isCompactPanel = useIsNarrow(COMPACT_PANEL_BREAKPOINT)`, breakpoint `900`, `src/useIsNarrow.js` — a `window.resize`-driven boolean, not `ResizeObserver`, matching the different thing it's tracking: viewport width, not an element's own size): below 900px, Skip Back/Forward icons shrink 28→22px, Play/Pause's icon 32→26px and button box 64→52px (with its `margin` and the hold-ring SVG's geometry scaling to match), and Volume/Repeat/Shuffle icons shrink 22→18px. Because `centerBlockStyle` is driven by the *measured* cluster widths, shrinking the surrounding icons automatically gives the center block more room — no separate mechanism needed for that part.
- This is also why `electron/main.js`'s `minWidth` could safely drop from `800` to `700` — the center block no longer has a hardcoded collapse point.

**Ultra-compact tier** (`isUltraCompactPanel = useIsNarrow(ULTRA_COMPACT_PANEL_BREAKPOINT)`, breakpoint `780` — a second, narrower tier than `isCompactPanel`'s `900`, so icon-shrinking alone still happens first before this more drastic rearrangement kicks in): below 780px,
- The left cluster restructures from a single row into a **column**: the time label renders first, centered, on its own line above an inner row containing Skip Back/Play/Skip Forward (`flexDirection: 'column'`, small `gap`). This alone reclaims ~110px that the inline time label + full button spacing used to cost.
- `playPauseMargin` drops to `4` (from `8` in the 780-900 range, `14` normally) and the two Skip buttons get an inline `padding: skipBtnPadding` (`6`, down from `.player-control-button`'s base `12px`) — overridden per-element via inline `style`, *not* by changing the shared CSS class, since `.player-control-button` is also used by volume/repeat/shuffle/⋮/Tag-Editor's Reveal-in-Finder button and must stay untouched for those.
- Center block artwork shrinks `80px → 56px` (reusing the app's existing "comfortable" track-row art size rather than an arbitrary new number — see `ART_SIZES` in `trackUtils.js`), with the fallback `Music` icon and its margin scaled to match (`22px`/`17px`, preserving `icon + 2×margin = box size`). The center block's own artwork↔text `gap` also tightens (`16px → 10px`).
- All of this only ever *frees room* for the center block — `centerBlockStyle`'s math (above) is unchanged and automatically benefits, exactly like the icon-shrink tier does. Nothing here is touched above 780px; the right cluster (volume/repeat/shuffle) is also untouched at every width, since the volume popup no longer affects `rightClusterWidth` at all (see "Volume control" below).

**Center block contents:** artwork (`borderRadius: 12`, class `.player-artwork`, `80px` normally / `56px` ultra-compact) + text column + ⋮ button. Text column: title (20px, `fontWeight: 700`) + subtitle (15px, `var(--text-secondary)`) built from `playerArtistTokens` (`splitArtists(currentTrack.artist)`, or `[]` if there's no artist), `currentTrack.album`, and `currentTrack.year`, joined with `' • '`. **Precomputing `playerArtistTokens` matters**: the separator conditions check `playerArtistTokens.length > 0`, not the raw `currentTrack.artist` field's truthiness — a whitespace-only artist value is truthy but `splitArtists()` trims/filters it to zero tokens, and checking the raw field used to leave a dangling `• Album` with no artist text in front of it. The ⋮ button sits immediately to the right of the text column (`flexShrink: 0`, `pointerEvents: auto`).

**Player panel marquee (long-text scrolling):** When the title or subtitle text is too long to fit, it auto-scrolls. Each wrapper div (`ref={playerTitleWrapRef}` / `ref={playerSubtitleWrapRef}`) has `overflow: hidden, whiteSpace: nowrap` plus a soft two-sided edge fade (`WebkitMaskImage`/`maskImage`, the same convention `HomeView.jsx`'s `getFadeMask` uses for its card-row edges — not the same helper, since this one is a simpler static mask rather than scroll-position-driven) applied only while that text is actually overflowing. An inner `<span>` gets the CSS class `marquee-scroll` (plus `--marquee-distance` and `--marquee-duration` CSS custom properties) when overflow is detected. The measurement effect (`[currentTrack?.filePath, currentTrack?.title, currentTrack?.artist, currentTrack?.album, currentTrack?.year]` dependency array) fires a double-`requestAnimationFrame`, measures `wrapper.scrollWidth - wrapper.clientWidth`, and computes a duration proportional to that distance (`clamp(4s, 3 + distance/30, 14s)`) so a 20px overflow and a 400px overflow no longer scroll at the same flat speed. It **resets both distances to 0 synchronously at the top** before scheduling the RAF — this prevents stale distances from a previous long-text track briefly animating on a new short-text track. The CSS animation (`@keyframes marquee-scroll`, `index.css`) is a true back-and-forth: hold at start → scroll out → hold at end → scroll back → hold at start, both ends of the cycle landing on `translateX(0)` so looping is seamless (no snap/jump — the earlier version only defined two keyframe states and visibly teleported on every loop). `MarqueeText.jsx` exists in `src/` but is not imported anywhere — it is dead code from an earlier NP overlay approach; the player panel uses the inline class approach instead, and the shared `@keyframes marquee-scroll`/`.marquee-scroll` CSS is safe to change without affecting it.

**Clickable artist/album/year links:** All three subtitle fields are rendered as individual `<span>` elements with class `.player-meta-link` (CSS: `cursor: pointer`, hover brightens to `var(--text-primary)`, 0.15s ease transition). Clicking artist navigates to the artist's HomeDetailView using the first `splitArtists` token as the key (primary artist); album opens `{ type: 'album' }`; **year opens `{ type: 'year' }`** — note that `year` is a valid HomeDetailView type even though it is no longer a sortable field. All three call `setHomeDetailOrigin(view)` before navigating so the detail view's back button returns to the correct screen. The `•` separators between fields are plain text, rendered conditionally between present fields only.

**Play/Pause is a bare icon, not a filled button** — deliberately: no circle, no background at all (`.play-pause-btn` is `background: transparent, border: none`), just the `Play`/`Pause` glyph directly on the panel, matching a "solid and simple" transport-bar look. This was a real redesign this session (it used to be a solid white 64×64 circle with a black icon); the earlier design's box-shadow-based glow and per-track artwork-color tinting were both tried and explicitly reverted (see "Artwork-derived color" above) — Skip/Play/Volume/Repeat/Shuffle are all always `var(--text-primary)`/static colors now, never tinted by the track's artwork.

**Center controls sizing** (normal / compact via `isCompactPanel`, see above): Play button box `64px`/`52px` with a `32px`/`26px` icon; SkipBack/SkipForward `28px`/`22px` icons; Volume/Repeat/Shuffle `22px`/`18px` icons. Margin around the play button `14px`/`8px` each side. The hold-ring progress SVG scales with the button (`holdRingSize = playPauseSize + 8`, `holdRingRadius = holdRingSize/2 - 2`, circumference computed from that radius, not hardcoded) so it still fits the button correctly in compact mode.

**Play button glow:** `.play-pause-btn--playing` applies `@keyframes icon-glow-pulse` (2s ease-in-out infinite) — a breathing `filter: drop-shadow(...)` animation while playback is active. **`drop-shadow`, not `box-shadow`** — this matters because the button is a bare SVG icon now with no filled shape for a box-shadow to hug (`text-shadow`/`box-shadow` don't apply to SVG the way `drop-shadow` does). Skip buttons use `.skip-btn` class: `scale(1.12)` on hover, `scale(0.9)` on active, no glow (glow is reserved as a "currently playing" signal specific to Play/Pause).

**Artwork hover (center block):** The artwork div (class `.player-artwork`, `80px`/`56px` per the ultra-compact tier above) has a CSS `::after` pseudo-element (`position: absolute, inset: 0, background: rgba(255,255,255,0.12)`) that fades in on `:hover` — no React state needed. The container must keep `position: relative` and `overflow: hidden` for the `::after` to clip to the rounded corners correctly.

**⋮ button (center block):** Lives inside the absolutely-positioned center block, to the right of the text column. Guarded by `currentTrack` (the whole center block is). Clicking toggles the track menu (opens or closes if already open). `stopPropagation` prevents the document click listener from firing simultaneously.

**Hardcoded panel height references** — two places must match the `124` panel height exactly:
- NP overlay wrapper: `bottom: 124` (positions the overlay to stop exactly where the panel begins)
- Toast notification: `bottom: 140` (`124 + 16px` gap above the panel top)

If the panel height ever changes, update both of these.

**Stacking context constraint — do not remove either z-index:**
The player panel has `backdropFilter: blur(40px)`, which creates a CSS stacking context. This means child `z-index` values are evaluated *locally* within the player panel — they cannot win against the NP overlay's `zIndex: 5` on their own. The player panel itself must have `zIndex: 6` to render its entire stacking context above the NP overlay. The seek bar thumb protrudes 4px above the panel edge into the NP overlay's visual area; without `zIndex: 6` on the player panel, the NP overlay covers the top half of the thumb, making it appear half-gray.

**stopPropagation pattern — keep it on individual buttons, not container divs:**
The outer player panel div has `onClick` for NP open/close. `stopPropagation` lives on each individual interactive element (buttons, seek input, volume slider), *not* on the center or right container divs. This lets clicks on genuinely empty space within those sections bubble up to toggle NP. Don't move stopPropagation back to a container div — it silently breaks empty-space NP toggling in that zone.

## Sidebar (Home/Library, collapsible)

The left icon sidebar has just two destinations — Home and Library — plus Add Files pinned to the bottom. There used to be a third "Now Playing" button; it was removed as redundant, since clicking anywhere on the Player Panel's empty background already toggles Now Playing (`expandNowPlaying`/`collapseNowPlaying`, unchanged) from every screen, all the time. `expandNowPlaying` itself wasn't removed — only its sidebar-button caller.

**Collapse state** (`sidebarCollapsed`, persisted to `localStorage` under `sonus.sidebarCollapsed`, same pattern as `density`) hides the sidebar entirely — full collapse, not an icon-only rail, since two destinations don't justify an intermediate state. Toggled by:
- A thin `‹›` tab (`.sidebar-toggle-tab` in `index.css`) sitting at the sidebar/content boundary. It's a **sibling** of the sidebar div, not nested inside it — if it were nested and anchored via a negative offset (e.g. `right: -12`) the way a "grab handle" normally would be, that offset would animate to an off-window coordinate as the sidebar's own width collapses to 0, taking the control for getting it back off-screen with it. Instead it animates its own `left` between two fixed values in sync with the sidebar's width transition.
- `⌘\` (the standard macOS "toggle sidebar" convention — Xcode, Mail). This is a plain renderer-side `window.addEventListener('keydown', ...)` in `App.jsx`, guarded against firing while a text input is focused — **not** routed through `electron/main.js`'s custom app menu the way Cmd+A has to be. Cmd+A specifically needs that treatment because Electron's default `role: 'selectall'` natively intercepts that exact accelerator before it reaches the renderer (see "Custom application menu" below); `⌘\` has no such built-in role/binding, so it works exactly like the existing Space (play/pause) and ArrowLeft/Right (±5s seek) shortcuts already do.

Two other pieces of layout depend on the sidebar's width and become conditional on `sidebarCollapsed` (both with matching `transition`s so they animate in sync with the collapse): the Library search box's centering (`left: sidebarCollapsed ? '50vw' : 'calc(88px + (100vw - 88px) / 2)'`), and the main content glass panel's corner rounding (`borderRadius: sidebarCollapsed ? 16 : '16px 0 0 16px'` — fully rounded once there's no sidebar to visually dock against, vs. only the sidebar-facing corners rounded when it's present).

"Add Files" is only reachable via the sidebar — collapsing it doesn't add an alternate access point; drag-and-drop (a separate, always-available code path) covers that case.

## Track context menu (`trackMenu` state)

The dropdown is a `position: fixed, zIndex: 1000` div rendered at the root of `App.jsx`. Positioning logic:
- **Vertical:** opens downward (`top: anchorRect.bottom + 4`) when the button is in the upper half of the screen; opens upward (`bottom: window.innerHeight - anchorRect.top + 4`) when in the lower half. This prevents clipping for buttons near the bottom (e.g. the player panel ⋮).
- **Horizontal:** anchors to the right edge when the button is past the screen midpoint, otherwise to the left edge.

**Close triggers:** click anywhere on the document, scroll the `.scrollable` container, or press **Escape**. The Escape listener is added in the same `useEffect` as the click listener and cleaned up together. The player panel ⋮ button additionally **toggles** — clicking it while the menu is open closes it (via `if (trackMenu) { setTrackMenu(null); return; }` before the open logic, with `stopPropagation` preventing the document click listener from double-firing).

## IPC channel surface (`electron/preload.cjs` ↔ `electron/main.js`)

- `fs:readFiles` — opens a native file/folder picker, parses any audio files found.
- `fs:parseFiles` — parses an explicit list of paths (used for drag-and-drop from Finder). Both are index-aware: a path whose mtime matches its cached index entry is served without touching `music-metadata`.
- `fs:readArtwork` — returns the file's full-resolution embedded artwork as a base64 data URL (or `null`), behind a small LRU keyed `path::mtime`. **The only consumers are Now Playing and the Tag Editor** — library track objects never carry base64 (see "Metadata index, thumbnails, play stats" below).
- `stats:recordPlay` — increments `playCount` + stamps `lastPlayed` for a path; returns the new stats. The renderer calls it when the current track crosses 50% (once per listen-through — the guard re-arms below 25%, so repeat-one loops count again but mid-track scrubbing never double-counts).
- `library:updated` (main→renderer) — background reconciliation pushes after the instant cached load: `{ updated: Track[], removed: string[] }`. The renderer merges updates by filePath and routes removals through `removeTracks`.
- `reindex:progress` (main→renderer) — `{ done, total }` while a background (re)index runs (only emitted when >20 files need parsing); surfaces as a toast.
- `fs:writeTag` — writes tags, cover art, and lyrics back to disk. The handler routes by file extension:
  - **`.mp3`** — `node-id3` path (unchanged). Renderer sends `picture` (base64 data URL or `null`) and `lyrics` (string or `null`); handler maps these to `node-id3`'s `image`/`unsynchronisedLyrics` shapes. **`picture: null` means explicit removal** — detected via `'picture' in tags && tags.picture === null`, then handled with `NodeID3.read` + `delete existingTags.image` + `NodeID3.write` because `node-id3` 0.2.x can't remove individual tags via `update`.
  - **`.flac`** — `writeFlacTags()` in `main.js`: pure-JS FLAC metadata block rewriter. Reads the file, parses the block chain, drops old `VORBIS_COMMENT` (type 4) / `PICTURE` (type 6) / `PADDING` (type 1) blocks, writes fresh ones, appends 8KB padding, then appends untouched audio data (never touched). Maps: `year → DATE`, `lyrics → LYRICS`, `albumArtist → ALBUMARTIST`; empty/null fields are omitted (not written as empty strings). **Leading ID3v2 header stripping:** some encoders (Picard, iTunes) prepend a non-standard ID3v2 tag before the `fLaC` marker. `writeFlacTags` detects this (bytes 0–2 === `ID3`), computes the ID3v2 block size from the synchsafe integer at bytes 6–9 (plus 10-byte footer if flag `0x10` is set), skips past it to find `fLaC`, and omits the ID3 header from output — Vorbis Comment is the correct FLAC metadata container. The block parser has a `if (pos + 4 > file.length) break` bounds guard before `readUIntBE(pos+1, 3)` to prevent `RangeError` on malformed files. Writes directly to `filePath` via `fs.writeFile` (not a sibling temp file) — creating a new `.swtmp` file in the same directory requires directory-level write permission that macOS may not grant for protected folders (Desktop, etc.), while overwriting an existing file only needs file-level permission.
  - **`.wav`** — `writeWavTags()` in `main.js`: uses `NodeID3.create()` to build an ID3 payload buffer (no file I/O), then splices/replaces the `id3 ` RIFF chunk in the WAV structure without touching audio chunks. Writes directly to `filePath` via `fs.writeFile` (same rationale as FLAC — no sibling temp file).
  - Other formats (OGG, M4A, AAC) — returns `false`; "Edit Tags…" context menu item is disabled for these in the renderer.
- `fs:writeTag` returns `{ success, thumb }` (the renderer tolerates a legacy `true`). On success the handler also syncs the index entry (new field values + fresh mtime, so the next launch serves them without a re-parse), regenerates or removes the thumbnail, and invalidates the artwork LRU for that path.
- `fs:revealInFolder` — calls `shell.showItemInFolder` to reveal a file in Finder.
- `fs:checkPaths` — takes `string[]` of file paths, returns `boolean[]` (true = file accessible). Used for missing-file detection (see below).
- `library:load` / `library:save` — session state (`{ trackPaths, currentTrackPath, currentTime }`) in `userData/library.json`, format unchanged. **`library:load` is also where a file-open launch is arbitrated** — see "Launch behavior" above; its return adds `autoPlay` and `failedOpenCount`. On a normal launch it returns **instantly**: every path is served from the metadata index (unknown paths get a renderable placeholder with `pending: true` and a filename-derived title), then a background pass stats all paths, re-parses only new/mtime-changed files, drops missing ones, and patches the renderer via `library:updated` / `reindex:progress`. This is also the migration path for pre-index installs: first launch serves placeholders and heals in the background.
- (There is **no** native right-click menu IPC. Earlier revisions of this file listed `show-track-context-menu` / `context-menu-command` / `remove-tracks` / `play-next-tracks` / `show-now-playing-menu`; none of those channels exist in `main.js` or `preload.cjs`. The context menu is the renderer-side `trackMenu` dropdown described above.)
- `open-external-url` (renderer→main) — opens a URL in the default browser via `shell.openExternal`.
- `open-external-file` (main→renderer) — `{ tracks, failedCount }`, fired when a file is opened via macOS "Open With" or double-click **while the app is already running**; the renderer replaces its whole library with it (see "Launch behavior" above). A cold launch never uses this channel — it resolves inside `library:load` instead.
- `clipboard:readImage` (renderer→main) — reads an image from the system clipboard via `clipboard.readImage()`; returns a base64 data URL string or `null` if the clipboard holds no image.
- `clipboard:writeImage(dataUrl)` (renderer→main) — writes a base64 data URL to the system clipboard via `nativeImage.createFromDataURL()` + `clipboard.writeImage()`.
- `menu-select-all` (main→renderer) — fired by the Edit > Select All menu item; see "Custom application menu" below for why this exists as an IPC round-trip instead of a plain renderer keydown listener.
- `open-tag-editor` (renderer→main, invoke) / `tag-editor:load` (main→renderer) / `tag-editor:saved` (main→renderer) / `tag-editor:resize` (renderer→main, fire-and-forget) — the Tag Editor window's IPC surface; see "Tag Editor" below.
- `service-action` (main→renderer) — `{ action: 'add-to-queue' | 'play-next', tracks }`. An alternate delivery channel for the same file-open pipeline as `open-external-file`, used when the trigger was a Finder Services menu entry rather than a double-click/Open With. Deliberately a separate channel: Services *queue*, a double-click *replaces*. See "Finder Services integration" below.

The "add files when queue is non-empty" prompt is a **renderer-side confirm modal** (`.confirm-modal-panel` in `index.css`, rendered in `App.jsx`) — there is no `dialog:askQueueAction` IPC channel.

Metadata parsing (`parseFilePaths` in `main.js`) runs through a small hand-rolled bounded-concurrency pool (`mapWithConcurrency`, limit 8) rather than sequentially — preserves original file order (pre-sized results array indexed by position) while parsing in parallel.

## Launch behavior: what library the app starts with

Three ways in, three outcomes. `electron/main.js` decides all of them — the renderer never arbitrates.

| Trigger | Result |
| --- | --- |
| Finder double-click / "Open With" | The opened files **replace the entire library** and the first (by file name) starts playing. No confirm dialog. Persists like any other library change — the previous library is overwritten in `library.json` and is not recoverable. |
| Dock / Launchpad launch | Saved session restores, current track paused at its saved position. |
| Finder Services | Saved session restores, then the files are appended/inserted. Playback is untouched. |
| Drag-and-drop, or sidebar "Add Files" | Confirm modal (Play / Play Next / Add to Queue / Cancel) when the library is non-empty; straight to playing when it's empty. **This is the only surviving use of that modal.** |

**`library:load` is the single arbitration point.** It resolves the whole question and returns one already-correct answer, rather than letting the renderer restore the saved session and then having an `open-external-file` push wipe it. That older shape raced (the instant index-backed restore always won, so every double-click hit the confirm modal), flashed the old library on screen, and started a background verify over every path it was about to discard. The payload gained two fields: `autoPlay` (true only for a file-open launch — a restored session must come back paused) and `failedOpenCount`.

**Never return an empty library on a failed open.** If every opened file fails to parse, `library:load` falls through to the saved session and reports `failedOpenCount`; the renderer toasts. Returning `{tracks: []}` and letting the file-open push fill it in later is wrong — the renderer's 500ms debounced save would persist the emptiness, permanently, before the files arrived.

**Batch settling.** macOS fires one `open-file` per file with no ordering guarantee. A batch opens on the first event and settles `OPEN_FILE_SETTLE_MS` (100) after the last; both consumers wait for that settle, so neither ever sees a partial selection. Paths are then sorted by file name (`sortByFileName`, `electron/launchFiles.mjs`) so "the first track" is deterministic.

**`libraryLoadServed` is load-bearing — do not remove the guard in `flushOpenFiles`.** `did-finish-load` force-flushes any pending batch (it has to: `webContents.send` doesn't queue, so a batch that settled before the page loaded would be lost). But that flush fires *while* `library:load` is still awaiting the same batch, and stole it — verified live, the cold-launch path silently fell back to the session with `flushOpenFiles` count 1. The fix is explicit precedence, not another timing tweak: a pending batch belongs to `library:load` until it has served the renderer, at which point `loadLibraryState`'s `finally` hands the claim back and re-triggers the flush (which is how a **Services** batch — deliberately not consumed by `library:load` — still gets delivered). A 3s safety net in `did-finish-load` releases the claim if the renderer never asks for its library at all.

**`replaceLibraryWith` (`App.jsx`)** is the single renderer-side "this is your library now" path, shared by the file-open push and the modal's Play. It clears `playbackHistory` and `forcedNextQueueRef` — both hold `filePath`s, and those tracks cease to exist the moment the library is swapped (`playPrev` would otherwise jump to a track that isn't in the list). It also clears `homeDetailItem` and lands on Library, **except** in Now Playing, which stays put because it simply swaps to the new track and still reads correctly.

**Nothing slow sits in front of the window.** `app.whenReady()` kicks off the index load and creates the window without awaiting it; the Finder Services install is fire-and-forget *after* `createWindow()` (an install only affects the Finder menu from the next launch onward, so nothing on this launch depends on it). Measured: the index load is ~4.5ms at 2k tracks, ~18ms at 10k, ~37ms at 20k (12.9MB) on a warm cache; the first-run services install ~3ms. Modest, but it was all pure blocking before the window existed.

**Every path that reads the metadata store must `await ensureStoreLoaded()` first** — `parseFilePaths`, `resolveInitialLibrary`, `verifyLibraryInBackground`, `stats:recordPlay`, `syncIndexAfterTagWrite`. This is not a subtle correctness issue: an unloaded store reports every path as unknown, so `library:load` serves `pending: true` placeholders for the *entire* library and kicks off a full background reindex of files that were already indexed. The smoke suite asserts a restored session carries real metadata rather than placeholders, which catches that symptom — though note it can't catch a missing await on its own, since by then the store has always finished loading anyway. Treat the await as the invariant; the assertion is a backstop.

**Testing the cold-launch path.** macOS only delivers `open-file` to an app it has registered, so this is invisible to `npm run dev`. `electron . --open-file=<path>` (dev/unpackaged only) seeds the same batch the real Apple Event would. Combined with `--smoke` it runs a dedicated cold-launch assertion set — including that `flushOpenFiles` was never reached — and exits:

```
npx vite build && npx electron . --smoke --open-file=/tmp/a.mp3 --open-file=/tmp/b.mp3
```

The seeded cases in the main smoke run (`seedOpenFileBatch`) inject an *already settled* batch, which deliberately bypasses that ordering — they cover arbitration logic, not launch sequencing. Both are needed.

## Finder Services integration ("Add to Queue" / "Play Next")

Selecting audio files in Finder and right-clicking → Services offers **"Add to Queue in Sonus"** and **"Play Next in Sonus"**. Both restore the saved session and then queue the files — appending, or inserting after the current track — with no confirm dialog and **without changing what is playing**. (A double-click on the same files does something entirely different: it replaces the library outright. See "Launch behavior" above.) Both are installed **by the app itself**, with no manual user setup — a hard requirement, since this machine only has Command Line Tools (no full Xcode), ruling out a real native `NSServices` provider compiled into the app bundle.

**Mechanism:** a Service doesn't have to be answered by Sonus's own native code — macOS's own Automator runtime can answer it. Each bundle in `electron/resources/services/` is a hand-authored Automator "Service" (`Info.plist` declaring `NSServices` with `NSMessage: runWorkflowAsService` and `NSSendFileTypes: [public.audio]`, plus `document.wflow` — Apple's verbose plist schema for a single "Run Shell Script" action). No compilation step; they ship as static resources (`package.json`'s `build.extraResources`: `electron/resources/services` → `services` in the packaged app) and are copied into `~/Library/Services/` from `app.whenReady()`. Packaged-only (`app.isPackaged` guard — dev mode has no installed `.app` for `open -a "Sonus"` to target, and writing into the user's real `~/Library` as a side effect of `npm run dev` isn't appropriate).

**Install policy is versioned, not first-launch-only** (`installFinderServices` / `serviceInstallAction` in `electron/finderServices.mjs`, Electron-free and unit-tested against temp dirs). A `services-installed.json` marker in `userData` records which version of each bundle was installed:

| Bundle on disk | Marker | Action |
| --- | --- | --- |
| absent | no record | install (first run) |
| absent | has record | **skip** — the user deleted it; that choice isn't fought, even across version bumps |
| present | stale or no record | overwrite |
| present | current | skip |

The "present + no record" row is the migration case: v1 shipped without a marker, so an existing bundle gets replaced. **Bump `SERVICES_VERSION` whenever a shipped bundle's contents change**, or existing installs keep a stale copy forever. The directory is scanned rather than the bundles being named, so adding a third Service later needs no code change here. Installs replace wholesale (`rm` then `cp`) rather than copying over — otherwise a file dropped in a newer version would survive on disk.

**The flag file — how "queue, don't replace" crosses the process boundary:** each Service's shell action is `mkdir -p "$HOME/Library/Application Support/Sonus" && printf '<action>' > ".../service-action.flag" && open -a "Sonus" "$@"`. `open -a` can only pass file paths through the OS `open-file` Apple Event; there's no channel for "and queue these instead of replacing the library". The flag is that channel — written to the same `userData` directory Sonus already uses for `library.json`. It is read **once per open-file batch** (`getBatchAction()`) and deleted on every read, and ignored if older than 5 seconds — generous for launch/wake latency, tight enough that a stale flag can never leak into an unrelated later double-click. Only the two known action names are accepted; anything else is treated as no flag.

**Read-once matters:** both `library:load` (deciding whether this is a file-open launch) and `flushOpenFiles` (delivering the batch) need the answer, and reading consumes it. The promise is memoised per batch and reset when the next batch opens.

**The legacy flag is still honoured.** The pre-2.0 bundle wrote `service-add-to-queue.flag` (a bare `touch`, no action name). It's mapped to `add-to-queue` because the installer can only update that bundle *at launch*: a user who triggers the old Service before ever launching the new build would otherwise fall through to the file-open path and **have their library replaced**. Both flag files are consumed on every check so a stale one can't fire later. Safe to delete once every install has launched at least once.

**Delivery:** `flushOpenFiles` sends `service-action` (`{ action, tracks }`) instead of `open-external-file`. A Services batch is deliberately *not* consumed by `library:load` — it falls through to the saved session, and `loadLibraryState`'s `finally` hands the claim back so the batch is delivered once the renderer has a library to apply it to. `App.jsx`'s `queueTracksFromService` dedupes by `filePath`, and for `play-next` also unshifts onto `forcedNextQueueRef` — repositioning rows alone isn't enough, since shuffle ignores list position entirely.

## Metadata index, thumbnails, play stats (`electron/indexStore.mjs` + `main.js`)

The scale architecture: **no full-resolution base64 artwork ever lives in renderer heap.** Three persistent stores in `userData`, all plain JSON (no native deps — `indexStore.mjs` isolates storage so a future SQLite swap is contained):

- **`library-index.json`** — parsed metadata per filePath (`{ version, tracks: { path: { …fields, mtimeMs, dateAdded, thumb } } }`). Debounced 1s, written atomically (temp + rename — fine in userData; *never* copy this pattern to `fs:writeTag`, which deliberately writes music files in place for macOS permission reasons). A version mismatch or corrupt file just means an empty index → background reindex.
- **`play-stats.json`** — `{ path: { playCount, lastPlayed } }`, kept **separate** so bumping a play count never rewrites the big index. Debounced 2s. Both stores flush on `before-quit`.
- **`thumbs/`** — one ≤300px JPEG (q70) per track, named `sha1(filePath)`, sharded by first 2 hex chars, written by `writeThumb` in `main.js` via `nativeImage` (if Chromium can't decode the source — WebP/GIF embeds — the original bytes are stored untouched with their real extension). Served by the privileged `sonus-thumb://art/<sha1>.<ext>?v=<contentHash8>` protocol; the `?v=` busts the renderer's HTTP cache when art changes. The scheme **must** keep `corsEnabled: true` in `registerSchemesAsPrivileged` — without it renderer `fetch()` of thumbnails is refused outright regardless of response headers (`<img>` would still work, but `fast-average-color` fetches).

Track objects carry `thumb` (a tiny URL string) + text metadata + `dateAdded` (birthtime on first index / reindex, `Date.now()` for user-initiated adds — preserved across re-parses) + `playCount`/`lastPlayed`. Rows, the player bar, Home cards, and `fast-average-color` all use `thumb` directly; **`mediaSession` artwork is a `blob:` URL fetched from the thumb** (`MediaImage` rejects custom schemes — passing `sonus-thumb://` logs an error and shows no art in the macOS now-playing widget; the previous blob URL is revoked on replace via `mediaArtUrlRef`); **Now Playing and the Tag Editor** load full-res on demand via `fs:readArtwork`, showing the thumbnail upscaled until it resolves. The Tag Editor **blocks Save while its full-res load is pending** (`editArtLoading`) — the WAV writer rebuilds the whole tag chunk, so saving early would silently strip embedded art.

## Artwork normalization and repair (`electron/artwork.mjs`)

`music-metadata` returns artwork in `metadata.common.picture[0]` as `{ format, data }`. `normalizePicture` (pure, unit-tested — no Electron imports) handles three classes of corruption; `pictureToDataUrl` wraps it for `fs:readArtwork`:

1. **Bare extension format strings** — some taggers write `"jpg"` instead of `"image/jpeg"`. Normalized via a lookup table; `"image/jpg"` is also corrected to `"image/jpeg"`.
2. **BMP format** — skipped entirely (set to `null`). Uncompressed BMP embeds can be 500KB+; Chromium renders them poorly as blobs.
3. **Apple Music/iTunes APIC header stripping** — Apple's ID3 writer produces APIC frames where `music-metadata` strips leading bytes from the image header. Two variants:
   - **JPEG:** first 5 bytes (`FF D8 FF E0 00`) missing. Detected by checking that bytes 1–4 equal `JFIF` (`4A 46 49 46`). Fix: prepend `Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00])`.
   - **PNG:** up to 9 bytes missing (8-byte PNG signature + first byte of IHDR chunk length). Detected by finding `IHDR` (`49 48 44 52`) within the first 16 bytes at offset > 0. Fix: prepend `PNG_PREFIX.slice(0, 12 - ihdrOffset)` where `PNG_PREFIX` = PNG signature + `00 00 00 0D` (IHDR chunk length). Formula works for any prefix length 1–11.
   
   Both checks only run when the format is the correct type but the leading magic bytes are wrong — they will not trigger on legitimately valid images.

## Custom application menu (`buildAppMenu` in `main.js`)

`main.js` calls `Menu.setApplicationMenu()` with a hand-built template instead of leaving Electron's auto-generated default menu in place. This exists for exactly one reason: **Cmd+A**. Electron's default menu binds Edit > Select All to `role: 'selectall'`, and that role's accelerator is handled natively, before the keystroke ever reaches the renderer — a `window.addEventListener('keydown', ...)` listener (the pattern used for Backspace/Delete in `App.jsx`) never sees it. Reassigning `.click` on the existing role-based `MenuItem` also does not work — the native role behavior still wins. The only fix is rebuilding the whole menu from scratch with that one item changed to a plain `accelerator + click` (no `role`), which sends `menu-select-all` over IPC to the renderer.

Everything else in the template (`role: 'appMenu' | 'fileMenu' | 'editMenu' | 'viewMenu' | 'windowMenu'`, plus Substitutions/Speech submenus) replicates Electron's default exactly, so Quit/Hide/Cut/Copy/Paste/Undo/Redo/DevTools/zoom/fullscreen etc. are unaffected. If you ever need another `role: 'selectall'`-style override, this is the only place it can go — don't try to patch the default menu instead.

In `App.jsx`, the `onSelectAll` handler checks `document.activeElement` first: if a text `<input>`/`<textarea>` is focused, it calls the native `.select()` on it (replicating what the role used to do for in-field select-all, e.g. in the Tag Editor); otherwise it routes to `activeSelectionRef.current?.selectAll()` — the Library's or the open detail view's selection, whichever is on screen (see "Tracklist engine"). This check is required — without it, removing `role: 'selectall'` would silently break Cmd+A-to-select-text inside the Tag Editor's inputs.

## Vibrancy and forced dark mode

`nativeTheme.themeSource = 'dark'` is set immediately after `app.setName('Sonus')` in `main.js`. This forces macOS's `under-window` vibrancy material to always render the dark variant, regardless of the user's system Light/Dark Mode setting. Without it, opening the app in Light Mode (or with light content behind the window) makes the vibrancy material go medium-gray — white text in Now Playing appears gray against it regardless of any CSS changes. Don't remove or comment out this line.

## Artwork-derived color (`artworkRgb` / `bgColor`)

`App.jsx` extracts a single dominant color from the current track's cover art via `fast-average-color` (`FastAverageColor.getColorAsync` on **`currentTrack.thumb`** — the 300px thumbnail is plenty for an average color and avoids touching full-res; in the same `useEffect` that sets `mediaSession` metadata on `currentTrack` change) and stores it as `artworkRgb` (`{ r, g, b }`, `null` when there's no artwork). It drives exactly three things, all unconditional (not gated to Now Playing):
- **`bgColor`** — the app's background tint, `rgba(r, g, b, 0.5)`, applied to `.app-container` everywhere.
- **Now Playing's ambient "blur furnace"** — three blurred, independently-animated circles behind the artwork (`np-flare-1/2/3` keyframes) tinted with `artworkRgb`, paused when playback is paused.
- **Now Playing's artwork glow** — the `boxShadow` around the artwork card and the radial glow behind it.

That's the full extent of artwork-color usage. Now Playing's own text and transport controls, and the Player Panel's transport controls (Skip/Play/Skip/Volume/Repeat/Shuffle) everywhere else, are all fixed `var(--text-primary)`/static colors — **not** tinted by artwork. This was tried for the Player Panel controls specifically (matching the artwork's hue) and explicitly reverted: it made the icons hard to see against some album art, and always-white was preferred. Don't reintroduce per-track icon tinting there without raising it again — CSS has no load-bearing hook for it (`--np-slider-color` in `index.css`'s `.wow-slider` rule is dead — nothing sets it; it always renders its hardcoded fallback gradient).

## Now Playing glass backdrop — contrast guarantee

The Now Playing overlay has a full-panel glass div with `zIndex: 5`, `background: 'rgba(0,0,0,0.55)'` and `backdropFilter: 'blur(40px)'`. The 55% black overlay is **not a stylistic choice** — it was pixel-verified (Python PIL against native `screencapture` output) to produce ~RGB(35,35,35) behind text, giving a **14.7:1 contrast ratio** (WCAG AAA = 7:1). Don't reduce this value without re-running pixel verification with bright warm artwork.

## Now Playing artwork sizing

The NP left column shows only the artwork (no title/artist/album text — those are always shown in the player panel instead). `--np-scale` controls the artwork square size:
- Without lyrics open: `min(calc(100vw - 152px), calc(80vh - 100px), 640px)`
- With lyrics open: `min(calc((100vw - 152px) / 2 - 48px), calc(80vh - 190px), 410px)`

The vertical budget (`80vh - 100px`) is intentionally larger than when text was present — the freed text block height (~110px) goes directly to the artwork. Artwork `marginBottom` is `0` (no text below).

## Volume control

**Vertical popup, not an inline slider.** Hovering the mute button (a `position: relative` wrapper with `onMouseEnter/Leave` driving `isVolumeOpen`) pops up a vertical bar flush above it — `.volume-popup` (`position: absolute, bottom: 100%`), containing a small glass pill (`.volume-popup-track`, matching the app's other glassmorphic surfaces) around a rotated `<input type="range">` (`.volume-slider--vertical`, `transform: rotate(-90deg)`). This replaced an earlier inline horizontal slider that opened as a flex sibling next to the mute button — that approach grew the right cluster's *measured* width on hover, which (via `centerBlockStyle`'s reserved/offset math, below) shrank the center title/subtitle block for as long as the user was adjusting volume. A `position: absolute` popup doesn't participate in flex layout, so `rightClusterWidth` — and therefore the center block's size — stays constant regardless of hover state, at any window width.

**Rotation mechanics:** CSS `transform` doesn't resize an element's own layout box, so the `<input>` keeps its original (unrotated) `width`/`height` and is wrapped in a container sized to the *post-rotation* footprint. The `wow-slider` track gradient (`background: linear-gradient(to right, ...)`, `index.css`) is defined in the element's local space — rotating `-90deg` maps left→bottom and right→top, so the filled portion ends up at the bottom and grows upward as volume increases, and dragging up/down maps to the expected value change. Chromium correctly inverse-transforms pointer coordinates for hit-testing transformed form controls, so this is a reliable, well-established technique for vertical range inputs, not just a visual trick (verified: setting `--progress` for a given value renders the fill at the correct height; the rotation matrix computes to exactly `matrix(0, -1, 1, 0, 0, 0)` for `-90deg`).

**Two load-bearing gotchas, both from a real historical bug and its sequel:**
1. **Zero gap between the button and the popup.** `mouseleave` fires when the pointer is over no rendered pixel belonging to the listening element or any of its descendants — this is true *regardless of DOM nesting*, so an earlier "pill positioned above the button" attempt (documented, now superseded by this one) was reverted because a geometric gap between the button and the pill broke the hover chain. The fix: the popup must be a **DOM descendant of the same hover-listening div** the button lives in (not a sibling, not a portal), positioned **flush** (`bottom: 100%`, no gap) — `.volume-popup`'s `padding-bottom: 10px` is a hit-test buffer, not a visual gap.
2. **`z-index: 7` on `.volume-popup` is load-bearing.** The seek bar's wrapper (see "Player panel layout" below) has an explicit `zIndex: 6` and a negative `marginTop` that extends its own hover zone *above* the panel edge — that strip geometrically overlaps the volume popup's upper portion. Without a higher z-index, the seek bar wins the local stacking comparison (both are z-indexed descendants within the same player-panel stacking context) and silently intercepts hover/pointer events in the overlap band, reproducing the exact same class of bug as gotcha #1 for a completely different reason. Confirmed live via `document.elementFromPoint()` hit-testing during development — the symptom looked identical to a gap bug (hover closing partway up the popup) but the geometric gap was genuinely zero; the real cause was paint order, not distance.

## Lyrics feature

**Storage:** lyrics are read from the file via `music-metadata` and mapped to `common.lyrics[0]` (an object `{ language, descriptor, text }` — always use `.text`). Supported formats: MP3 (USLT ID3 frame), FLAC (`LYRICS` Vorbis Comment), WAV (USLT ID3 frame in `id3 ` RIFF chunk). `parseFilePaths` in `main.js` reads lyrics for `.mp3`, `.flac`, and `.wav`; all other formats get `null`. Written back via `fs:writeTag` — each format's writer handles the appropriate container (see IPC surface above).

**Tag Editor:** a `<textarea>` (`flex: 1`, `resize: none`) lives in the right column of the Tag Editor layout (see Tag Editor section below), rendered for `.mp3`, `.flac`, and `.wav` files. RTL detection: `teaLyricsIsRTL = isRTL(editTags.lyrics || '')` (reuses the module-level `isRTL()` function, reactive to every keystroke). When true, applies `direction: rtl, textAlign: right` to the textarea — right-alignment is standard for RTL text input (cursor starts at the right edge).

**Now Playing lyrics panel:** a two-layer structure to the right of the artwork column:
- **Outer div** (`position: relative`, width transitions `0% ↔ 50%` with cubic-bezier) — owns the `lyrics-open-btn` toggle button (positioned absolutely at `right: 16px`). This div is NOT `overflow: hidden`, which is critical: the button must not be clipped by the transition animation.
- **Inner div** (`position: absolute, inset: 0, overflow: hidden`) — owns the scrollable lyrics content. Opacity fades in after the width transition starts (`transition-delay: 0.1s`).
- The toggle button (`.lyrics-open-btn`) shows `ChevronRight` to open, `ChevronLeft` to close; both states are the same button at the same position. A pulsing glow animation (`.lyrics-btn-glow`) runs when the track has lyrics and the panel is closed, as a discoverability hint; the animation stops (`lyrics-open-btn--open` class) once open.
- `isLyricsOpen` state resets on track change via a `useEffect`. `lyricsScrollRef` scroll position resets on `currentTrack.filePath` change.

**RTL language detection:** `isRTL(text)` (module-level in `App.jsx`) counts Hebrew (`֐–׿`) and Arabic (`؀–ۿ`) characters against total letter count using `\p{L}` (Unicode property escapes). Returns true when RTL characters exceed 30% of letters. `lyricsIsRTL` is derived from `currentTrack?.lyrics` and applied as `direction: rtl` + `textAlign: center` on the lyrics label and text divs. `direction: rtl` ensures correct bidi character rendering; `textAlign: center` keeps RTL lines centered in the panel rather than hugging the right edge (which looked cramped). The scroll container padding is the same for both directions (`'24px 16px 24px 32px'` — 32px left for breathing room from the divider).

## Background playback / window lifecycle (macOS-specific)

Clicking the red close button hides the window (`event.preventDefault(); mainWindow.hide()`) rather than quitting, so the `<audio>` element keeps playing — matches native macOS media-player behavior. Real quit only happens via `Cmd+Q` (`before-quit` sets a `forceQuit` flag the `close` handler checks). The dock icon's `activate` event re-shows the hidden window.

## Tag Editor — a separate window, not a `view`

Unlike Library/Home/Now Playing (all `view` values inside the single main-window renderer), the Tag Editor is its own singleton `BrowserWindow` (`electron/main.js`'s `createTagEditorWindow`), loading the *same* Vite bundle as the main window but with a `?editor=1` query flag — `src/main.jsx` reads that flag and mounts `<TagEditorWindow/>` instead of `<App/>` (same pattern the `?test=1` smoke-test gate already used, so no second Vite entry point/build target was needed). `view` in `App.jsx` never has a `'tag_editor'` value.

**Opening it:** the "Edit Tags…" context-menu item (Library rows and Now Playing's ⋮ menu) looks up the full track object from `library` and calls `window.electronAPI.openTagEditor(track)` → `open-tag-editor` IPC → `createTagEditorWindow(track)`. Singleton: if the window is already open, it's focused and sent the new track (`tag-editor:load`) rather than opening a second window. Fixed width (960), not resizable by the user — deliberately decoupled from the main window's own size. Height auto-fits to content; see "Auto-fit height" below.

**Receiving its track:** `TagEditorWindow.jsx` has no `library` state of its own (separate renderer process) — the full track object is passed over IPC (`onTagEditorLoad`), not just a filePath. A `loadedPathRef` guard (comparing `track.filePath`) resets `editTags`/`artworkSelected`/search state whenever a genuinely different track arrives, including a second "Edit Tags…" invocation while the window is already open.

**Saving:** `saveTags()` in `TagEditorWindow.jsx` only calls `window.electronAPI.writeTag(...)` and sets local `saveStatus` — it has no `library`/`currentTrack`/`<audio>` to update itself. `fs:writeTag`'s handler (`main.js`) broadcasts `tag-editor:saved` to the **main** window after every successful write, regardless of which window called it; `App.jsx`'s own `onTagSaved` listener is what merges the change into `library`/`currentTrack` and — if the edited track is the one currently playing — reloads `<audio>` and resumes playback position (this logic used to live inline in the old `saveTags()`, now lives here instead). One behavior difference from the old inline version: it used to pass the just-edited full-res picture straight to `npArtwork` to skip a refetch; the cross-process version doesn't have that data in the main window, so it just lets the existing `npArtwork` effect (keyed on `currentTrack.thumb`) refetch via `fs:readArtwork` when the thumb changes — a trivial, already-LRU-cached cost for the architectural simplification.

**Scrolling — a real gotcha hit building this:** the scroll container needs `overflowY: 'auto'` on a bounded height (the form is reliably taller than the fixed window), but that alone wasn't sufficient — real mouse-wheel/trackpad scrolling felt broken even though `scrollTop` was settable programmatically. Root cause: `index.css`'s `body { -webkit-app-region: drag }` (how the frameless window becomes draggable by its background) is inherited by any descendant unless explicitly opted out via the `button, input, textarea, a, .clickable, .scrollable { -webkit-app-region: no-drag }` rule, and the div wasn't in that allowlist. Fixed by giving it `className="scrollable"` (reusing the exact class the main window's own scroll container already relies on for this same reason). A `drag` region silently breaks real wheel/gesture scrolling, not just clicks — if you ever add another top-level scrollable region in either window, it needs this too.

**Dragging the window — a second gotcha, caused by the first fix:** giving the root wrapper `className="scrollable"` (above) fixed scrolling but broke window dragging — `.scrollable` opts out of `-webkit-app-region: drag`, and since that div was `height: '100vh'` (the *only* element in the window, with `.glass-panel` as its sole child), it covered 100% of the window's surface, leaving no background pixel anywhere still eligible for `body`'s draggable region. Fixed the same way the main window avoids this: the actual root is now a plain (unclassed) `height: '100vh'` flex column, containing a 42px empty drag strip followed by the `.scrollable` content div (`flex: 1` instead of `height: '100vh'`, `padding: '0 32px 32px'` instead of `'42px 32px 32px'` — the top 42px moved from padding-on-the-scrollable-div to a separate sibling strip, so total spacing above the content is pixel-identical). This exactly mirrors `App.jsx`'s own `.app-container { padding-top: 42px }` — a full-width strip above the sidebar/glass-panel that stays part of `body`'s drag region because nothing there is `.scrollable`/`.clickable`. Any new top-level `.scrollable` region that fills 100% of a window's surface will reproduce this bug — it needs a plain, unclassed sibling strip carved out above it.

**No back/breadcrumb header** — unlike the old inline version's `‹ [origin]` breadcrumb, the standalone window has nothing to navigate "back" to; closing it (red traffic light or Cmd+W) is the only dismissal, and does so silently discarding any unsaved edits (matches the old inline behavior — no confirmation dialog). It sets `document.title = 'Edit Tags'` so the Dock/Window menu shows something distinct from "Sonus". It has its own `onSelectAll` listener (native `.select()` on the focused input) since `menu-select-all` is sent to whichever `BrowserWindow` is currently focused — Cmd+A works in either window independently.

**Window position — never rely on `BrowserWindow.center()`.** The window is created at a fallback height and only resized once the renderer reports the form's real height, and `setContentSize` **pins the top-left corner** — so without an explicit reposition the window's centre drifts by half the height change (measured ~67-82px too low for a tall form, and too high for a short one). `centerInWorkArea()` in `main.js` computes the position from `display.workArea` directly: Electron's own `center()` was measured placing an 857px window at `y=74` on a `1728x1020` work area where the centre is `y=114`, i.e. ~40px high. The smoke suite asserts both axes land within 2px.

Re-centring happens on first show, and thereafter only if the fitted height moves by more than `TAG_EDITOR_RECENTER_DELTA` (100px), so a window the user dragged somewhere is not yanked back each time another track is loaded into it. **In practice that threshold never fires**: the form's height is the same with and without the Lyrics column (measured: 857px both ways), because the two columns stretch to whichever is taller and that is always the left Track Info column. It is a guard for future layout changes, not something that triggers today. `keepWindowOnScreen()` handles the non-centring case so a resize can't push the window off the bottom.

**Auto-fit height:** the window's height is fit to the form's actual content instead of a hand-picked constant, but width stays fixed at 960 (the two-column Track Info/Lyrics layout is tuned for that width — see "Layout" below). Mechanism: `TagEditorWindow.jsx` refs the `.scrollable` content div (`scrollableRef`) and tracks a `loadedTrackKey` state that's set once per genuine track load, batched into the *same* React commit as the `setEditTags(...)` call in the track-load effect — so a separate `useLayoutEffect` keyed on `[loadedTrackKey]` alone is guaranteed to fire only after the form has actually re-rendered with the new track's data. That effect reads `scrollableRef.current.scrollHeight` (the natural, unclipped content height) and sends it over a new `resizeTagEditor` preload call → `tag-editor:resize` IPC (renderer→main, fire-and-forget `send`) → `main.js` clamps it (`Math.max(500, Math.min(contentHeight + 42, display.workAreaSize.height - 80))` — the `+42` accounts for the drag strip above `.scrollable`, described above) and calls `tagEditorWindow.setContentSize(960, clampedHeight, true)` (animated). **Critically, `loadedTrackKey` is never touched by anything except a genuine track change** — not by typing, not by the async artwork refetch, and not by "Search Online" populating `tagSearchResults` (which renders inline *inside* the same `.scrollable` div and pushes its `scrollHeight` well past the window's fixed height) — so none of those can ever trigger a resize; the extra content simply scrolls, exactly like before this feature existed. The window is created with `show: false` and only calls `.show()` inside the resize handler (guarded by `!isVisible()`, so it's a harmless no-op on later resizes from singleton reuse) — this avoids a flash at the old fallback `960×720` size before the fitted size is known. A 1.5s fallback timer after `did-finish-load` force-shows the window if `tag-editor:resize` never arrives, so a preload/renderer failure can never leave it permanently hidden.

**Layout (inside the glass panel, `padding: '16px 32px 32px'`):**
```
[Artwork 200×200] [Title / Artist / Album Artist / Album]

 Left col (flex: 1.4)            Right col (flex: 1, MP3/FLAC/WAV only)
────────────────────────────     ─────────────────────────────────────
── Track Info ──                 ── Lyrics ──
[Track N/M]  [Disc N/M]         [textarea — stretches full height]
[Year][BPM][Genre      ]
── Credits ──
[Composer] [Comment]
── Technical ──
[Bitrate] [File path + Finder]
```

Both columns use `display: flex, flexDirection: column, gap: 16`. The two-column body wrapper uses `alignItems: stretch, flexWrap: 'wrap'` — at narrow window widths the columns stack vertically (left column: `flex: '1.4 1 320px'`; right/Lyrics column: `flex: '1 1 180px'`). Left column has `overflow: 'hidden'` to contain the Technical grid's File row; the File cell itself needs `minWidth: 0` so the `1fr` grid track can shrink. Lyrics textarea has `minHeight: 200` so it stays usable when stacked. For non-MP3/FLAC/WAV files the right column is absent and the left column spans full width.

**Technical grid:** `gridTemplateColumns: 'auto 1fr'` — the Bitrate cell (`auto`) sizes to its content; the File cell (`1fr`) takes remaining space. Bitrate value div has `whiteSpace: 'nowrap'` so "320 kbps · CBR" never wraps regardless of column width. The Reveal-in-Finder button uses class `glass-button icon-only` (not `player-control-button`) to avoid the 42px min-width that previously caused the button to overflow into the Lyrics column.

**Search results** (from "Search Online") render as a **centred overlay**, not inline. They used to sit below the form in the same glass panel, which inflated its `scrollHeight` past the window's fixed height so the results could only be reached by scrolling. As an overlay they need no resize at all — the window height is untouched.

- Opens the moment the search starts, so the spinner, any error, and the results all appear in one place; `tagSearchError` no longer renders beside the action buttons.
- Reuses `.confirm-modal-backdrop` / `.confirm-modal-panel` so it matches App's confirm dialog. Closes on ✕, Escape, or after picking — **not** on backdrop click. Closing is blocked while `pickingResult !== null`, since that fetch is still writing into the fields.
- **`WebkitAppRegion: 'no-drag'` on the backdrop is load-bearing.** `index.css` makes the window draggable by its background and children inherit it, so without this the panel's background would drag the *window* while its buttons still worked — a half-broken state rather than an obvious break. The smoke suite asserts the computed value.

**Result limits and de-duplication** live in `src/tagSearch.js` (a separate module so `TagEditorWindow.jsx` only exports a component, which Fast Refresh requires). `SEARCH_FETCH_LIMIT` (50) is the pool requested from the API; `SEARCH_MAX_RESULTS` (10) is what's shown.

`dedupeSearchResults` drops only *exact* repeats — identical title, artist, album **and** year — so different releases of the same song survive, which is the point when tagging. Two ordering rules matter: it runs **before** the list is truncated (de-duplicating an already-sliced 10 would leave fewer than 10 and quietly undo the limit), and it keeps the **first** occurrence so each API's relevance ranking is preserved. Fields are joined with `\u0000` rather than a space, or `"a b"|"c"` would collide with `"a"|"b c"`. Unit-tested in `src/tagSearch.test.js`; the smoke suite additionally drives the popup through a `?test=1` hook (`window.__sonusTagEditorTest`) so the suite never calls iTunes or MusicBrainz.

**Artwork interactions:** The 200×200 artwork square has `tabIndex={0}` and three interaction modes:
- **Single click / focus** → selects the artwork (`artworkSelected` state → `true`). CSS class `.tag-artwork--selected` adds an accent-colored `box-shadow` glow. Hint text below changes to `⌘C copy · ⌘V paste · double-click to change`.
- **Double click** → opens the hidden `<input type="file">` file picker.
- **⌘C** (while selected) → calls `electronAPI.writeClipboardImage(editTags.picture)` to copy the artwork to the system clipboard.
- **⌘V** (while selected) → calls `electronAPI.readClipboardImage()` and sets the result as `editTags.picture` if non-null. Works with screenshots and any clipboard image source.
- **Escape / blur** → deselects (`onBlur` guards with `e.currentTarget.contains(e.relatedTarget)` so clicking the X button inside the wrapper doesn't accidentally deselect).
- **X button** (`position: absolute, top: 8, right: 8` on the `position: relative` wrapper — NOT inside the `overflow: hidden` image div, to avoid clipping) removes artwork: sets `editTags.picture = null`, which signals explicit removal to the main process on save. `artworkSelected` resets to `false` whenever a new track loads (the `loadedPathRef`-guarded effect described above), so selection state never bleeds from one track into the next.

New artwork (from file picker, clipboard paste, or "Use this" online search) is stored as a base64 data URL in `editTags.picture`.

**"Search Online" auto-fill:** a renderer-side feature — no IPC beyond the normal `fs:writeTag`/`fs:readArtwork`. Works entirely via `fetch()` from the renderer (`webSecurity: false` on the Tag Editor `BrowserWindow` too, same rationale as the main window, allows cross-origin requests). Flow:
1. `handleTagSearch()` builds a query from `editTags.artist + editTags.title`, tries iTunes Search API first (`https://itunes.apple.com/search?term=…&entity=song&limit=5`). If iTunes returns zero results, falls back to MusicBrainz (`https://musicbrainz.org/ws/2/recording/…&fmt=json`). Both sources are normalized to `{ title, artist, album, year, genre, artworkUrl, source }`.
2. Results render as a picker below the form (the glass-panel switches to `flexDirection: column` to accommodate this). User selects one card.
3. `handlePickResult()` fills all `editTags` fields immediately, then async-fetches: ① full-res artwork (iTunes: replaces `100x100bb` → `600x600bb`; MusicBrainz: Cover Art Archive `/release/{id}/front-250`) as blob → `FileReader` → base64 data URL; ② lyrics from `https://lrclib.net/api/search?…` (fuzzy, picks first result with `plainLyrics`), with `https://api.lyrics.ovh/v1/{artist}/{title}` as fallback. Lyrics are only attempted for `.mp3`, `.flac`, and `.wav` files.
4. All network calls go through `fetchWithTimeout(url, options, ms=15000)` — module-level in `TagEditorWindow.jsx`, an `AbortController` helper that aborts after 15 seconds. Both `handleTagSearch` and `handlePickResult` use `try/finally` to guarantee `isTagSearching` and `pickingResult` are always reset to idle, so the UI never gets permanently stuck in a loading state regardless of network failure.
5. **Music playback (main window) is unaffected by any of this** — it's a wholly separate renderer process now, not just separate state; the `<audio>` element reads local `file://` paths and never makes network requests regardless of what the Tag Editor window is doing. The "Search in YouTube" context-menu item (main window) uses `shell.openExternal` (fire-and-forget via `open-external-url` IPC) and similarly has zero impact on playback.

## Now Playing navigation and `previousView` invariants

`expandNowPlaying()` saves `view → previousView` then sets `view = 'now_playing'`. `collapseNowPlaying()` restores `setView(previousView)` with no special cases — wherever you came from is where you go back.

**Back button label (`npBackLabel`)** is computed from `previousView` and `homeDetailItem`:
- If `previousView === 'home'` and `homeDetailItem` is set, the label is the detail view title (album/artist name, or "Missing Art" / "Missing Lyrics" / etc. for metadata views).
- Otherwise maps `previousView` → "Library" / "Home".

(The Tag Editor being its own `BrowserWindow` rather than a `view` value means `previousView` can never point at it — the stale-pointer problem this used to guard against doesn't exist anymore.)

## Missing file handling

Files deleted from disk outside the app are handled at two points:

1. **Cold launch** — `library:load` serves cached index entries instantly (it does not touch the files); the background verification pass then stats every path and pushes removals for missing files via `library:updated`. No user action needed.

2. **Live session — audio `onError`** — The `<audio>` element has an `onError` handler. On any playback error, it calls `fs:checkPaths` for the current track's path. If the file is gone: removes the track from library via `removeTracks` (which auto-advances to the next track), shows a toast. If the file exists (codec/format error): skips to next without removing.

3. **Live session — window focus** — A `window.addEventListener('focus', ...)` handler in `App.jsx` fires 500ms after the app regains focus. It batch-checks all library paths via `fs:checkPaths`, removes any missing ones in a single `removeTracks` call, and shows a combined toast ("N tracks removed — files not found"). Uses `libraryRef` (not `library` state directly) to avoid stale closures without putting `library` in the effect's dep array.

**Toast system** — `toast` state (`{ msg, id }`) + `showToast` `useCallback` in `App.jsx`. `showToast` sets the toast then schedules `setTimeout` to clear it after 3.5s (keyed by `id` to avoid clearing a newer toast). Rendered as a `position: fixed` overlay centered above the player panel (`bottom: 140px` = panel height 124 + 16px gap), `pointerEvents: none`.
