#!/usr/bin/env python3
"""Builds the macOS app icon: build/icon.png (the 1024 master, also used for the dev Dock icon) and
build/icon.icns (what electron-builder packages) from build/icon-art.png. Needs only Pillow plus macOS's
`iconutil`. From the repo root:
  python3 scripts/make-app-icon.py

WHY THE SHAPE MATTERS (this is the whole point of the script). On macOS 26+/27 an icon whose alpha outline
is not Apple's icon-template squircle is treated as a legacy icon and drawn SMALL on a light-grey plate. The
decision is made from the ALPHA OUTLINE ALONE — not the size, not a shadow or rim, not the Info.plist, not the
SDK the binary is linked against: with Sonus's colours and another app's outline it is un-plated; with Sonus's
outline and the other app's shadow it is plated. A plain rounded square (circular corner arcs, radius ~190)
was NOT accepted even at the right 824/1024 size; a superellipse |x|^n + |y|^n = 1 with n = 5 (IoU 0.993
against the outline of an icon macOS accepts) is. So the mask below is that curve, not a rounded rect.
Layout: 824x824 centred (x=y=100), the ~100px border fully transparent.

build/icon-art.png is the 824x824 OPAQUE artwork (no transparent corners: the mask cuts the shape, and
transparent-black corners would show as dark fringes where a squircle reaches past a rounded rect).
"""
import os, shutil, subprocess, tempfile
from PIL import Image

N = 5.0             # superellipse exponent
SIZE, BOX, OFF = 1024, 824, 100
SS = 4              # mask supersampling, for a clean anti-aliased edge
ICONSET = {'icon_16x16.png': 16, 'icon_16x16@2x.png': 32, 'icon_32x32.png': 32, 'icon_32x32@2x.png': 64,
           'icon_128x128.png': 128, 'icon_128x128@2x.png': 256, 'icon_256x256.png': 256, 'icon_256x256@2x.png': 512,
           'icon_512x512.png': 512, 'icon_512x512@2x.png': 1024}


def squircle_mask():
    w = SIZE * SS
    m = Image.new('L', (w, w), 0)
    px = m.load()
    c = w / 2
    hw = BOX / 2 * SS
    for y in range(w):
        dy = abs(y + 0.5 - c) / hw
        if dy > 1:
            continue
        for x in range(w):
            dx = abs(x + 0.5 - c) / hw
            if dx <= 1 and dx ** N + dy ** N <= 1:
                px[x, y] = 255
    return m.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    art = Image.open('build/icon-art.png').convert('RGB')
    assert art.size == (BOX, BOX), f'build/icon-art.png must be {BOX}x{BOX}, got {art.size}'
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(art, (OFF, OFF))
    canvas.putalpha(squircle_mask())
    canvas.save('build/icon.png', optimize=True)
    d = tempfile.mkdtemp(suffix='.iconset')
    for name, px in ICONSET.items():
        (canvas if px == SIZE else canvas.resize((px, px), Image.LANCZOS)).save(os.path.join(d, name))
    subprocess.check_call(['iconutil', '-c', 'icns', d, '-o', 'build/icon.icns'])
    shutil.rmtree(d)
    print('wrote build/icon.png and build/icon.icns')


if __name__ == '__main__':
    main()
