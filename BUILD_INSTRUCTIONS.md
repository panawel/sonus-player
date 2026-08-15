# Packaging Sonus for macOS

Builds a native, **universal** `.app` — one bundle that runs on both Apple Silicon and Intel Macs — plus a `.dmg` and `.zip` for moving it to another machine.

## What the build produces

| Artifact | Size | Notes |
| --- | --- | --- |
| `release/mac-universal/Sonus.app` | ~494MB | The bundle itself |
| `release/Sonus-0.0.0-universal.dmg` | ~224MB | For transferring to another Mac |
| `release/Sonus-0.0.0-universal-mac.zip` | ~224MB | Same, as a zip |

The size roughly doubles versus a single-architecture build because both slices of the Electron framework (262MB each) ship in one bundle. Everything else in the app is architecture-independent — there are no native Node modules, which is what makes the merge trivial.

## Supported macOS versions

**macOS 12.0 (Monterey) or newer**, set by Electron itself rather than by us. The oldest machine this is built for is an **iMac 27" 5K 2017 on Ventura 13.7.8**.

Read [The macOS support floor](CLAUDE.md#the-macos-support-floor-and-why-electron-is-pinned) in `CLAUDE.md` before upgrading Electron — that machine tops out at Ventura, so an Electron release requiring macOS 14 would exclude it permanently. This is why `electron` is pinned to an exact version.

---

## 1. Stop the dev server

```bash
pkill -f "mp3Player/node_modules"
```

Scope the pattern to this project — a bare `pkill -f Electron` also kills VS Code and any other Electron app.

## 2. Build

```bash
npm run build
```

Takes ~40 seconds. electron-builder packages the app once per architecture into `release/mac-universal-{x64,arm64}-temp/`, then merges them with `@electron/universal` into `release/mac-universal/`. The temp directories are scratch and can be deleted.

**The first universal build needs network access** — it downloads the x64 Electron dist (~100MB) that this machine has never needed before. It is cached in `~/Library/Caches/electron` afterwards.

You will see `skipped macOS application code signing` — expected, see [Distribution](#5-installing-on-another-mac).

## 3. Verify the bundle (structural)

```bash
./scripts/verify-bundle.sh
```

21 checks, exits 0/1. The important one is the first: **every Mach-O binary must carry both architectures.** A partial merge leaves, say, `Sonus Helper (Renderer)` as arm64-only — the app then launches perfectly on Intel and dies the moment it spawns that process. It is invisible on the machine that built it.

Also asserts `LSMinimumSystemVersion`, all six file associations, both Finder Service bundles, a single merged `app.asar` (dual `app-x64.asar`/`app-arm64.asar` means the merge silently fell back), and that the smoke fixture is present.

To check a single-architecture build instead:

```bash
./scripts/verify-bundle.sh release/mac-arm64/Sonus.app --expect-arch arm64
```

## 4. Verify the app works (functional)

The packaged app can run the full smoke suite against itself — the fixture MP3 and `smokeTest.mjs` ship inside `app.asar`:

```bash
# Native slice
release/mac-universal/Sonus.app/Contents/MacOS/Sonus --smoke

# Intel slice, translated — only possible on Apple Silicon
arch -x86_64 release/mac-universal/Sonus.app/Contents/MacOS/Sonus --smoke
```

Each prints one `SMOKE_RESULT:{...}` line and exits 0/1. Check `"ok":true`, and confirm `"arch"` is the slice you meant to test — a universal binary can run as either, so the field is the only proof.

**What the Rosetta run does and does not prove.** It exercises the genuine Intel binary and every code path in it. It does **not** validate the target OS's APIs or its GPU: Rosetta translates CPU instructions only, so the graphics work is still being done by the host Mac's GPU. Testing on the actual machine is not optional.

Useful confirmation that both slices are really present:

```bash
lipo -archs release/mac-universal/Sonus.app/Contents/MacOS/Sonus
# → x86_64 arm64

ELECTRON_RUN_AS_NODE=1 arch -x86_64 \
  release/mac-universal/Sonus.app/Contents/MacOS/Sonus -p "process.arch"
# → x64
```

On an arm64-only build the second command fails with `Bad CPU type in executable` — precisely what an Intel Mac would report.

## 5. Installing on another Mac

Copy the `.dmg` (or `.zip`) over — AirDrop, USB, network share — and drag `Sonus.app` into `/Applications`.

**`/Applications` matters for more than tidiness.** macOS only registers file associations and Finder Services for an app it has indexed there. Running it from `~/Downloads` gives you a working player with no double-click-to-open and no Services menu entries.

### Gatekeeper

The build is unsigned and un-notarized, so a transferred copy is quarantined:

- **macOS 12–14:** right-click the app → **Open** → confirm. Once per machine.
- **macOS 15 Sequoia and newer:** that bypass was removed. Use System Settings → Privacy & Security → **Open Anyway**.
- Or clear the flag directly:
  ```bash
  xattr -dr com.apple.quarantine /Applications/Sonus.app
  ```

### Acceptance test on the target machine

No dev toolchain required — the packaged app tests itself:

```bash
/Applications/Sonus.app/Contents/MacOS/Sonus --smoke
```

The JSON line reports correctness plus `arch`, `osRelease`, and a `metrics` object containing real frame times for that hardware (`frameTimeMs.baseline` in Library versus `frameTimeMs.nowPlaying` with the blur furnace running, and `npCostRatio` between them). That is how the glassmorphism is evaluated on a given GPU — a measurement, not an impression.

If timing-sensitive checks look flaky on genuinely slow hardware, raise the settle multiplier:

```bash
SONUS_SMOKE_SLOW=3 /Applications/Sonus.app/Contents/MacOS/Sonus --smoke
```

### First launch

Launch it once from `/Applications` before expecting the Finder integration to work:

- **Finder Services** ("Add to Queue in Sonus" / "Play Next in Sonus") are installed into `~/Library/Services` at startup, and only take effect from the *next* launch. They appear under right-click → Services, and are listed in System Settings → Keyboard → Keyboard Shortcuts → Services.
- **File associations** are registered by macOS when it indexes the app. To make Sonus the default for a format: right-click any audio file → Get Info → "Open with:" → Sonus → Change All.

---

## Building for a single architecture

The universal target is set in `package.json` under `build.mac.target`. For smaller, per-architecture artifacts:

```json
"target": [
  { "target": "dmg", "arch": ["arm64", "x64"] },
  { "target": "zip", "arch": ["arm64", "x64"] }
]
```

That produces two ~125MB DMGs instead of one ~224MB universal DMG, at the cost of having to hand the right file to each machine.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Bad CPU type in executable` | Running an arm64-only build on Intel, or under `arch -x86_64`. Rebuild universal. |
| Verify reports dual `app-x64.asar`/`app-arm64.asar` | `@electron/universal` could not merge the two builds. Usually an install-time script producing arch-specific files in a production dependency. |
| Verify reports a helper as not universal | Partial merge — rebuild from clean (`rm -rf release/mac-universal*`). |
| `codesign --verify` fails | Expected for unsigned ad-hoc output; matches the known-good baseline. Not a blocker. |
| Build fails downloading Electron | The first universal build needs network for the x64 dist. |
| No Services menu entries | App not in `/Applications`, or not yet launched once from there. |
