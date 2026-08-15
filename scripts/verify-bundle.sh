#!/bin/bash
# Structural verification for a packaged Sonus.app.
#
# Written to catch the ways a *universal* (x86_64 + arm64) build silently goes
# wrong. The dangerous failures here are not build errors — they are builds that
# succeed, launch fine on the machine that made them, and then break on Intel:
#
#   - a partial lipo merge leaving one helper arm64-only (app launches, then the
#     renderer/GPU process dies on Intel)
#   - @electron/universal falling back to dual app-x64/app-arm64.asar
#   - file associations or the Finder Service bundles lost in the merge
#   - an Electron upgrade silently raising LSMinimumSystemVersion past the
#     oldest supported Mac (iMac 2017 tops out at macOS 13 — it can never go
#     higher, so a floor of 14 permanently excludes it)
#
# Usage: scripts/verify-bundle.sh [path/to/Sonus.app] [--expect-universal|--expect-arch <arch>]
# Exits 0 if every check passes, 1 otherwise.

set -uo pipefail

APP="${1:-release/mac-universal/Sonus.app}"
EXPECT="${2:---expect-universal}"
EXPECT_ARCH="${3:-}"

MIN_MACOS_EXPECTED="12.0"
REQUIRED_EXTS="mp3 flac wav ogg aac m4a"

pass=0; fail=0
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; pass=$((pass+1)); }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$1"; fail=$((fail+1)); }
head_() { printf "\n\033[1m%s\033[0m\n" "$1"; }

if [ ! -d "$APP" ]; then
  echo "No app bundle at: $APP" >&2
  exit 1
fi
echo "Verifying: $APP"

# ── 1. Every Mach-O binary carries every expected slice ──────────────────────
# The single most important check. A partial merge is invisible until an Intel
# user hits the one process that was not merged.
head_ "1. Architecture coverage (all Mach-O binaries)"
mach_os=$(find "$APP" -type f \( -perm +111 -o -name "*.dylib" -o -name "*.so" \) 2>/dev/null)
total=0; bad_arch=0; archset=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  archs=$(lipo -archs "$f" 2>/dev/null) || continue
  [ -z "$archs" ] && continue
  total=$((total+1))
  archset="$archset\n$archs"
  case "$EXPECT" in
    --expect-universal)
      if ! (echo "$archs" | grep -q x86_64 && echo "$archs" | grep -q arm64); then
        bad "not universal ($archs): ${f#$APP/}"; bad_arch=$((bad_arch+1))
      fi ;;
    --expect-arch)
      if [ "$archs" != "$EXPECT_ARCH" ]; then
        bad "expected $EXPECT_ARCH, got $archs: ${f#$APP/}"; bad_arch=$((bad_arch+1))
      fi ;;
  esac
done <<< "$mach_os"

if [ "$total" -eq 0 ]; then
  bad "no Mach-O binaries found — is this a real .app?"
else
  echo "     scanned $total Mach-O binaries; distinct arch sets:"
  printf "$archset" | sed '/^$/d' | sort | uniq -c | sed 's/^/       /'
  [ "$bad_arch" -eq 0 ] && ok "all $total binaries carry the expected architectures"
fi

# Helpers are the classic partial-merge casualty — name them explicitly so a
# miss is obvious rather than buried in a count.
for helper in "Sonus Helper" "Sonus Helper (GPU)" "Sonus Helper (Plugin)" "Sonus Helper (Renderer)"; do
  hb="$APP/Contents/Frameworks/$helper.app/Contents/MacOS/$helper"
  if [ -f "$hb" ]; then
    a=$(lipo -archs "$hb" 2>/dev/null)
    if [ "$EXPECT" = "--expect-universal" ]; then
      echo "$a" | grep -q x86_64 && echo "$a" | grep -q arm64 \
        && ok "helper universal: $helper ($a)" || bad "helper NOT universal: $helper ($a)"
    else
      ok "helper present: $helper ($a)"
    fi
  else
    bad "helper missing: $helper"
  fi
done

# ── 2. macOS floor ───────────────────────────────────────────────────────────
head_ "2. Minimum macOS version"
MIN=$(/usr/libexec/PlistBuddy -c "Print :LSMinimumSystemVersion" "$APP/Contents/Info.plist" 2>/dev/null)
if [ "$MIN" = "$MIN_MACOS_EXPECTED" ]; then
  ok "LSMinimumSystemVersion = $MIN (iMac 2017 on 13.7.8 clears this)"
else
  bad "LSMinimumSystemVersion = ${MIN:-unset}, expected $MIN_MACOS_EXPECTED"
  echo "     ⚠ If Electron raised its floor: anything above 13.x permanently"
  echo "       excludes the iMac 2017, which cannot install macOS 14."
fi

