# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sonus — an Electron + Vite + React desktop MP3/audio player with a dark glassmorphic UI. macOS-focused (vibrancy, traffic-light title bar, file associations, dock/background-playback behavior).

## Commands

- `npm run dev` — Vite (`localhost:5173`) + Electron via `concurrently` + `wait-on`; the window loads the dev server, not `dist/`. It keeps its own data in `~/Library/Application Support/Sonus Dev` (the built app uses `.../Sonus`; the first launch copies the library, index, covers and session from it; delete `Sonus Dev` to copy again; `--user-data-dir` still wins). Closing its window stops Vite too.
  - **Kill any previous dev server first**, scoped to this project: `pkill -f "mp3Player/node_modules"` (a bare `pkill -f Electron` kills VS Code too). `pkill -f` also kills **the shell running it** when the pattern appears anywhere in that shell's own command line (exit 144, the later steps silently never run): run a kill as its own command. If Vite prints `Port 5173 is in use` it binds 5174 while Electron still loads 5173, and you silently test stale code. Details: [docs/TESTING.md](docs/TESTING.md#dev-server-details).
- `npm run build` — `vite build`, then `electron-builder`: a **universal** (Intel + Apple Silicon) `.dmg` + `.zip` in `release/`, ~250MB each, ~40s (the first universal build downloads the x64 Electron and needs network). File names come from `package.json`'s version, so a build overwrites that version's local artifacts. Packaging walkthrough: `BUILD_INSTRUCTIONS.md`.
- `scripts/verify-bundle.sh release/mac-universal/Sonus.app --expect-universal` — structural checks on a packaged app (both slices in every Mach-O binary, `LSMinimumSystemVersion`, six file associations, three Finder Services, one merged `app.asar`, the smoke fixture). **The app path must come before any flag.** It exists for the partial-`lipo` merge that launches fine here and dies on Intel.
- `npm run lint` — ESLint (`eslint.config.js`). **The baseline is `5 problems (0 errors, 5 warnings)`**: three `exhaustive-deps` in `App.jsx` and one in `HomeDetailView.jsx` (each marked "intentionally omits"), plus TanStack Virtual's incompatible-library notice in `TrackList.jsx`. Don't "fix" those; a sixth warning is the signal.
- `npm run test` — vitest: `src/*.test.{js,jsx}` under jsdom + React Testing Library, `electron/*.test.mjs` as pure Node (which is why `artwork.mjs`, `indexStore.mjs`, `launchFiles.mjs`, `finderServices.mjs`, `folderScan.mjs`, `pointerTracker.mjs`, `pointerMotion.mjs`, `appMenu.mjs`, `windowModes.mjs` and `session.mjs` are Electron-free). One file: `npx vitest run src/TrackRow.test.jsx`; by name: `npx vitest run -t "formats m:ss"` (a typo matches nothing and reports success). **A green run says little about the UI**: `App.jsx`, `HomeView.jsx`, `TagEditorWindow.jsx`, `TrackList.jsx`, `MiniPlayer.jsx` and the Chill components are exercised only by the smoke suite ([coverage](docs/TESTING.md#unit-test-coverage)).
- **Smoke suite** (`electron/smokeTest.mjs`): `npx vite build && npx electron . --smoke` boots the **built** app against a temp `userData`, drives real Electron + Chromium, prints one `SMOKE_RESULT:{...}` line and exits 0/1. Several guards (the built CSS's blur, packaging) only exist in a built app. What it covers, its metrics and its test hooks: [docs/TESTING.md](docs/TESTING.md#the-smoke-suite-what-it-covers).
  - **While iterating, run only the section you touched**: `--only=menus` (or `SONUS_SMOKE_ONLY=a,b`; sections `tracklist, header, mini, menus, adddialog, split, strip, listrows, chillend, chillswitch, tagwrite, folder, writers, reindex, fileopen, save-playing, reopen, tageditor, bench, frames, mix, session`), ~10s instead of ~3min. The result says `partial: true`: **a filtered pass is never the gate**; one full run at the end, in the background. The names can mislead: the title strip, the song's pill and the 380px checks are in `mini` (`header` is the tracklist's column header); the split and its motion are in `split`.
  - **The packaged app runs it too**: `release/mac-universal/Sonus.app/Contents/MacOS/Sonus --smoke` (the fixture and the suite ship in `app.asar`: the acceptance test on any Mac). The Intel slice on Apple Silicon: `arch -x86_64 <binary> --smoke` (Rosetta translates the CPU only, not the GPU or the OS). A cold launch with files: `npx electron . --smoke --open-file=/tmp/a.mp3 --open-file=/tmp/b.mp3`. Against a development React build (StrictMode's double updaters): [docs/TESTING.md](docs/TESTING.md#driving-the-app-outside-the-suite).
  - When the user is away, run it as `caffeinate -di npx electron . --smoke`. **Never beside another Electron process** (a second `--smoke`, or a live `npm run dev`): it fails `save-while-playing`, the 20k scroll and the frame probe spuriously.
  - Writing checks: sync on conditions, never fixed sleeps (wait for two identical samples before judging geometry; the fixture is 20s, so loop it in long blocks; sample brief peaks in the page on `requestAnimationFrame`), and **prove each new check fails on the bug** by putting the bug back temporarily. The full rules: [docs/TESTING.md](docs/TESTING.md#writing-smoke-checks).
- `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron scripts/check-quit.cjs [Sonus.app]` — the **real quit test** on the built app (throwaway profiles; one Quit each from a visible window, a closed one and the strip; checks it exited and what it reopens as; ~1 min). Run it after anything that touches quitting, window lifecycle or the session. It needs Electron-as-Node and must not pass that variable on to Sonus.
- `node scripts/make-test-fixture.mjs` — regenerates `test-fixture.mp3` (see "Working in this repo").
- Asset scripts (Pillow only, from the repo root): `python3 scripts/make-app-icon.py` (the app icon from `build/icon-art.png`; keep its superellipse mask, see [PITFALLS](docs/PITFALLS.md#known-accepted-issues-dont-fix-opportunistically)), `scripts/fit-chill-room-posters.py` (measures the study room's poster and lyrics-paper quads; run it **before** the mask script), `scripts/make-chill-room-mask.py` and `scripts/make-chill-beach-mask.py` (each with `--preview`; the Chill scenes are calibrated to those photos), `scripts/prepare-screenshots.py` (README assets; its username redaction has caveats). Full notes: [docs/TESTING.md](docs/TESTING.md#asset-scripts-full-notes), [screenshots](docs/TESTING.md#readme-screenshots).
- `npm run preview` — Vite's static preview (rarely needed, no Electron). There is no `typecheck` script (plain JS/JSX).

## Cutting a release

`BUILD_INSTRUCTIONS.md` covers *building*; this is *publishing*. The repo is public at **https://github.com/panawel/sonus-player** and releases carry the `.dmg` + `.zip` as GitHub Release assets — they cannot live in the tree, since GitHub hard-rejects files over 100MB and each artifact is ~250MB.

1. **Bump the version first** (`npm version <x.y.z> --no-git-tag-version`, plus the `shasum` example in `README.md`): the artifact file names come from `package.json`. Commit everything: **`git status` must be clean before building.** The artifacts have to provably correspond to the tag, not to a slightly-earlier local build. Note the reverse too: **any `npm run build` before the bump overwrites the already-published version's `.dmg`/`.zip` in `release/`** (same file names); the copies on GitHub are untouched, but the local ones stop being the released bytes. Right now `release/Sonus-1.9.0-universal.{dmg,zip}` are byte-identical to the published v1.9.0 assets (SHA-256 `761306…b4b6` / `fa1b1f…f070`, in the release notes): bump to the next version before any build.
2. `npm run build` → `./scripts/verify-bundle.sh` → smoke **both** slices (`arch -arm64` and `arch -x86_64`) on the packaged binary. `smokeTest.mjs` ships inside the app, so the two final zero-failure runs must be of the same build you publish. **Follow the release test protocol below; never loop full runs** (1.9.0 burned ~2 hours on eight full ~15-min rounds, one fix each, until the user stopped it).

**Release test protocol** (each step exists because skipping it cost real time):
- **Before release day:** every new or changed smoke check gets one Rosetta run of its own section while the feature is built: `npm run build`, then `arch -x86_64 release/mac-universal/Sonus.app/Contents/MacOS/Sonus --smoke --only=<section>` (~1-2 min). 1.9's Rosetta failures were all new checks that had only ever run on arm64.
- **Write checks slow-machine-safe from the start:** wait for the settled state (never a fixed sleep), drive input in the page when the test needs a steady stream (synthetic wheel events arrive in sparse bursts under Rosetta), and scale frame counts and sample sizes with `SLOW`.
- **One full run per slice collects the failure list.** Read every failure, sort them into app bugs and test timing, and fix all of them in **one batch**.
- **Iterate on sections, not the suite:** after the batch, rebuild once and rerun only the failing sections on the failing slice (`--only=a,b`). Full runs are for the final check only.
- **Time-box:** at most **two** full rounds per slice. If either still fails after that, stop and report to the user: which checks, app bug or test timing, and the options (publish, or keep fixing). Don't start a third round on your own.
- **Nothing else running during a run:** no other Sonus (`ps aux | grep -i sonus`; the user's installed copy counts), no `npm run dev`, no uploads or builds alongside. A run during the 500MB asset upload failed in sections that passed every other time.
3. `shasum -a 256` both artifacts. The hashes go into the release notes verbatim: for an unsigned app that is the *only* integrity signal on offer, so a wrong one is worse than publishing none.
4. Tag, push, create the Release, upload both assets. **Create it as a draft** (`"draft": true`), upload, verify (next step), then `PATCH` `{"draft": false, "make_latest": "true"}`: that way the public never sees a release without its files. `release/` keeps every earlier version's artifacts, so upload only the new version's two files by name. Don't rebuild between hashing and uploading: a rebuild changes the bytes, and the hashes in the notes would no longer match.
5. **Verify by downloading the stored asset and re-hashing it** — not by re-hashing the local file, which proves nothing about what GitHub actually stored. A draft's assets can be fetched with the token: `curl -L -H "Authorization: Bearer $TOKEN" -H "Accept: application/octet-stream" https://api.github.com/repos/panawel/sonus-player/releases/assets/<id>` (the `id` is in each upload response). Afterwards check the unauthenticated download URL answers 200 and that every `src=` in the README resolves on `raw.githubusercontent.com`.

Repeat the Gatekeeper instructions *inline* in the release notes. People arrive at the Releases page directly from a link and never see the README, and an unsigned app that appears broken on first launch is the single biggest drop-off point.

**Environment gotchas on this machine** (each cost real time to rediscover):
- **`gh` is not installed** (Homebrew is, at `/opt/homebrew` — it's where `ffmpeg`/`ffprobe` come from, which is how screen recordings get analysed frame by frame). Releases go through the GitHub REST API with the token already in the macOS keychain — `printf 'protocol=https\nhost=github.com\n\n' | git credential fill` yields a token with `repo, workflow, read:user, user:email` scopes. Never echo it.
- **The system `python3` has no CA bundle**: `urllib` dies with `CERTIFICATE_VERIFY_FAILED` on any HTTPS call. Use `curl` for the API and `python3` only for assembling/parsing JSON locally.
- **Annotated tags don't resolve to commits.** `git rev-parse v1.0.0` returns the tag *object*; comparing it to `HEAD` reports a phantom mismatch. Use `git rev-parse 'v1.0.0^{}'`.
- **Git identity here is repo-local `panawel`**, deliberately different from the global `Idan Pnuel`. Don't "correct" it — the global config would write a real name into public commit history, permanently.
- **`Bad CPU type in executable` from `arch -x86_64 … --smoke` may just mean Rosetta isn't installed** (a macOS upgrade can reset it): check `lipo -info <binary>` and `pkgutil --pkgs | grep -i rosetta` before suspecting the build; the fix is `softwareupdate --install-rosetta --agree-to-license`.
- **The x86_64 smoke under Rosetta flakes about one run in three** (7-10 min, run it in the background). Capture the *full* failure text; the same assertion failing twice is real. Don't keep rerunning until one run is green: that drove 1.9.0's two-hour loop. Fix in a batch, rerun only the failing sections, and stop after two full rounds as the release test protocol above says. Check the seven known harness causes first: [docs/TESTING.md](docs/TESTING.md#rosetta-runs-and-flaky-failures).
- **Before calling any failure a flake**: check `ps aux | grep -i electron` for another instance, look at `frameTimeMs.max` (a huge value is a stall), rerun under `caffeinate`. And don't explain an intermittent failure away without evidence: the Chill idle-fade "flake" was a real bug (same page).

- **Tooling gaps on this machine.** The system `python3` has Pillow but **no numpy/scipy/OpenCV** — for numeric fitting (the Chill mode homography was fitted with a small Levenberg-Marquardt in plain Node) use Node. And `python3 -I` (isolated mode, which the "untrusted data" guidance suggests for scripts that read downloaded files) **hides the user site-packages, so `import PIL` fails under it**; run plain `python3` from a directory with no stray `.py` files instead. `sed -i` needs `''` on macOS (`sed -i ''`); there is no `timeout`.
- **The Claude desktop app's browser pane can't run a local page's scripts from `file://`** — it renders a static `data:` snapshot with `script-src 'none'`, even for files inside the project. To show something live (spinning, interactive), serve the folder (`python3 -m http.server <port> --bind 127.0.0.1`), navigate to `http://127.0.0.1:<port>/…`, and stop the server afterwards. `screenshoots/` is gitignored, which makes it the right place for local-only mockups — but remember they may contain the user's own album art.

## Architecture

**Three layers, strict separation:**
- `electron/main.js` — the main process. Owns `BrowserWindow` creation/lifecycle, all `ipcMain` handlers (file dialogs, metadata parsing, MP3/FLAC/WAV tag writes), and OS integration (`open-file` for double-click-to-open, Finder Services, `electron-window-state` for remembered window geometry). **There are no native context menus** — every menu in the app is rendered in the renderer.
- `electron/preload.cjs` — the only bridge between them. Uses `contextBridge.exposeInMainWorld('electronAPI', {...})` with `contextIsolation: true` / `nodeIntegration: false`. Every renderer→main capability must be added here explicitly; the renderer has no other access to Node/Electron APIs.
- `src/` — the renderer, a standard Vite + React 19 app. `App.jsx` is effectively the whole main-window application: nearly all state (library, current track, playback, view routing between `'home'` / `'library'` / `'now_playing'`) lives in this one component via hooks. The other meaningful pieces: the unified tracklist engine (`TrackList.jsx`, `TrackRow.jsx`, `TrackListHeader.jsx`, `useTrackSelection.js`, `useTrackSort.js`, `trackUtils.js` — see [Tracklist engine](docs/ARCHITECTURE.md#tracklist-engine-tracklistjsx--trackrowjsx--tracklistheaderjsx--hooks)), `HomeView.jsx`, `HomeDetailView.jsx`, and `TagEditorWindow.jsx` (the Tag Editor, mounted instead of `App` in its own `BrowserWindow` — see [Tag Editor](docs/ARCHITECTURE.md#tag-editor--a-separate-window-not-a-view)). `StripApp.jsx` is a third such window (Strip mode's slim player beside the Dock, `?strip=1` — see [Strip mode](docs/ARCHITECTURE.md#strip-mode-a-separate-window-beside-the-dock)). `src/main.jsx` is the entry point that decides which to mount, based on the `?editor=1` / `?strip=1` URL query flags.
- `electron/artwork.mjs` (pure artwork normalization/repair), `electron/indexStore.mjs` (JSON metadata index + play stats — deliberately isolated so a future SQLite swap is contained), and `electron/folderScan.mjs` (recursive directory expansion for drag-and-drop and the Add Music dialog) are Electron-free modules unit-tested directly by vitest.

Dev vs packaged loading is decided by `app.isPackaged` in `main.js`: dev loads `http://localhost:5173`, packaged loads `../dist/index.html`.

**Layouts** (full overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#overview-one-window-many-layouts)): at or below `NARROW_LAYOUT_BREAKPOINT` (`innerWidth <= 560`, so full width starts at 561px; `minWidth` 380) the shell goes phone-portrait (icon-only tabs, single-column Now Playing, `PlayerPillNarrow.jsx`). At or below `MINI_LAYOUT_HEIGHT_BREAKPOINT` (420px tall) `MiniPlayer.jsx` replaces the shell (the app stays mounted, hidden); shrinking that below 180px becomes **Strip mode**, its own frameless window (`StripApp.jsx`, `?strip=1`) beside the Dock while the hidden main window keeps playing (`strip:state` / `strip:command` IPC). Full-width Now Playing splits with the Library (`splitView.js`; Lyrics and the Library are chosen in the song's own pill at the top right, `NowPlayingPill.jsx`) and has **Chill mode** (`ChillScene.jsx`: a photo scene filling the window, calibrated to the bundled `turntable.jpg` / `beach.jpg` / `room.jpg` and their generated masks — the deliberately >1MB assets). The title strip is two floating glass pills (centred: back | Home | Library | Now Playing | +; at the right the song's pill, `[ Lyrics | Library ] · Chill`, only while Now Playing is open and never in Chill, with no Library button under 900px or at phone width), and whatever comes and goes there is a spring-driven `<Bubble>`. Search is the Library's own field, in its column header (🔍, ⌘F from anywhere, or typing a letter; `librarySearch.js`). The glass card runs to the window's top, reserving `TITLE_STRIP_HEIGHT`.

Library's and the detail pages' extra columns (Album/Year/Genre) appear one at a time as the window narrows, a separate mechanism from the narrow breakpoint; the thresholds live in `trackUtils.js` and none may drop below 780px (a 700px smoke check depends on it).

## Things that fail silently

Each looks fine in `npm run dev` (or by eye) and breaks somewhere you won't notice. One line each here; **the full entry, with the real case behind it, is in [docs/PITFALLS.md](docs/PITFALLS.md)** — read it before touching that area.

| Don't | Because |
| --- | --- |
| Hand-write `-webkit-backdrop-filter` | Kills the blur in **packaged builds only** (section below). |
| Put the tracklist column header back inside a scroll container | Rows pass behind it; the opaque fill it then needs darkens on scroll. |
| Animate the column header's *height* | `scrollMargin` is measured once in a layout effect: windowing and `scrollToIndex` desync. |
| Point `scrollElRef` at anything but the real scrolling ancestor | Virtualization silently stops: every row mounts. |
| Read the metadata store without `await ensureStoreLoaded()` | Every path looks unknown: placeholders and a full spurious reindex. |
| Detect the pointer over a `-webkit-app-region: drag` area with page mouse events | The page never gets the pointer there (and synthetic input bypasses that, so tests pass). Track it from main (`pointerTracker.mjs`, `pointerMotion.mjs`). |
| Hide the app under the mini player with `visibility: hidden` or `display: none` | Descendants override `visibility`; `display: none` loses every scroll position. It's `inert` + `opacity: 0`. |
| Conditionally render `HomeView` instead of `display: none` | Every artwork is decoded again on each visit: the freeze returns. |
| Remove `nativeTheme.themeSource = 'dark'` or any one vibrancy flag | The glass needs the window flags, the CSS and this line together. |
| Drop `corsEnabled` from the `sonus-thumb` scheme | Renderer `fetch()` of thumbnails is refused; `<img>` still works, so it looks fine. |
| Save scroll position in an effect cleanup | `display: none` has already collapsed it: always 0. Save in `onScroll`. |
| Rely on `setCurrentTrack` alone to (re)start playback | The same track gives the same `src`: no DOM change, no autoplay. `playTrack` restarts it explicitly. |
| Set `isPlaying` optimistically before audio starts | `onPlay` / `onPause` are the only source of truth. |
| Use `BrowserWindow.center()`, or resize a window without repositioning it | `setContentSize` pins the top-left; `center()` was ~40px off. |
| Reintroduce base64 artwork into track objects | The index/thumbnail architecture exists to keep it out of the renderer heap. |
| Upgrade Electron without checking `LSMinimumSystemVersion` | It can permanently drop the 2017 iMac (section below). |
| Ship a universal build without `scripts/verify-bundle.sh` | A partial `lipo` merge dies on Intel only. |
| Move Inter back to a CDN `@import`, or break the bundled woff2 paths | Silent fallback to `-apple-system`; guarded by a `FontFace.status` assertion. |
| Test font loading with `document.fonts.check()` | True even for a family that doesn't exist. Use `FontFace.status === 'loaded'`. |
| Give an element inside `.glass-panel` (any `backdrop-filter` surface) a z-index to beat something outside it | `backdrop-filter` makes a stacking context (and the containing block for `position: fixed`). Make it a true sibling (the old floating search panel had to render at the root for exactly this). |
| Dedupe against library membership before deciding what Play Next queues | Already-in-library tracks never reached `forcedNextQueueRef`. Dedupe decides only which rows are inserted. |
| Trust `getComputedStyle` + `elementFromPoint()` for the colour text renders | A box-shadow can paint over it and is not hit-testable. Check pixels (`capturePage` + PIL). |
| Put a side effect inside a `setState(updater)` | StrictMode calls updaters twice in dev only. Keep them pure; read state through the mirror refs. |
| Assume z-index decides between a `drag` area and the buttons over it | Electron builds drag regions in **document order**: the drag band goes before the buttons. Tests can't see it (they bypass the OS drag layer). |
| Give a menu item an accelerator that is also a text-editing key | It wins over the focused field. Play/Pause has none; Next/Previous are ⌥⌘←/→; ⇧⌘R is Force Reload. |
| Add or move content in the mini player without checking the 180px minimum | ~124 of the ~128px are used; `--mini-*` vars and the `max-height: 215px` override; smoke checks 380x180 and 380x205. |
| Trust a `-webkit-app-region` area you cannot drag | A native region can only be asserted. Make a provable drag page-driven (`window:drag`) and swallow the click after it. |
| Parse an open-file batch without `expandOpenedPaths`, or rename a Service by renaming its `.workflow` | Folders fail silently; a Service's title is in its `Info.plist` (change it, bump `SERVICES_VERSION`). |
| Check Chill mode's DOM the instant `.chill-scene` exists | It is hidden until ready: wait for `[data-chill-state="ready"]`; never reveal a scene before `onReady`. |
| Let the main window be saved, or open, shorter than 180px | It can then be neither dragged nor used; `prepareMainForQuit` and the launch clamp guard it. |
| Trust that one Quit quits, or record "strip open" in a close handler | A hidden main window got `window-all-closed` instead of quitting; the strip closes first. Record in `before-quit`; test with `check-quit.cjs`. |
| Decide in a bubble-phase keydown listener whether another handler will take the key | React re-renders between listeners. Listen in the capture phase (`escapeToBrowseRef`). |
| Put a window beside the Dock by resizing a titled window | macOS keeps titled windows out of the Dock's band; only a frameless one with `enableLargerThanScreen` (Strip mode's own window). |
| Hide the traffic lights without a structural restore | Only via `setWindowButtons` in main, which restores them whenever Chill tracking stops. |
| Test a button that opens a menu with a scripted `.click()` alone | Menus close on any document click. Click with `sendInputEvent`, then move the pointer away. |
| Mark a layer that covers the title strip `no-drag` | The window becomes immovable. Only content below the strip is `no-drag`; smoke resolves the region across the strip. |
| Change a large or blurred surface's colour with a CSS transition, or show the thumbnail before the sharp cover | Repaints every frame (patchwork). Crossfade fixed-colour layers by opacity (`useCrossfadeStack`); keep the old cover until the new one is decoded (`coverCache.js`). |
| Make a flash by mixing toward white or adding a white overlay | It's an exposure gain on the picture's own colours (and the DOM overlays); verify with measured luminance ratios. |
| Fake typing (or any detailed body part) by warping a photo's pixels | It reads as wiggling and was rejected. Animate what a photo can carry: rain, light, a screen. |
| Write a regression check without proving it fails on the bug | It may pass on the bug. Run it against the bug and calibrate between the two. |
| Judge an overlay's fit from a coarse crop | Measure the edges (`fit-chill-room-posters.py`) and look at its overlays; a corner may move ≤9px from a reviewed seed. |
| Upload a data texture to WebGL with the default colour handling | Masks are weights: `UNPACK_COLORSPACE_CONVERSION_WEBGL = gl.NONE`. Keep the `<img>` under any canvas as the fallback. |
| Ease the Chill record by changing a Web Animation's `playbackRate` every frame | It stays pending, then snaps. `updatePlaybackRate` in coarse steps; assert the angle advances. |
| Size a component with `getBoundingClientRect()` while an ancestor transforms | The rect includes the scale. Use `clientWidth` / `clientHeight`. |
| Size or compare Now Playing's cover with `getBoundingClientRect()` | It "breathes" (a 12s 1.8% scale). Use `offsetWidth` about its centre; place things beside it from its own `min(100cqw, 100cqh, 820px)`, outside its wrapper. |
| Seed a smoke library with fake file paths | The focus-time `checkPaths` sweep removes them mid-suite. Give every fixture track a real file (a copy of `test-fixture.mp3`). |
| Expire the restore-time autoplay suppressor (`suppressNextAutoplayRef`) on a timer | A slow Mac loads the song after the timer: the paused song starts by itself. It waits for its autoplay; every deliberate play clears it. |
| Add a button to the song's pill (`NowPlayingPill.jsx`) without checking 561px wide | It clears the centred pill there only because the Library button hides under 900px; with all three buttons they overlap by ~20px. Smoke checks 561px and 380px. |

Verify with `npm run test` **and** the smoke suite — several of the above are only observable in a built app, which is exactly what `--smoke` runs against.

### `backdrop-filter`: never hand-write the `-webkit-` prefix

**This broke every glass surface in the packaged app and went unnoticed, so treat it as a hard rule.** In `index.css`, write only the unprefixed `backdrop-filter`. Vite emits both spellings itself.

Writing both by hand is what breaks it: Vite's CSS minifier collapses a `backdrop-filter` + `-webkit-backdrop-filter` pair down to the **`-webkit-` one alone**, and Electron 41's Chromium has *removed* that property (`CSS.supports('-webkit-backdrop-filter', 'blur(10px)')` → `false`). The declaration is then dropped entirely and the element renders with no blur.

The failure mode is why it survived so long: `npm run dev` serves unminified CSS, where the unprefixed declaration is still present, so it looks perfect. Only the built/packaged app loses its glass. `.glass-panel`, `.track-dropdown`, and `.confirm-modal-panel` were all affected. (Inline React styles — the player panel, the NP overlay — were never affected, since those aren't minified.)

The smoke suite asserts `.glass-panel` has a real computed `blur()` against the **built** CSS. That assertion is the regression guard; don't delete it.

### The macOS support floor, and why Electron is pinned

The app ships **universal** (Intel + Apple Silicon) because the oldest machine it must run on is an **iMac 27" 5K 2017 (`iMac18,3`) — Radeon Pro 575 4GB, 24GB RAM, macOS Ventura 13.7.8**.

Two numbers govern whether that machine can run a given build:

| | Value | Source |
| --- | --- | --- |
| Electron 41.7.1's macOS floor | **12.0** (Monterey) | `LSMinimumSystemVersion` in the built `Info.plist` |
| The iMac's maximum macOS | **13.x** (Ventura) | Sonoma 14 requires an iMac 2019 or newer |

There is exactly one major version of headroom, and **it cannot be widened.** A 2017 iMac can never install macOS 14, so the day Electron's floor reaches 14 that machine is permanently excluded — no OS update, no build flag, no config change recovers it. The only options at that point are staying on the last compatible Electron or dropping the machine.

That is why `package.json` pins **`"electron": "41.7.1"` exactly, with no caret.** A routine `npm update` under `^41.7.1` could otherwise cross that line silently: the build succeeds, every test passes on Apple Silicon, and the failure only appears as "it won't open any more" on a machine that isn't in front of you.

**After any deliberate Electron bump**, check the floor before shipping — `scripts/verify-bundle.sh` asserts it and prints a warning naming this constraint if it moved:

```bash
/usr/libexec/PlistBuddy -c "Print :LSMinimumSystemVersion" release/mac-universal/Sonus.app/Contents/Info.plist
```

Anything `≤ 13.x` is fine. `14.0` or higher is the cliff.

Note that nothing else about the app is OS-version-sensitive: Chromium and Node are bundled, so every web and Node API travels with the build rather than the host. Vibrancy, `hiddenInset`, Automator Services and `open-file` all behave the same on Ventura as on macOS 26. The floor is the whole compatibility story.

### Known accepted issues (don't "fix" opportunistically)

Full entries: [docs/PITFALLS.md](docs/PITFALLS.md#known-accepted-issues-dont-fix-opportunistically).

- `webSecurity: false` is required for `file://` audio/art against the dev origin; don't flip it without a custom protocol replacing it.
- `npm audit`'s `shell-quote` and `undici` advisories are dev-only tooling, never shipped. Accepted.
- Orphaned thumbnails in `userData/thumbs/` are not garbage-collected (a few KB each). Accepted.
- Inter (`@fontsource/inter`, a devDependency) bundles all seven subsets (~520KB woff2, plus ~680KB of never-loaded `.woff`): latin alone would drop Cyrillic and Greek titles to the system font.
- `app.asar` ships the fixture MP3 and the `*.test.mjs` files on purpose: that is what lets the packaged app run `--smoke` on a target Mac.
- The build is **unsigned and un-notarized**: right-click → Open on Ventura, System Settings → "Open Anyway" from Sequoia. `codesign --verify` failing on the ad-hoc signature is normal.
- `react-hooks/refs`, `set-state-in-effect` and `immutability` are disabled (React Compiler diagnostics; the render-time mirror-ref idiom is deliberate).
- The app icon is not on a grey plate because of its **alpha outline**: a superellipse |x|^5 + |y|^5 = 1, 824px in the 1024 canvas (a rounded square gets plated). Edit `build/icon-art.png`, never the outputs; keep the mask curve.

### Genuinely dead code (unlike everything above, this *is* safe to delete)

Almost all of this file argues that something which looks removable is load-bearing. The inverse is worth writing down too, so the next reader doesn't have to re-derive it by grep. All of the following are verified unreferenced:

- **CSS in `index.css`** — `.track-header-sort-chip` (left over from the deleted Sort dropdown), `.track-list-header-title` and `.track-list-header-meta` (the deleted Library identity line, whose *absence* the smoke suite asserts), and `.np-text-block`.
- **`src/MarqueeText.jsx`** — committed but imported by nothing. The player panel uses the inline `.marquee-scroll` class instead, so the shared `@keyframes marquee-scroll` can be changed without touching this file.
- A **stale comment block** immediately above `.track-list-header` still describes the deleted sticky/`--scrolled` header design; the correct comment follows right after it.

Deleting these is safe but optional — they cost nothing at runtime, since unused CSS rules and an unimported module are dropped or never loaded by the bundler.

## Deep-dive reference

Everything below lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Read the relevant section *before* editing that area — most contain constraints that fail silently.
- [Home view (`src/HomeView.jsx`, `src/HomeDetailView.jsx`)](docs/ARCHITECTURE.md#home-view-srchomeviewjsx-srchomedetailviewjsx)
- [Mix ("Start Mix" recommendations)](docs/ARCHITECTURE.md#mix-start-mix-recommendations)
- [Scroll position preservation across views (`App.jsx`)](docs/ARCHITECTURE.md#scroll-position-preservation-across-views-appjsx)
- [Tracklist engine (`TrackList.jsx` + `TrackRow.jsx` + `TrackListHeader.jsx` + hooks)](docs/ARCHITECTURE.md#tracklist-engine-tracklistjsx--trackrowjsx--tracklistheaderjsx--hooks)
- [Column-cycle sorting (no Sort dropdown)](docs/ARCHITECTURE.md#column-cycle-sorting-no-sort-dropdown)
- [The column header lives OUTSIDE the scroll container](docs/ARCHITECTURE.md#the-column-header-lives-outside-the-scroll-container)
- [Player pills (full-width and narrow)](docs/ARCHITECTURE.md#player-pills-full-width-and-narrow)
- [Narrow layout (phone-portrait widths)](docs/ARCHITECTURE.md#narrow-layout-phone-portrait-widths)
- [Mini player (very short windows)](docs/ARCHITECTURE.md#mini-player-very-short-windows)
- [Primary navigation and Search (nav pill; search is the Library's own field)](docs/ARCHITECTURE.md#primary-navigation-nav-pill)
- [Track context menu (`trackMenu` state)](docs/ARCHITECTURE.md#track-context-menu-trackmenu-state)
- [IPC channel surface (`electron/preload.cjs` ↔ `electron/main.js`)](docs/ARCHITECTURE.md#ipc-channel-surface-electronpreloadcjs--electronmainjs)
- [Launch behavior: what library the app starts with](docs/ARCHITECTURE.md#launch-behavior-what-library-the-app-starts-with)
- [Finder Services integration ("Add to Queue" / "Play Next")](docs/ARCHITECTURE.md#finder-services-integration-add-to-queue--play-next)
- [Metadata index, thumbnails, play stats (`electron/indexStore.mjs` + `main.js`)](docs/ARCHITECTURE.md#metadata-index-thumbnails-play-stats-electronindexstoremjs--mainjs)
- [Artwork normalization and repair (`electron/artwork.mjs`)](docs/ARCHITECTURE.md#artwork-normalization-and-repair-electronartworkmjs)
- [Custom application menu (`buildAppMenu` in `main.js`)](docs/ARCHITECTURE.md#custom-application-menu-buildappmenu-in-mainjs)
- [Vibrancy and forced dark mode](docs/ARCHITECTURE.md#vibrancy-and-forced-dark-mode)
- [Artwork-derived color (`artworkRgb` / `bgColor`)](docs/ARCHITECTURE.md#artwork-derived-color-artworkrgb--bgcolor)
- [Now Playing glass backdrop — contrast guarantee](docs/ARCHITECTURE.md#now-playing-glass-backdrop--contrast-guarantee)
- [Now Playing artwork sizing](docs/ARCHITECTURE.md#now-playing-artwork-sizing)
- [Chill mode (the turntable)](docs/ARCHITECTURE.md#chill-mode-the-turntable)
- [Lyrics feature](docs/ARCHITECTURE.md#lyrics-feature)
- [Background playback / window lifecycle (macOS-specific)](docs/ARCHITECTURE.md#background-playback--window-lifecycle-macos-specific)
- [Tag Editor — a separate window, not a `view`](docs/ARCHITECTURE.md#tag-editor--a-separate-window-not-a-view)
- [Now Playing navigation and `previousView` invariants](docs/ARCHITECTURE.md#now-playing-navigation-and-previousview-invariants)
- ["Playing from" breadcrumb (`queueSource`)](docs/ARCHITECTURE.md#playing-from-breadcrumb-queuesource)
- [Missing file handling](docs/ARCHITECTURE.md#missing-file-handling)

## Working in this repo

- **README.md's Privacy section claims an exhaustive list of every outbound network call the app makes**: Search Online in the Tag Editor (iTunes Search API, MusicBrainz, Cover Art Archive, lrclib, and lyrics.ovh as the lyrics fallback), Start Mix (MusicBrainz, ListenBrainz Labs, Deezer), and Search in YouTube (opens the browser). All three are user-initiated; nothing calls out on launch or in the background. If you add or change a network call anywhere in the app, update that table too — otherwise the README's "no telemetry, nothing sent unless you ask" claim silently becomes false.
- The current UI/UX (glassmorphism, colors, hover/drag effects, playback behavior) is considered intentionally finished — treat any visible or behavioral change as a regression unless the task explicitly calls for it. Glassmorphism depends on *all* of these together: the Electron window flags (`vibrancy: 'under-window'`, `visualEffectState: 'active'`, `transparent: true`, `backgroundColor: '#00000000'`), `nativeTheme.themeSource = 'dark'` in `main.js`, and the CSS (`body { background: transparent }`, `.glass-panel` `backdrop-filter`) — changing any one piece without the others breaks the look.
- **`test-fixture.mp3`** (repo root, ~320KB) is the audio file the smoke suite parses, tags, copies and re-opens — don't move, rename, or delete it. Make copies elsewhere (e.g. `/tmp`) for any test that needs to mutate it. It is generated, not a real song, because this repo is public: `node scripts/make-test-fixture.mjs` rebuilds it from MPEG-1 Layer III frame headers plus `scripts/fixture-cover.jpg`, using only `node-id3` (already a dependency — no ffmpeg needed). **Its 20-second length is load-bearing**: the suite seeks to 5s and then 7s and asserts the playhead landed there, so a shorter fixture makes those seeks clamp and fail for reasons unrelated to the behaviour under test.
- **The README's screenshots are the 1.9 set**, captured by the user (`screencapture` is denied from here) and exported by hand: downscaled to 1600px wide (narrow ones left native), flattened, saved as JPEG q88 with 4:4:4 chroma (~200KB each; PNG was ~1.5MB), and any track title with the developer's first name blurred (the hero's track list had one). Only `chill-mode.gif` is older.
- For *manual* listening tests (playback, marquee scrolling, lyrics, artwork colour) the fixture is 20 seconds of silence and therefore useless — keep a real track somewhere outside the repo for that.
- A Playwright/CDP screenshot of this app renders mostly blank (no vibrancy): don't diff against headless screenshots. For visuals, native `screencapture` from a session that has the permission, or `webContents.capturePage()` for opaque in-page content; details in [docs/TESTING.md](docs/TESTING.md#readme-screenshots).
- This repo is published at **https://github.com/panawel/sonus-player** (MIT). Releases are built locally and attached to a GitHub Release — `release/` is gitignored, since the artifacts are ~250MB each and GitHub rejects files over 100MB. `.claude/settings.local.json` is gitignored too: it holds absolute paths from the developer's own machine. Before any commit that adds files, check that nothing personal or over ~1MB is staged.
