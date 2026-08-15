# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sonus — an Electron + Vite + React desktop MP3/audio player with a dark glassmorphic UI. macOS-focused (vibrancy, traffic-light title bar, file associations, dock/background-playback behavior).

## Commands

- `npm run dev` — starts Vite (`localhost:5173`) and launches Electron concurrently (via `concurrently` + `wait-on`). This is the normal development loop; the Electron window loads the Vite dev server, not `dist/`.
  - **Kill any previous dev server first** (`pkill -f "mp3Player/node_modules"` — scope the pattern to this project, a bare `pkill -f Electron` also kills VS Code and any other Electron app). If Vite prints `Port 5173 is in use, trying another one…` it binds **5174**, while Electron still loads **5173** — so `wait-on` succeeds, the window opens against the *old* server, and you silently test stale code with no error anywhere.
- `npm run build` — `vite build` (frontend → `dist/`) then `electron-builder`, producing a **universal** (Intel + Apple Silicon) `.dmg` and `.zip` in `release/`. ~224MB per artifact, ~498MB installed: both architecture slices of the Electron framework ship in one bundle. ~40s, but the *first* universal build downloads the x64 Electron dist (~100MB) and needs network. See `BUILD_INSTRUCTIONS.md` for the full packaging walkthrough (verification, cross-arch testing, file associations, moving to `/Applications`).
- `scripts/verify-bundle.sh [app] [--expect-universal|--expect-arch <arch>]` — structural checks on a packaged `.app` (defaults to `release/mac-universal/Sonus.app`). Exits 0/1. Asserts every Mach-O binary carries both slices, `LSMinimumSystemVersion`, all six file associations, both Finder Service bundles, a single merged `app.asar`, and that the smoke fixture is present. **A partial `lipo` merge is the failure this exists for** — the app launches fine on the machine that built it and then dies on Intel in whichever helper process was missed.
- `npm run lint` — ESLint over the whole repo (flat config in `eslint.config.js`). **The clean baseline is `6 problems (0 errors, 6 warnings)`** — four `exhaustive-deps` in `App.jsx`/`HomeDetailView.jsx` whose dep arrays are deliberately incomplete (each marked "intentionally omits" in a comment right above it), plus TanStack Virtual's incompatible-library notice in `TrackList.jsx`. Don't try to "fix" those six; a **seventh** warning is the signal.
- `npm run test` — `vitest run`, all tests once. Tests sit beside their sources: `src/*.test.{js,jsx}` run under jsdom + React Testing Library, `electron/*.test.mjs` are pure Node against temp dirs — which is *why* `artwork.mjs`, `indexStore.mjs`, `launchFiles.mjs` and `finderServices.mjs` are Electron-free modules.
  - **Coverage is deliberately lopsided, and a green run means less than it looks.** The pure modules, the sort/selection hooks and `TrackRow` are covered well. The three biggest renderer files are not covered at all: `HomeView.jsx` (1510 lines), `TagEditorWindow.jsx` (577) and `TrackList.jsx` have **no unit tests**, and `App.test.jsx` only asserts that 1912 lines of `App.jsx` mount without throwing. Everything meaningful about those is exercised **only** by the smoke suite below. `npm run test` passing says nothing about the UI.
