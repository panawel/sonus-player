#!/usr/bin/env python3
"""Builds the study-room scene's assets for Chill mode (src/chillRoomFx.js reads the mask
in a WebGL shader; src/ChillPosters.jsx reads the lighting). Needs only Pillow. Usage, from
the repo root:
  python3 scripts/make-chill-room-mask.py [--preview /path/overlay.png]

1. src/assets/chill/room-mask.png (half resolution, 1376x768):
     R window glass   - the two panes, where the rain runs (lamp, pencil cup, mullion, blind excluded)
     G string lights  - the column of fairy lights on the left wall
     B body           - her back and shoulders, for breathing
2. Refreshes `light` for every poster in src/chillRoomPosters.json — the room's own lighting
   measured from the original photo, so the song's artwork takes on the room's colour:
     tint  [r,g,b]   the colour cast of the light at the poster (0..255, brightest channel 255),
                     from a 150px window around it, eased 35% toward neutral so a mostly
                     orange corner doesn't turn the art into a flat orange wash
     left/right      the multiply colour at each side (0..1) — the falloff across the print
     dim             how dark prints are in this room at this spot (0.58..0.9): the original
                     print's mean luminance, mapped, so a poster in shade is darker than one
                     by the lamp
   The quads themselves come from scripts/fit-chill-room-posters.py; this only rewrites `light`.
3. src/assets/chill/room-glare.png (half resolution, RGB, black = nothing): the light that sits ON
   the original prints — the fairy lights' bokeh and glare, which the song's artwork would
   otherwise hide. It is laid over the art with a screen blend (index.css `.chill-glare`).
   Detected as warm, very bright, SMOOTH blobs (R > 205, much redder than blue, and not an edge;
   a lower R threshold picked up the warm skin of a face on a dim print as a faint ghost):
   printed lettering is bright too but sharp, and must not come back as a ghost of the old
   print, so a pixel only counts where the area around it (a 9px window) is flat. Restricted to
   the fitted prints' quads, feathered inward.

Polygons are in photo pixels (2752x1536), read off 1.0-1.6x zooms with a 50-100px grid;
calibrated to src/assets/chill/room.jpg — a different photo needs them redone.
"""
import json
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

SRC = 'src/assets/chill/room.jpg'
POSTERS = 'src/chillRoomPosters.json'
W, H = 2752, 1536

# The glass, MEASURED (luminance profiles across each border at many positions, line-fitted; see
# docs/ARCHITECTURE.md "the glass mask") and inset 2px so the drops never reach the frame, the
# mullion between the panes, or the white bevel and sill below. The borders are NOT axis-aligned:
#   left pane  : left edge x~1394 (the bright strip at 1388-1393 is the frame); right edge slants
#                from x=1757.8 at y=62 to x=1747.1 at y=830 (perspective); top edge runs
#                (1394,114)->(1756,58); the bottom is hidden by the laptop and the lamp (cut at y=832)
#   right pane : left edge x~1819 at y=100 -> 1812 at y=960; right edge x ~ 2285 - 0.038*y (it moves
#                from 2281 at y=100 to 2252 at y=880); bottom edge slopes from (1840,963) to (2020,977)
#                — below it are the dark seal, the white bevel and the sill, none of them glass;
#                the pen cup cuts the lower right.
# (An earlier hand-placed version had a vertical right edge at 2275, a flat bottom at 985 and a
#  vertical 1755 right edge for the left pane: 8-23px of drops landed on the frame, the mullion
#  and the bevel.)
GLASS_LEFT = [(1394.5, 116), (1755.5, 60), (1744.8, 830), (1394.5, 832), (1394.5, 780), (1440, 775), (1440, 650), (1394.5, 645)]
GLASS_RIGHT = [(1821.2, 41), (2279, 38), (2248, 915), (2150, 918), (2128, 983), (1840, 961), (1814.5, 959)]
LIGHTS = [(690, 0), (785, 0), (785, 780), (690, 780)]
BODY = [(920, 800), (1000, 778), (1120, 772), (1230, 802), (1310, 862), (1350, 950), (1300, 1100), (1150, 1250),
        (1010, 1260), (925, 1150), (898, 1000)]


def polygon_mask(points, blur, size=(W, H)):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).polygon(points, fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur)) if blur else m


def union(masks):
    out = masks[0]
    for m in masks[1:]:
        out = ImageChops.lighter(out, m)
    return out


def mean_rgb(img, box, quad=None):
    """Mean RGB of `img` inside `box` (optionally only inside the quad)."""
    x0, y0, x1, y1 = [int(v) for v in box]
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
    crop = img.crop((x0, y0, x1, y1))
    if quad is None:
        return ImageStat.Stat(crop).mean[:3]
    m = Image.new('L', crop.size, 0)
    ImageDraw.Draw(m).polygon([(x - x0, y - y0) for x, y in quad], fill=255)
    if m.getbbox() is None:
        return ImageStat.Stat(crop).mean[:3]
    return ImageStat.Stat(crop, m).mean[:3]


