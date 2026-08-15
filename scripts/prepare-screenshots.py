#!/usr/bin/env python3
"""Turn the raw macOS captures in screenshoots/ into the README assets in docs/assets/.

Two things happen here beyond resizing.

1. Redaction. The Tag Editor's File field showed a real absolute path containing
   the developer's macOS username and personal folder structure. macOS captured
   that field as fully transparent (alpha 0) with all-zero RGB underneath, so the
   text is already unrecoverable — but flattened for the web it renders as an
   ugly black bar. It is repainted with the field's own background colour and a
   generic ~/Music path, so the screenshot looks intentional rather than censored.

2. Flattening. The captures are RGBA. GitHub renders README images over a
   light or dark page depending on the viewer's theme, so any transparency
   would show through inconsistently. Everything is composited onto an opaque
   background before saving.

Run: python3 scripts/prepare-screenshots.py
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "screenshoots"
OUT = ROOT / "docs" / "assets"
TARGET_WIDTH = 1600  # 2x the ~800px column GitHub renders, so it stays crisp

FIELD_BG = (75, 77, 81)
FIELD_TEXT = (168, 172, 178)
REPLACEMENT_PATH = "~/Music/Eminem/The Eminem Show/14 Hallie's Song.mp3"

# name -> (source file, needs redaction)
MAPPING = {
    "hero":          ("Screenshot 2026-08-15 at 23.35.20.png", False),
    "library":       ("Screenshot 2026-08-15 at 23.34.53.png", False),
    "home":          ("Screenshot 2026-08-15 at 23.37.43.png", False),
    "stats":         ("Screenshot 2026-08-15 at 23.41.59.png", False),
    "now-playing":   ("Screenshot 2026-08-15 at 23.36.15.png", False),
    "artist":        ("Screenshot 2026-08-15 at 23.41.09.png", False),
    "tag-editor":    ("Screenshot 2026-08-15 at 23.38.42.png", True),
    "search-online": ("Screenshot 2026-08-15 at 23.38.59.png", True),
}


def transparent_bbox(im):
    """Bounding box of non-opaque pixels, or None."""
    if im.mode != "RGBA":
        return None
    alpha = im.getchannel("A")
    # point() -> 255 where transparent, so getbbox() finds that region
    return alpha.point(lambda a: 255 if a < 250 else 0).getbbox()


def load_font(size):
    for path in ("/System/Library/Fonts/HelveticaNeue.ttc",
                 "/System/Library/Fonts/Helvetica.ttc",
                 "/System/Library/Fonts/Supplemental/Arial.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def redact(im):
    """Repaint the transparent File field with a generic path."""
    box = transparent_bbox(im)
    if box is None:
        print("     no transparent region found — nothing to redact")
        return im
    x0, y0, x1, y1 = box
    # Bleed one pixel outwards so no dark fringe from the original survives.
    x0, y0, x1, y1 = x0 - 1, y0 - 1, x1 + 1, y1 + 1
    d = ImageDraw.Draw(im)
    d.rectangle([x0, y0, x1, y1], fill=FIELD_BG + (255,))
    h = y1 - y0
    font = load_font(int(h * 0.52))
    # Vertically centre using the real glyph box rather than guessing.
    tb = d.textbbox((0, 0), REPLACEMENT_PATH, font=font)
    ty = y0 + (h - (tb[3] - tb[1])) // 2 - tb[1]
    d.text((x0 + int(h * 0.42), ty), REPLACEMENT_PATH, font=font, fill=FIELD_TEXT + (255,))
    print(f"     redacted {x1-x0}x{y1-y0}px at ({x0},{y0})")
    return im


def main():
    if not SRC.is_dir():
        sys.exit(f"missing source directory: {SRC}")
    OUT.mkdir(parents=True, exist_ok=True)

    for name, (filename, needs_redaction) in MAPPING.items():
        src = SRC / filename
        if not src.exists():
            print(f"  !! missing {filename}")
            continue
        im = Image.open(src)
        print(f"  {name}: {im.size[0]}x{im.size[1]} {im.mode}")

        if needs_redaction:
            im = im.convert("RGBA")
            im = redact(im)

        # Composite onto opaque black so nothing shows through GitHub's theme.
        if im.mode == "RGBA":
            bg = Image.new("RGBA", im.size, (0, 0, 0, 255))
            im = Image.alpha_composite(bg, im)
        im = im.convert("RGB")

        w, h = im.size
        im = im.resize((TARGET_WIDTH, round(h * TARGET_WIDTH / w)), Image.LANCZOS)

        dest = OUT / f"{name}.png"
        im.save(dest, "PNG", optimize=True)
        print(f"     -> {dest.relative_to(ROOT)}  {dest.stat().st_size/1024:.0f}KB  {im.size[0]}x{im.size[1]}")


if __name__ == "__main__":
    main()