- Single test file: `npx vitest run src/TrackRow.test.jsx`
- Automated end-to-end smoke test: `npx vite build && npx electron . --smoke` — boots the **built** app against an isolated temp `userData` and asserts against real Electron + real Chromium. Covers: parse→thumbnail→protocol; tag-write round-trips (MP3/WAV/FLAC); the reindex pipeline; file-open/Services launch arbitration; re-opening the already-loaded file; and, driven through `executeJavaScript`, the tracklist UI (sort-cycle clicks, keyboard, a 20k-track bench), the column header's geometry/alignment/isolation-from-scroll, the Tag Editor window (centred on its display, the Search Online popup, dedupe-then-limit), and a guard that `.glass-panel` has a real computed `blur()` in the **built** CSS.
  - Several of those are only observable in a built app — the blur one in particular is invisible under `npm run dev`. Running the unit tests alone will not catch them.
  - Prints one `SMOKE_RESULT:{...}` JSON line and exits 0/1. Assertions live in `electron/smokeTest.mjs`.
  - **The packaged app accepts `--smoke` too**: `release/mac-universal/Sonus.app/Contents/MacOS/Sonus --smoke`. The fixture MP3 and `smokeTest.mjs` ship inside `app.asar`, so the whole suite runs against the real bundle — asar packaging, `extraResources`, protocol registration and all — on *any* Mac you can copy it to. That is the acceptance test for a target machine; it needs no dev toolchain there and returns machine-readable JSON instead of a screenshot.
  - **Cross-architecture test on Apple Silicon**: `arch -x86_64 <packaged binary> --smoke` runs the real Intel slice under Rosetta. Validates the binary and every code path; it does **not** validate the target OS's APIs or its GPU, because Rosetta translates CPU only — the GPU work is still done by the host. On an arm64-only build this fails with `Bad CPU type in executable`, which is exactly what an Intel Mac sees.
  - Every result carries `arch`, `platform`, `osRelease`, `translated`, `slowFactor` and `electron`. A universal binary can execute as either architecture, so a bare pass/fail cannot tell you which slice was exercised — and a result pasted back from another machine is otherwise unattributable.
  - `metrics` carries measured-but-not-asserted numbers: `bench20k` (inject/sort ms) and `frameTimeMs` (requestAnimationFrame p50/p95/max/janky, sampled in Library as a baseline and again in Now Playing with the blur furnace live, plus `npCostRatio` between them). **Deliberately not assertions** — the correct "too slow" threshold differs between an M-series Mac and a 2017 Intel iMac, and a hard limit would turn slow-but-working hardware into a red build that everyone learns to ignore. The probe *does* assert that it actually stressed the furnace (`flares === 3 && playing`), so a measurement of an empty panel cannot pass as healthy.
  - **Synchronisation is condition-based where it gates an assertion.** The suite used to sync with fixed `await sleep(400)` calls, which encoded the speed of the Apple Silicon machine they were written on; running the x86_64 slice under Rosetta made four *different* assertions fail across four runs. Shifting, non-reproducible failures are the signature of a harness race, not a defect. Those points now poll for the real condition, so machine speed stops mattering. Two rules when adding more: the condition must be **false before** the transition (waiting on `.track-row` to be non-zero is wrong — the Library's rows are already mounted, so the loop exits immediately and samples too early), and on timeout the last value must still be returned so the `check()` still runs and still fails. `SLOW` scales the remaining "settle" sleeps, auto-detecting Rosetta; override with `SONUS_SMOKE_SLOW=<n>` on genuinely slow native hardware.
  - Two `?test=1`-gated hooks exist, and smoke mode is the only thing that passes that flag: `window.__sonusTest` in the main renderer, and `window.__sonusTagEditorTest` in the Tag Editor window (which lets the suite drive the Search Online popup without calling iTunes/MusicBrainz on every run — **the suite never makes network calls**).
- Cold-launch smoke variant: `npx electron . --smoke --open-file=/tmp/a.mp3 --open-file=/tmp/b.mp3` — seeds the same batch a real Finder double-click would, then runs a dedicated launch-ordering assertion set and exits. macOS only delivers `open-file` to a registered app, so this path is otherwise invisible to `npm run dev`.
- Single test by name: `npx vitest run -t "formats m:ss"` (the name must match a real `it(...)` — a typo silently skips every test and reports success)
- `npm run preview` — Vite's static preview of the built frontend (rarely needed; doesn't run Electron).
- `node scripts/make-test-fixture.mjs` — regenerates `test-fixture.mp3` (see "Working in this repo").
- `python3 scripts/prepare-screenshots.py` — turns raw captures in `screenshoots/` (gitignored) into the README assets in `docs/assets/`. Two non-obvious jobs beyond resizing: it repaints the Tag Editor's File field, which showed a real absolute path containing the developer's macOS username; and it flattens RGBA onto opaque black, because GitHub renders README images over a light *or* dark page depending on the viewer's theme and any transparency would show through inconsistently. Captures must come from native `screencapture` — see "Working in this repo" for why headless screenshots of this app are useless.