def lum(c):
    return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255.0


def poster_light(photo, quad):
    xs = [p[0] for p in quad]
    ys = [p[1] for p in quad]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    # the ambient light around the print: a 150px window (it includes the print and its
    # neighbours, which is fine — it is the room's light we want, not this print's content)
    amb = mean_rgb(photo, (cx - 75, cy - 75, cx + 75, cy + 75))
    left = mean_rgb(photo, (cx - 90, cy - 75, cx, cy + 75))
    right = mean_rgb(photo, (cx, cy - 75, cx + 90, cy + 75))
    top = max(amb) or 1.0
    tint = [255.0 * a / top for a in amb]
    tint = [round(255.0 - 0.65 * (255.0 - t)) for t in tint]       # ease toward neutral
    side = lambda c: [max(0.0, min(1.0, 0.55 + 0.45 * (v / top))) for v in c]
    own = mean_rgb(photo, (min(xs), min(ys), max(xs), max(ys)), quad)   # how dark the print is here
    dim = max(0.58, min(0.90, 0.40 + 1.10 * lum(own)))
    return {
        'tint': tint,
        'left': [round(v, 3) for v in side(left)],
        'right': [round(v, 3) for v in side(right)],
        'dim': round(dim, 3),
    }


def build_glare(data):
    photo = Image.open(SRC).convert('RGB')
    half = (W // 2, H // 2)
    small = photo.resize(half, Image.LANCZOS)
    r, g, b = small.split()
    warm = ImageChops.subtract(r, b)
    # bright, warm...
    mask = ImageChops.multiply(r.point(lambda v: 255 if v > 205 else 0), warm.point(lambda v: 255 if v > 55 else 0))
    # ...and smooth: a window around the pixel has little local contrast (text strokes fail this)
    l = small.convert('L')
    local = ImageChops.subtract(l.filter(ImageFilter.MaxFilter(9)), l.filter(ImageFilter.MinFilter(9)))
    flat = local.point(lambda v: 255 if v < 105 else 0)
    mask = ImageChops.multiply(mask, flat).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(3.0))
    # only on the fitted prints
    inside = Image.new('L', half, 0)
    dr = ImageDraw.Draw(inside)
    for p in data['posters']:
        if p.get('fit', {}).get('ok'):
            dr.polygon([(x / 2, y / 2) for x, y in p['quad']], fill=255)
    inside = inside.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.0))
    mask = ImageChops.multiply(mask, inside)
    glare = ImageChops.multiply(small, Image.merge('RGB', (mask, mask, mask)))
    glare = glare.point(lambda v: min(255, int(v * 0.95)))
    glare.save('src/assets/chill/room-glare.png', optimize=True)
    print('wrote src/assets/chill/room-glare.png', half)
    return glare


def refresh_lighting():
    photo = Image.open(SRC).convert('RGB')
    data = json.load(open(POSTERS))
    for p in data['posters']:
        p['light'] = poster_light(photo, p['quad'])
    with open(POSTERS, 'w') as f:
        # compact one-line posters, keep it diffable
        f.write('{\n  "_doc": %s,\n  "posters": [\n' % json.dumps(data['_doc']))
        f.write(',\n'.join('    ' + json.dumps(p, separators=(', ', ': ')) for p in data['posters']))
        f.write('\n  ]\n}\n')
    print('refreshed lighting for', len(data['posters']), 'posters in', POSTERS)
    return data


def main():
    glass = union([polygon_mask(GLASS_LEFT, 1.5), polygon_mask(GLASS_RIGHT, 1.5)])
    lights = polygon_mask(LIGHTS, 10)
    body = polygon_mask(BODY, 45)
    half = (W // 2, H // 2)
    Image.merge('RGB', (glass.resize(half, Image.LANCZOS), lights.resize(half, Image.LANCZOS), body.resize(half, Image.LANCZOS))) \
        .save('src/assets/chill/room-mask.png', optimize=True)
    print('wrote src/assets/chill/room-mask.png', half)
    data = refresh_lighting()
    glare = build_glare(data)

    if '--preview' in sys.argv:
        path = sys.argv[sys.argv.index('--preview') + 1]
        t = Image.open(SRC).convert('RGB')
        for mask, color, k in ((glass, (0, 230, 255), 0.4), (lights, (255, 230, 0), 0.3), (body, (255, 0, 200), 0.35)):
            t = Image.composite(Image.new('RGB', (W, H), color), t, mask.point(lambda v, k=k: int(v * k)))
        d = ImageDraw.Draw(t)
        for p in data['posters']:
            d.polygon([tuple(q) for q in p['quad']], outline=(0, 255, 0), width=2)
        t.resize(half, Image.LANCZOS).save(path)
        print('preview', path)


if __name__ == '__main__':
    main()
