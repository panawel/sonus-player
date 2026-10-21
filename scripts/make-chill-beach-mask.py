#!/usr/bin/env python3
"""Builds src/assets/chill/beach-mask.png, the "living photo" masks for Chill mode's
hammock scene (src/ChillLivingPhoto.jsx reads them in a WebGL shader).

Channels (half resolution, 1376x768):
  R  palm sway weight   - green foliage found by colour, tapered so it grows with the
                          distance down from the top edge (fronds attach above the
                          frame), distant jungle damped. 0 on trunks, sky, people.
  G  sea ripple weight  - the sea band, found by colour (blue water; the hammock, legs
                          and sand are not) plus one polygon where the sun glitter is
                          too white to pass a colour test.
  B  shore weight       - where waves wash up the sand (the foam bands on the right, the
                          small wash on the far left): the shader surges, retreats and
                          foams this band. (Sea depth is no longer stored: it is just a
                          function of y, computed in the shader.)
  A  255 (unused)

Also writes beach-body.png (RGB, half resolution) for the hammock's swing (see
ChillLivingPhoto.jsx and chillBeach.js SWAY):
  R  body weight    - the hammock + the man + the phone as ONE body. Traced as a union of
                      polygons with a small (8px) feather: the net's real right edge, the
                      diagonal lower-left edge of the net, each hanging rope bundle on its
                      own (the sand BETWEEN them must not move), the head. An earlier
                      rough outline with a 45px feather dragged the lower-left sand along
                      with the hammock. Holes in the net show background that moves a
                      little with it — acceptable because that background is out of focus.
  G  hanging weight - the rope bundles and the fringe tassel that hang freely and so swing
                      with a lag, more at the tips.
  B  hang factor    - 0 where a hanging rope is attached -> 1 at its tip.
"""
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SRC = 'src/assets/chill/beach.jpg'
OUT = 'src/assets/chill/beach-mask.png'
OUT_BODY = 'src/assets/chill/beach-body.png'
K = 1.376  # the polygons below were read off a 2000px-wide view of the 2752px photo


def poly(points):
    return [(x * K, y * K) for x, y in points]


def polygon_mask(size, points, blur=0):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).polygon(poly(points), fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur)) if blur else m


def column_ramp(size, fn):
    """An 'L' image whose value depends only on y: fn(y) -> 0..1. (Built as one column
    and stretched: per-pixel Python loops over 4M pixels take ages.)"""
    w, h = size
    col = Image.new('L', (1, h))
    col.putdata([int(255 * max(0.0, min(1.0, fn(y)))) for y in range(h)])
    return col.resize(size, Image.NEAREST)


def row_ramp(size, fn):
    w, h = size
    row = Image.new('L', (w, 1))
    row.putdata([int(255 * max(0.0, min(1.0, fn(x)))) for x in range(w)])
    return row.resize(size, Image.NEAREST)


def threshold(img, lo):
    return img.point(lambda v: 255 if v > lo else 0)