There is no `typecheck` script — this is a plain JS/JSX project (no TypeScript).

## Cutting a release

`BUILD_INSTRUCTIONS.md` covers *building*; this is *publishing*. The repo is public at **https://github.com/panawel/sonus-player** and releases carry the `.dmg` + `.zip` as GitHub Release assets — they cannot live in the tree, since GitHub hard-rejects files over 100MB and each artifact is ~224MB.

1. **`git status` must be clean before building.** The artifacts have to provably correspond to the tag, not to a slightly-earlier local build.
2. `npm run build` → `./scripts/verify-bundle.sh` → smoke **both** slices (`arch -arm64` and `arch -x86_64`).
3. `shasum -a 256` both artifacts. The hashes go into the release notes verbatim: for an unsigned app that is the *only* integrity signal on offer, so a wrong one is worse than publishing none.
4. Tag, push, create the Release, upload both assets.
5. **Verify by downloading the published asset and re-hashing it** — not by re-hashing the local file, which proves nothing about what GitHub actually stored.

Repeat the Gatekeeper instructions *inline* in the release notes. People arrive at the Releases page directly from a link and never see the README, and an unsigned app that appears broken on first launch is the single biggest drop-off point.

**Environment gotchas on this machine** (both cost real time to rediscover):
- **`gh` is not installed and there is no Homebrew.** Releases go through the GitHub REST API with the token already in the macOS keychain — `printf 'protocol=https\nhost=github.com\n\n' | git credential fill` yields a token with `repo, workflow, read:user, user:email` scopes. Never echo it.
- **The system `python3` has no CA bundle**: `urllib` dies with `CERTIFICATE_VERIFY_FAILED` on any HTTPS call. Use `curl` for the API and `python3` only for assembling/parsing JSON locally.
- **Annotated tags don't resolve to commits.** `git rev-parse v1.0.0` returns the tag *object*; comparing it to `HEAD` reports a phantom mismatch. Use `git rev-parse 'v1.0.0^{}'`.
- **Git identity here is repo-local `panawel`**, deliberately different from the global `Idan Pnuel`. Don't "correct" it — the global config would write a real name into public commit history, permanently.

## Architecture