# ── 3. File associations survived the merge ──────────────────────────────────
head_ "3. File associations"
EXTS=$(plutil -convert json -o - "$APP/Contents/Info.plist" 2>/dev/null | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
s=set()
for t in d.get('CFBundleDocumentTypes',[]) or []:
    for e in (t.get('CFBundleTypeExtensions') or []): s.add(e.lower())
print(' '.join(sorted(s)))
" 2>/dev/null)
for e in $REQUIRED_EXTS; do
  echo " $EXTS " | grep -q " $e " && ok "handles .$e" || bad "missing association: .$e"
done

# ── 4. Finder Services resources ─────────────────────────────────────────────
head_ "4. Finder Service bundles (extraResources)"
for svc in "Add to Queue in Sonus.workflow" "Play Next in Sonus.workflow"; do
  d="$APP/Contents/Resources/services/$svc"
  if [ -f "$d/Contents/document.wflow" ] && [ -f "$d/Contents/Info.plist" ]; then
    ok "$svc"
  else
    bad "$svc missing or incomplete"
  fi
done

# ── 5. Single merged asar ────────────────────────────────────────────────────
# Dual app-x64.asar / app-arm64.asar means @electron/universal could not merge
# and fell back — the app still works, but it silently doubles in size and the
# two copies can drift.
head_ "5. ASAR merge"
asars=$(find "$APP/Contents/Resources" -maxdepth 1 -name "*.asar" 2>/dev/null | sort)
n_asar=$(echo "$asars" | sed '/^$/d' | wc -l | tr -d ' ')
if [ "$n_asar" = "1" ] && [ -f "$APP/Contents/Resources/app.asar" ]; then
  ok "single merged app.asar ($(du -h "$APP/Contents/Resources/app.asar" | cut -f1))"
else
  bad "expected exactly one app.asar, found $n_asar:"
  echo "$asars" | sed 's/^/       /'
  echo "     ⚠ dual asars = @electron/universal merge fell back"
fi

# ── 6. ASAR payload ──────────────────────────────────────────────────────────
# The asar header is a JSON blob whose length is given by a 4-byte LE field at
# offset 12. Parsed with node rather than grepped: the header is ~118KB and is
# followed by binary payload, which bash command substitution silently mangles
# (null bytes cannot live in a shell variable) — that produced false failures.
head_ "6. ASAR contents"
ASAR="$APP/Contents/Resources/app.asar"
if [ -f "$ASAR" ]; then
  ASAR_HDR=$(node -e '
    const fs = require("fs");
    const fd = fs.openSync(process.argv[1], "r");
    const b = Buffer.alloc(16);
    fs.readSync(fd, b, 0, 16, 0);
    const len = b.readUInt32LE(12);
    const j = Buffer.alloc(len);
    fs.readSync(fd, j, 0, len, 16);
    fs.closeSync(fd);
    process.stdout.write(j.toString("utf8"));
  ' "$ASAR" 2>/dev/null)

  if [ -z "$ASAR_HDR" ]; then
    bad "could not parse asar header"
  else
    for want in "index.html" "main.js" "preload.cjs" "smokeTest.mjs"; do
      case "$ASAR_HDR" in
        *"$want"*) ok "asar contains $want" ;;
        *)         bad "asar missing $want" ;;
      esac
    done
    # The fixture is what lets the packaged app run its own --smoke suite on a
    # target machine. If it is ever stripped, on-device acceptance testing goes.
    case "$ASAR_HDR" in
      *"test-fixture.mp3"*) ok "smoke fixture present (packaged --smoke will work on the target Mac)" ;;
      *)                    bad "smoke fixture absent — packaged --smoke cannot run on the target Mac" ;;
    esac
  fi
else
  bad "no app.asar to inspect"
fi

# ── 7. Signature ─────────────────────────────────────────────────────────────
# arm64 code must carry at least an ad-hoc signature or macOS refuses to load
# it, so the *presence* of a signature is asserted.
#
# `codesign --verify` is reported but NOT asserted: it already fails on the
# known-good shipping arm64 build with "code has no resources but signature
# indicates they must be present", which is normal for electron-builder's
# unsigned ad-hoc output. The app runs and passes the full --smoke suite in
# that state. A check that fails on a known-good baseline is a broken check,
# so it stays informational until the build is genuinely signed + notarized.
head_ "7. Code signature"
SIG=$(codesign -dv "$APP" 2>&1)
if echo "$SIG" | grep -q "Signature=adhoc"; then
  ok "ad-hoc signed (required for arm64 code to load; expected when unsigned)"
elif echo "$SIG" | grep -q "Authority="; then
  ok "signed: $(echo "$SIG" | grep 'Authority=' | head -1 | sed 's/.*Authority=//')"
else
  bad "no signature at all — the arm64 slice will refuse to launch"
fi
if codesign --verify "$APP" 2>/dev/null; then
  echo "     (info) codesign --verify: clean"
else
  echo "     (info) codesign --verify: strict check fails — expected for an unsigned"
  echo "            ad-hoc build; matches the known-good arm64 baseline"
fi

# ── 8. Bundle size ───────────────────────────────────────────────────────────
head_ "8. Size"
echo "     app: $(du -sh "$APP" | cut -f1)"
FW="$APP/Contents/Frameworks/Electron Framework.framework"
[ -d "$FW" ] && echo "     Electron Framework: $(du -sh "$FW" | cut -f1)"
for dmg in release/*.dmg; do
  [ -f "$dmg" ] && echo "     $(basename "$dmg"): $(du -sh "$dmg" | cut -f1)"
done

# ── Result ───────────────────────────────────────────────────────────────────
printf "\n\033[1m%d passed, %d failed\033[0m\n" "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