def main():
    photo = Image.open(SRC).convert('RGB')
    W, H = photo.size
    r, g, b = photo.split()

    # ── palms: foliage found by hue ─────────────────────────────────────────
    # Sunlit fronds are yellow-green (R is NOT below G: e.g. 144,130,59), so a
    # "green dominant" test misses them. Hue separates them cleanly: fronds sit at
    # ~45-150 degrees, trunks / skin / sand below ~35. PIL's H runs 0-255.
    hsv = photo.convert('HSV')
    hh, ss, vv = hsv.split()
    lo, hi = int(40 / 360 * 255), int(160 / 360 * 255)
    in_hue = hh.point(lambda v: 255 if lo <= v <= hi else 0)
    saturated = threshold(ss, 95)
    lit = threshold(vv, 40)
    fronds = ImageChops.multiply(ImageChops.multiply(in_hue, saturated), lit)
    fronds = fronds.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(2.5))
    # taper: fronds attach above the top edge, so they move more the lower they hang
    palm = ImageChops.multiply(fronds, column_ramp((W, H), lambda y: 0.35 + 0.65 * min(1.0, y / 380.0)))
    # distant jungle along the left shore: only a whisper of movement
    jungle = polygon_mask((W, H), [(60, 110), (470, 120), (470, 262), (60, 262)], 6)
    damp = ImageChops.invert(jungle).point(lambda v: v)  # 255 outside, 0 inside
    damp = damp.point(lambda v: int(90 + (v / 255) * 165))
    palm = ImageChops.multiply(palm, damp)

    # ── sea ─────────────────────────────────────────────────────────────────
    blue = threshold(ImageChops.subtract(b, r), 10)
    main_band = polygon_mask((W, H), [
        (130, 262), (2000, 242), (2000, 585), (1700, 520), (1500, 470), (1300, 430), (1100, 405),
        (880, 400), (700, 360), (440, 370), (330, 300), (150, 285)], 2)
    sea_main = ImageChops.multiply(main_band, blue)
    glitter = polygon_mask((W, H), [(1600, 244), (2000, 242), (2000, 585), (1700, 545), (1600, 480)], 6)
    # ramp the glitter polygon in over ~180px so the ripple amplitude doesn't jump
    # at a seam where the colour-tested sea hands over to it
    glitter = ImageChops.multiply(glitter, row_ramp((W, H), lambda x: (x - 1630 * K) / (190 * K)))
    sea = ImageChops.lighter(sea_main, glitter).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(2.5))

    # ── shore: where the waves wash up the sand (orig px, read off 1.0-1.2x zooms) ──
    # Right: the breaking foam bands and the wet sand under them, kept clear of the
    # hammock's net (which ends near x~2110). Left: the small foam wash left of the
    # palm trunk. Edges feathered so the surge fades in and out instead of showing a seam.
    def px_polygon(points, blur):
        m = Image.new('L', (W, H), 0)
        ImageDraw.Draw(m).polygon(points, fill=255)
        return m.filter(ImageFilter.GaussianBlur(blur))
    shore_right = px_polygon([(2150, 540), (2752, 500), (2752, 800), (2300, 800), (2120, 780), (2110, 650)], 22)
    shore_left = px_polygon([(110, 395), (310, 370), (320, 470), (260, 480), (120, 450)], 14)
    shore = ImageChops.lighter(shore_right, shore_left)

    # ── body: the hammock + the man + the phone, traced precisely (orig px) ─────
    # Read off 1.0-1.2x zooms with a 100px grid. The pieces overlap and are unioned.
    main_body = [
        # ropes above the bar up to the anchor on the trunk (they barely move: weights
        # ramp with distance below the anchor in the shader), then the net's right edge
        (1990, 0), (2260, 0), (2270, 440), (2262, 470), (2205, 475), (2172, 540), (2139, 590), (2094, 657),
        (2050, 722), (2017, 783), (1983, 850), (1950, 928), (1922, 1017), (1894, 1106), (1867, 1161),
        (1833, 1228), (1800, 1300), (1772, 1356), (1728, 1417), (1683, 1446), (1620, 1500), (1560, 1536),
        # along the bottom of the frame, then up the net's diagonal lower-left edge
        (850, 1536), (833, 1517), (750, 1467), (667, 1400), (583, 1333), (500, 1258), (392, 1175), (365, 1110), (240, 1075),
        # the rope cluster's underside, then the hammock's upper-left edge up to the head
        (0, 1075), (0, 520), (150, 590), (250, 640), (330, 692), (450, 727), (600, 760), (700, 800), (790, 840),
        # the man's head and headphones (left side, top, band), then his hands, the phone and the net
        (700, 830), (640, 780), (625, 690), (612, 560), (625, 430), (660, 380), (720, 340), (800, 310),
        (900, 285), (1000, 275), (1100, 290), (1150, 330), (1170, 420), (1210, 520), (1225, 640), (1215, 760),
        (1235, 640), (1280, 560), (1400, 520), (1470, 500), (1510, 420), (1750, 200)]
    # the hanging rope bundles below the cluster: sand shows between them
    bundle_1 = [(78, 1070), (185, 1070), (188, 1250), (195, 1400), (205, 1536), (88, 1536), (85, 1400), (88, 1250)]
    bundle_2 = [(232, 1060), (445, 1050), (440, 1200), (430, 1350), (425, 1536), (235, 1536), (238, 1300)]
    thin_rope = [(195, 1080), (240, 1080), (238, 1536), (200, 1536)]
    # the cream tassel hanging from the knot, with its frayed end near y~1230
    tassel = [(478, 930), (540, 925), (565, 1050), (555, 1160), (545, 1232), (500, 1238), (480, 1150), (470, 1030)]
    FEATHER = 8
    pieces = [main_body, bundle_1, thin_rope, bundle_2, tassel]
    body = px_polygon(pieces[0], FEATHER)
    for pts in pieces[1:]:
        body = ImageChops.lighter(body, px_polygon(pts, FEATHER))

    # hanging ropes: weight + a hang factor (attachment 0 -> tip 1) for the lagged swing
    hanging = Image.new('L', (W, H), 0)
    hang = Image.new('L', (W, H), 0)
    for pts, top, bottom in ((bundle_1, 1070, 1536), (thin_rope, 1080, 1536), (bundle_2, 1055, 1536), (tassel, 920, 1235)):
        part = px_polygon(pts, FEATHER)
        hanging = ImageChops.lighter(hanging, part)
        ramp_h = column_ramp((W, H), lambda y, top=top, bottom=bottom: (y - top) / float(bottom - top))
        hang = ImageChops.lighter(hang, ImageChops.multiply(part, ramp_h))

    half = (W // 2, H // 2)
    mask = Image.merge('RGBA', (
        palm.resize(half, Image.LANCZOS), sea.resize(half, Image.LANCZOS),
        shore.resize(half, Image.LANCZOS), Image.new('L', half, 255)))
    mask.save(OUT, optimize=True)
    print('wrote', OUT, mask.size)
    Image.merge('RGB', (body.resize(half, Image.LANCZOS), hanging.resize(half, Image.LANCZOS), hang.resize(half, Image.LANCZOS))).save(OUT_BODY, optimize=True)
    print('wrote', OUT_BODY, half)

    if '--preview' in sys.argv:
        path = sys.argv[sys.argv.index('--preview') + 1]
        tint = photo.copy()
        red = Image.new('RGB', (W, H), (255, 40, 40)); cyan = Image.new('RGB', (W, H), (0, 230, 255))
        tint = Image.composite(red, tint, palm.point(lambda v: min(255, int(v * 0.8))))
        tint = Image.composite(cyan, tint, sea.point(lambda v: int(v * 0.6)))
        yellow = Image.new('RGB', (W, H), (255, 230, 0))
        tint = Image.composite(yellow, tint, shore.point(lambda v: int(v * 0.65)))
        magenta = Image.new('RGB', (W, H), (255, 0, 200))
        tint = Image.composite(magenta, tint, body.point(lambda v: int(v * 0.45)))
        orange = Image.new('RGB', (W, H), (255, 140, 0))
        tint = Image.composite(orange, tint, hanging.point(lambda v: int(v * 0.5)))
        tint.resize((W // 2, H // 2), Image.LANCZOS).save(path)
        print('preview', path)


if __name__ == '__main__':
    main()