**Three layers, strict separation:**
- `electron/main.js` — the main process. Owns `BrowserWindow` creation/lifecycle, all `ipcMain` handlers (file dialogs, metadata parsing, MP3/FLAC/WAV tag writes), and OS integration (`open-file` for double-click-to-open, Finder Services, `electron-window-state` for remembered window geometry). **There are no native context menus** — every menu in the app is rendered in the renderer.
- `electron/preload.cjs` — the only bridge between them. Uses `contextBridge.exposeInMainWorld('electronAPI', {...})` with `contextIsolation: true` / `nodeIntegration: false`. Every renderer→main capability must be added here explicitly; the renderer has no other access to Node/Electron APIs.
- `src/` — the renderer, a standard Vite + React 19 app. `App.jsx` is effectively the whole main-window application: nearly all state (library, current track, playback, view routing between `'home'` / `'library'` / `'now_playing'`) lives in this one component via hooks. The other meaningful pieces: the unified tracklist engine (`TrackList.jsx`, `TrackRow.jsx`, `TrackListHeader.jsx`, `useTrackSelection.js`, `useTrackSort.js`, `trackUtils.js` — see [Tracklist engine](docs/ARCHITECTURE.md#tracklist-engine-tracklistjsx-trackrowjsx-tracklistheaderjsx-hooks)), `HomeView.jsx`, `HomeDetailView.jsx`, and `TagEditorWindow.jsx` (the Tag Editor, mounted instead of `App` in its own `BrowserWindow` — see [Tag Editor](docs/ARCHITECTURE.md#tag-editor-a-separate-window-not-a-view)). `src/main.jsx` is the entry point that decides which of the two to mount, based on a `?editor=1` URL query flag.
- `electron/artwork.mjs` (pure artwork normalization/repair) and `electron/indexStore.mjs` (JSON metadata index + play stats — deliberately isolated so a future SQLite swap is contained) are Electron-free modules unit-tested directly by vitest.

Dev vs packaged loading is decided by `app.isPackaged` in `main.js`: dev loads `http://localhost:5173`, packaged loads `../dist/index.html`.

## Things that fail silently

Each of these looks fine in `npm run dev` (or by eye) and breaks somewhere you won't notice. Read the linked section before touching that area.

| Don't | Why |
| --- | --- |
| Hand-write `-webkit-backdrop-filter` | Kills the blur in **packaged builds only**. See the next section — it's short, read it. |
| Put the tracklist column header back inside a scroll container | Rows pass behind it, forcing an opaque fill that visibly darkens on scroll. [Details](docs/ARCHITECTURE.md#the-column-header-lives-outside-the-scroll-container) |
| Animate the column header's *height* | `TrackList` measures `scrollMargin` in a layout effect that never re-runs on scroll — windowing and `scrollToIndex` silently desync. [Details](docs/ARCHITECTURE.md#tracklist-engine-tracklistjsx-trackrowjsx-tracklistheaderjsx-hooks) |
| Point `scrollElRef` at anything but the real scrolling ancestor | Virtualization silently stops — every row mounts, no error. [Details](docs/ARCHITECTURE.md#tracklist-engine-tracklistjsx-trackrowjsx-tracklistheaderjsx-hooks) |
| Read the metadata store without `await ensureStoreLoaded()` | Every path looks unknown → whole library served as placeholders + a full spurious reindex. [Details](docs/ARCHITECTURE.md#launch-behavior-what-library-the-app-starts-with) |
| Conditionally render `HomeView` instead of `display: none` | Re-decodes every artwork image on each visit; the freeze returns. [Details](docs/ARCHITECTURE.md#home-view-srchomeviewjsx-srchomedetailviewjsx) |
| Remove `nativeTheme.themeSource = 'dark'` or any one vibrancy flag | Glassmorphism depends on the window flags **and** the CSS **and** this line together. [Details](docs/ARCHITECTURE.md#vibrancy-and-forced-dark-mode) |
| Drop `corsEnabled` from the `sonus-thumb` scheme | Renderer `fetch()` of thumbnails is refused outright; `<img>` still works, so it looks fine. [Details](docs/ARCHITECTURE.md#metadata-index-thumbnails-play-stats-electronindexstoremjs-mainjs) |
| Save scroll position in an effect cleanup | `display: none` collapses `scrollHeight` first, so the saved value is always 0. [Details](docs/ARCHITECTURE.md#scroll-position-preservation-across-views-appjsx) |
| Rely on `setCurrentTrack` alone to (re)start playback | `<audio src>` comes from the track's path, so re-selecting the **already-loaded** track produces an identical src — React changes no DOM, `autoPlay` never re-fires, and the element stays paused mid-track. `playTrack` restarts it explicitly; keep that branch. |
| Set `isPlaying` optimistically before audio starts | The button then claims "playing" over silence, turning any playback failure into a "stuck" app. `onPlay`/`onPause` are the only source of truth. |
| Use `BrowserWindow.center()`, or resize a window without repositioning it | `setContentSize` pins the top-left corner, so a window that grows lands off-centre; and Electron's `center()` was measured ~40px off the work-area centre. [Details](docs/ARCHITECTURE.md#tag-editor-a-separate-window-not-a-view) |
| Reintroduce base64 artwork into track objects | The whole index/thumbnail architecture exists to keep it out of renderer heap. |
| Upgrade Electron without checking `LSMinimumSystemVersion` | Electron's macOS floor climbs over releases, and raising it **permanently drops the oldest supported Mac** — see [The macOS support floor](#the-macos-support-floor-and-why-electron-is-pinned) below. Nothing warns you; the build succeeds and the app simply refuses to launch there. |
| Ship a universal build without running `scripts/verify-bundle.sh` | A partial `lipo` merge leaves one helper arm64-only. The app launches on Intel and then dies in that process. Invisible on the machine that built it. |
| Move Inter back to a CDN `@import`, or break the bundled woff2 paths | The UI silently renders in `-apple-system` — no error, no console warning, just subtly wrong typography everywhere, and permanently so on an offline Mac. Guarded by a `FontFace.status` assertion; see below. |
| Test font loading with `document.fonts.check()` | It returns **true for a family that does not exist**, because the text is still renderable through the fallback chain. Verified against `__SonusNoSuchFont__`. Use `FontFace.status === 'loaded'` instead — `check()` makes the assertion pass unconditionally. |

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

- `webSecurity: false` in the `BrowserWindow` config is required for `file://` audio/art loading to work against the `http://localhost:5173` dev origin. Don't flip this without implementing a custom protocol handler as a replacement.
- `npm audit` reports `shell-quote` (transitive via `concurrently`) and `undici` (transitive via `electron-builder`'s `@electron/rebuild`/`node-gyp`, and via `jsdom`) advisories — both dev-only tooling, never shipped in the built app. Known, accepted risk; don't force-downgrade `concurrently` or otherwise "fix" these opportunistically.
- ~~Album art stored as full-resolution base64 in every track object~~ — **resolved** by the metadata-index/thumbnail architecture (tracks carry only a `sonus-thumb://` URL; full-res is on-demand for NP/Tag Editor). Don't reintroduce base64 into library track objects.
- Orphaned thumbnail files (tracks removed from the library, or art format changes leaving an old-extension file) are not garbage-collected — they're a few KB each in `userData/thumbs/`. Accepted; a cleanup sweep is a possible future follow-up, not a bug.
- Inter ships as `@fontsource/inter` (a devDependency — Vite inlines the CSS and emits the woff2 as hashed assets at build time, so nothing is needed at runtime). All **seven** subsets are bundled for the five weights, not just latin: the previous Google Fonts endpoint served them all via `unicode-range`, and bundling latin alone would silently drop Cyrillic and Greek track titles to the system font. Cost is ~520KB of woff2. `@fontsource` also references a legacy `.woff` per face, so ~680KB of never-loaded fallbacks ship too — Chromium always picks woff2. Accepted: ~0.14% of a ~500MB bundle, and stripping it would mean hand-maintaining 35 `@font-face` blocks or a fragile post-build rewrite.
- The packaged `app.asar` ships the ~320KB generated fixture MP3 and the `*.test.mjs` files (~14MB of its 25MB). **Deliberate, not an oversight** — it is exactly what lets the packaged app run its own `--smoke` suite on a target machine with no dev toolchain installed, which is how the Intel iMac gets machine-checked rather than eyeballed. A `files` exclude would save 14MB out of a 494MB bundle and cost on-device acceptance testing. Don't strip it without replacing that capability.
- The universal build is **unsigned and un-notarized** (no Apple Developer account). On Ventura the right-click → Open bypass still works, so it costs one extra click the first time on a given Mac. Note this bypass was removed in macOS 15 Sequoia, so a modern Mac needs System Settings → Privacy & Security → "Open Anyway" instead. `codesign --verify` fails strictly on the ad-hoc signature (`code has no resources but signature indicates they must be present`) — that is normal for electron-builder's unsigned output and matches the known-good baseline, which is why `verify-bundle.sh` reports it as info rather than asserting it.
- The `react-hooks/refs`, `react-hooks/set-state-in-effect`, and `react-hooks/immutability` ESLint rules are disabled in `eslint.config.js` — they're React-Compiler diagnostics, this project has no React Compiler, and the codebase's documented render-time mirror-ref idiom (`viewRef.current = view` etc.) is deliberate. Don't "fix" the idiom to re-enable them.
- The packaged app's Dock/Finder icon (`build/icon.icns`, embedded via `build.mac.icon`) shows inside an extra light gray/white rounded-square card that isn't part of the source artwork — confirmed via side-by-side screenshot against the dev-mode icon (set via `app.dock.setIcon()` in `electron/main.js`, which renders the raw artwork with no card). Root cause: macOS (Big Sur+) auto-wraps any app icon shipped as a plain `.icns` rather than a compiled Xcode Asset Catalog (`actool`/`Assets.car`) — confirmed not a padding/content issue, since the source icon's artwork already matches Apple's safe-zone spec almost exactly. The real fix needs full Xcode (only Command Line Tools are installed) plus a custom electron-builder build step to compile and inject an Asset Catalog — nontrivial and not guaranteed. User explicitly chose to accept this as-is (2026-06-18) since it's standard, near-universal cosmetic behavior for Electron/non-Xcode-Catalog apps on macOS. Don't attempt to "fix" this opportunistically.

### Genuinely dead code (unlike everything above, this *is* safe to delete)

Almost all of this file argues that something which looks removable is load-bearing. The inverse is worth writing down too, so the next reader doesn't have to re-derive it by grep. All of the following are verified unreferenced:

- **CSS in `index.css`** — `.track-header-sort-chip` (left over from the deleted Sort dropdown), `.track-list-header-title` and `.track-list-header-meta` (the deleted Library identity line, whose *absence* the smoke suite asserts), `.np-text-block`, and `--np-slider-color` (read via `var()` but never set anywhere, so it always renders its hardcoded fallback gradient).
- **`src/MarqueeText.jsx`** — committed but imported by nothing. The player panel uses the inline `.marquee-scroll` class instead, so the shared `@keyframes marquee-scroll` can be changed without touching this file.
- A **stale comment block** immediately above `.track-list-header` still describes the deleted sticky/`--scrolled` header design; the correct comment follows right after it.

Deleting these is safe but optional — they cost nothing at runtime, since unused CSS rules and an unimported module are dropped or never loaded by the bundler.

## Deep-dive reference

Everything below lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Read the relevant section *before* editing that area — most contain constraints that fail silently.
- [Home view (`src/HomeView.jsx`, `src/HomeDetailView.jsx`)](docs/ARCHITECTURE.md#home-view-srchomeviewjsx-srchomedetailviewjsx)
- [Scroll position preservation across views (`App.jsx`)](docs/ARCHITECTURE.md#scroll-position-preservation-across-views-appjsx)
- [Tracklist engine (`TrackList.jsx` + `TrackRow.jsx` + `TrackListHeader.jsx` + hooks)](docs/ARCHITECTURE.md#tracklist-engine-tracklistjsx-trackrowjsx-tracklistheaderjsx-hooks)
- [Column-cycle sorting (no Sort dropdown)](docs/ARCHITECTURE.md#column-cycle-sorting-no-sort-dropdown)
- [The column header lives OUTSIDE the scroll container](docs/ARCHITECTURE.md#the-column-header-lives-outside-the-scroll-container)
- [Player panel layout and stacking context](docs/ARCHITECTURE.md#player-panel-layout-and-stacking-context)
- [Sidebar (Home/Library, collapsible)](docs/ARCHITECTURE.md#sidebar-homelibrary-collapsible)
- [Track context menu (`trackMenu` state)](docs/ARCHITECTURE.md#track-context-menu-trackmenu-state)
- [IPC channel surface (`electron/preload.cjs` ↔ `electron/main.js`)](docs/ARCHITECTURE.md#ipc-channel-surface-electronpreloadcjs-electronmainjs)
- [Launch behavior: what library the app starts with](docs/ARCHITECTURE.md#launch-behavior-what-library-the-app-starts-with)
- [Finder Services integration ("Add to Queue" / "Play Next")](docs/ARCHITECTURE.md#finder-services-integration-add-to-queue-play-next)
- [Metadata index, thumbnails, play stats (`electron/indexStore.mjs` + `main.js`)](docs/ARCHITECTURE.md#metadata-index-thumbnails-play-stats-electronindexstoremjs-mainjs)
- [Artwork normalization and repair (`electron/artwork.mjs`)](docs/ARCHITECTURE.md#artwork-normalization-and-repair-electronartworkmjs)
- [Custom application menu (`buildAppMenu` in `main.js`)](docs/ARCHITECTURE.md#custom-application-menu-buildappmenu-in-mainjs)
- [Vibrancy and forced dark mode](docs/ARCHITECTURE.md#vibrancy-and-forced-dark-mode)
- [Artwork-derived color (`artworkRgb` / `bgColor`)](docs/ARCHITECTURE.md#artwork-derived-color-artworkrgb-bgcolor)
- [Now Playing glass backdrop — contrast guarantee](docs/ARCHITECTURE.md#now-playing-glass-backdrop-contrast-guarantee)
- [Now Playing artwork sizing](docs/ARCHITECTURE.md#now-playing-artwork-sizing)
- [Volume control](docs/ARCHITECTURE.md#volume-control)
- [Lyrics feature](docs/ARCHITECTURE.md#lyrics-feature)
- [Background playback / window lifecycle (macOS-specific)](docs/ARCHITECTURE.md#background-playback-window-lifecycle-macos-specific)
- [Tag Editor — a separate window, not a `view`](docs/ARCHITECTURE.md#tag-editor-a-separate-window-not-a-view)
- [Now Playing navigation and `previousView` invariants](docs/ARCHITECTURE.md#now-playing-navigation-and-previousview-invariants)
- [Missing file handling](docs/ARCHITECTURE.md#missing-file-handling)

## Working in this repo

- The current UI/UX (glassmorphism, colors, hover/drag effects, playback behavior) is considered intentionally finished — treat any visible or behavioral change as a regression unless the task explicitly calls for it. Glassmorphism depends on *all* of these together: the Electron window flags (`vibrancy: 'under-window'`, `visualEffectState: 'active'`, `transparent: true`, `backgroundColor: '#00000000'`), `nativeTheme.themeSource = 'dark'` in `main.js`, and the CSS (`body { background: transparent }`, `.glass-panel` `backdrop-filter`) — changing any one piece without the others breaks the look.
- **`test-fixture.mp3`** (repo root, ~320KB) is the audio file the smoke suite parses, tags, copies and re-opens — don't move, rename, or delete it. Make copies elsewhere (e.g. `/tmp`) for any test that needs to mutate it. It is generated, not a real song, because this repo is public: `node scripts/make-test-fixture.mjs` rebuilds it from MPEG-1 Layer III frame headers plus `scripts/fixture-cover.jpg`, using only `node-id3` (already a dependency — no ffmpeg needed). **Its 20-second length is load-bearing**: the suite seeks to 5s and then 7s and asserts the playhead landed there, so a shorter fixture makes those seeks clamp and fail for reasons unrelated to the behaviour under test.
- For *manual* listening tests (playback, marquee scrolling, lyrics, artwork colour) the fixture is 20 seconds of silence and therefore useless — keep a real track somewhere outside the repo for that.
- A plain Playwright/CDP screenshot of this app will render mostly blank/white — it can't capture macOS's vibrancy/transparency compositing. This is a known tooling limitation, not a visual regression; don't diff against headless screenshots as a correctness check. To verify visual changes: run `npm run dev`, then use `screencapture -x /tmp/sonus.png` (native macOS screenshot, which correctly captures vibrancy compositing). For pixel-level verification, use Python PIL (`from PIL import Image; img = Image.open('/tmp/sonus.png').convert('RGB'); img.getpixel((x, y))`). Retina displays produce 2× physical pixels, so logical coordinates must be doubled.
- This repo is published at **https://github.com/panawel/sonus-player** (MIT). Releases are built locally and attached to a GitHub Release — `release/` is gitignored, since the artifacts are ~224MB each and GitHub rejects files over 100MB. `.claude/settings.local.json` is gitignored too: it holds absolute paths from the developer's own machine. Before any commit that adds files, check that nothing personal or over ~1MB is staged.
