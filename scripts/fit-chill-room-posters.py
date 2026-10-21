#!/usr/bin/env python3
"""Fits the study room's poster quads to the real edges in the photo (and measures each print's
blur), so the song's artwork lands exactly on its print. Needs only Pillow. From the repo root:
  python3 scripts/fit-chill-room-posters.py [--overlay DIR] [--adopt id,id,...] [--self-test]

Why: hand-placed corners were off by 2-7px (up to 12) from the printed edges — the art
overshot on one side and the print showed on the other. The edges are straight (a line fit
leaves 0.1-0.3px of scatter), so one perspective transform per print is right; it only needs
accurate corners.

How (per print, starting from `seed`, the hand-placed quad in src/chillRoomPosters.json):
  1. each side is sampled at 26 points; across each, the luminance profile is searched along
     the side's outward normal for the NEAREST edge that is at least 40% as strong as the
     strongest (not simply the strongest: a print with a white mat has two edges, and the outer
     one is stronger — the cream frame's fit first locked onto the mat's outer edge) — search
     +-5px, then +-3.5, then +-3. The seeds must be within a few px for this to work; a seed
     further off than that fails rather than being 'rescued' by a wrong edge (the trio's top
     edge once slid onto an unrelated shading band 15px away);
  2. edges whose direction (dark->light or light->dark) disagrees with the majority are
     dropped, then a robust line is fitted (offset as a function of position, trimming the
     worst quarter twice);
  3. adjacent lines are intersected for the new corners; sides lying on the frame of the photo
     are the frame line;
  4. the print's blur (a Gaussian sigma, from the edge's steepest slope) is measured too.
Workflow: run it, look at the overlays (red = seed, green = fitted and passing, amber = rejected),
and for prints whose fit is right to the eye but moved more than MAX_DRIFT from a coarse hand
seed, `--adopt id,...` makes the current (reviewed) quad the new seed and re-fits from there.
A side the detector cannot see (dark picture against a dark shadow, white print on a white
mat) can be pinned with `"hold": ["top"]` in the JSON: that side keeps the seed's line and
counts as hand-verified. `"trust": ["bottom"]` skips only the outer-edge check on a side whose
fit was confirmed by eye at 6x+ (a false positive from a neighbouring frame).
A print PASSES only if every side checks out (and has no STRONGER edge of the same direction 4-16px
outside it — a sign the seed sat on an interior edge such as lettering): scatter <= 0.7px, >= 60% of samples inliers,
a real edge (steepness >= 4 levels/px), and the mean gradient across the final line peaks within
0.5px of the line. Failing prints get `fit.ok = false` and are NOT drawn (the original print
stays on the wall); fix the seed by hand and re-run, or leave them out. Writes `quad` and `fit`.
"""
import json
import math
import sys
from PIL import Image, ImageDraw, ImageFilter

SRC = 'src/assets/chill/room.jpg'
POSTERS = 'src/chillRoomPosters.json'
W, H = 2752, 1536
SAMPLES = 26
PASSES = (5.0, 3.5, 3.0)
MAX_DRIFT = 9.0         # a corner may move at most this far from the hand-placed seed, or the fit is not trusted
PRE_BLUR = 0.9          # the profile is read from a lightly blurred copy; removed from the sigma estimate

_img = Image.open(SRC).convert('L')
_blurred = _img.filter(ImageFilter.GaussianBlur(PRE_BLUR))
_px = _blurred.load()


def lum(x, y):
    x = min(max(x, 0.0), W - 1.001)
    y = min(max(y, 0.0), H - 1.001)
    x0, y0 = int(x), int(y)
    fx, fy = x - x0, y - y0
    return (_px[x0, y0] * (1 - fx) * (1 - fy) + _px[x0 + 1, y0] * fx * (1 - fy)
            + _px[x0, y0 + 1] * (1 - fx) * fy + _px[x0 + 1, y0 + 1] * fx * fy)


def on_frame(a, b):
    return ((a[1] <= 1 and b[1] <= 1, (0.0, 0.0, 1.0, 0.0)) if (a[1] <= 1 and b[1] <= 1) else
            (a[0] <= 1 and b[0] <= 1, (0.0, 0.0, 0.0, 1.0)) if (a[0] <= 1 and b[0] <= 1) else
            (a[0] >= W - 2 and b[0] >= W - 2, (W - 1.0, 0.0, 0.0, 1.0)) if (a[0] >= W - 2 and b[0] >= W - 2) else (False, None))


def normal_out(a, b, centre):
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy)
    nx, ny = -dy / n, dx / n
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    if (nx * (mx - centre[0]) + ny * (my - centre[1])) < 0:
        nx, ny = -nx, -ny
    return nx, ny


def profile_edge(cx, cy, nx, ny, search):
    """The nearest strong edge along the normal: (offset, signed gradient, sigma) or None."""
    step = 0.5
    ds = [k * step for k in range(int(-search / step) - 3, int(search / step) + 4)]
    v = [lum(cx + nx * d, cy + ny * d) for d in ds]
    g = [(v[i + 3] - v[i - 3]) / (6 * step) if 3 <= i < len(v) - 3 else 0.0 for i in range(len(v))]
    window = [i for i, d in enumerate(ds) if abs(d) <= search and 3 <= i < len(v) - 3]
    gmax = max(abs(g[i]) for i in window)
    if gmax < 3.0:
        return None
    # local maxima of |g| at least 40% of the strongest, nearest to the seed first
    cands = [i for i in window if abs(g[i]) >= 0.40 * gmax and abs(g[i]) >= abs(g[i - 1]) and abs(g[i]) >= abs(g[i + 1])]
    if not cands:
        return None
    i = min(cands, key=lambda j: abs(ds[j]))
    # parabola refinement
    a, b, c = abs(g[i - 1]), abs(g[i]), abs(g[i + 1])
    den = a - 2 * b + c
    off = 0.5 * (a - c) / den if abs(den) > 1e-9 else 0.0
    d = ds[i] + max(-0.5, min(0.5, off)) * step
    # sigma from the steepest slope: a blurred step of height D has slope D/(sigma*sqrt(2pi))
    lo = sorted(v[max(0, i - 14):max(1, i - 6)])[len(v[max(0, i - 14):max(1, i - 6)]) // 2]
    hi = sorted(v[min(len(v) - 1, i + 6):min(len(v), i + 14)])[len(v[min(len(v) - 1, i + 6):min(len(v), i + 14)]) // 2]
    sig2 = (abs(hi - lo) / (abs(g[i]) * 2.5066)) ** 2 - PRE_BLUR ** 2 if abs(g[i]) > 0 else 0
    return d, g[i], math.sqrt(max(sig2, 0.0)), abs(g[i])


def fit_offsets(ts, os_):
    """Robust a + b*t over (t, offset): least squares, trimming the worst quarter twice."""
    idx = list(range(len(ts)))
    for _ in range(3):
        n = len(idx)
        mt = sum(ts[i] for i in idx) / n
        mo = sum(os_[i] for i in idx) / n
        stt = sum((ts[i] - mt) ** 2 for i in idx) or 1e-9
        b = sum((ts[i] - mt) * (os_[i] - mo) for i in idx) / stt
        a = mo - b * mt
        res = {i: abs(os_[i] - (a + b * ts[i])) for i in range(len(ts))}
        keep = sorted(range(len(ts)), key=lambda i: res[i])[:max(6, int(len(ts) * 0.75))]
        idx = keep
    res_all = [os_[i] - (a + b * ts[i]) for i in range(len(ts))]
    inl = [abs(r) <= 1.2 for r in res_all]
    rms = math.sqrt(sum(res_all[i] ** 2 for i in idx) / len(idx))
    return a, b, rms, sum(inl) / len(inl)


def fit_side(a, b, centre, search):
    nx, ny = normal_out(a, b, centre)
    ts, os_, gs, sigs, strengths = [], [], [], [], []
    for k in range(SAMPLES):
        t = 0.10 + 0.80 * k / (SAMPLES - 1)
        cx, cy = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        e = profile_edge(cx, cy, nx, ny, search)
        if e is None:
            continue
        ts.append(t); os_.append(e[0]); gs.append(e[1]); sigs.append(e[2]); strengths.append(e[3])
    if len(ts) < 10:
        return None
    # the edge direction must agree: drop the minority sign
    pos = sum(1 for g in gs if g > 0)
    maj = 1 if pos >= len(gs) / 2 else -1
    keep = [i for i in range(len(ts)) if (gs[i] > 0) == (maj > 0)]
    if len(keep) < 10:
        return None
    ts = [ts[i] for i in keep]; os_ = [os_[i] for i in keep]
    sigs = [sigs[i] for i in keep]; strengths = [strengths[i] for i in keep]
    off_a, slope, rms, inlier = fit_offsets(ts, os_)
    a2 = (a[0] + nx * off_a, a[1] + ny * off_a)
    b2 = (b[0] + nx * (off_a + slope), b[1] + ny * (off_a + slope))
    med = lambda xs: sorted(xs)[len(xs) // 2]
    return {'a': a2, 'b': b2, 'rms': rms, 'inlier': inlier, 'sigma': med(sigs), 'strength': med(strengths), 'n': len(ts)}


def line_through(p, q):
    return (p[0], p[1], q[0] - p[0], q[1] - p[1])


def intersect(l1, l2):
    x1, y1, dx1, dy1 = l1
    x2, y2, dx2, dy2 = l2
    det = dx1 * (-dy2) - dy1 * (-dx2)
    if abs(det) < 1e-9:
        return None
    t = ((x2 - x1) * (-dy2) - (y2 - y1) * (-dx2)) / det
    return (x1 + dx1 * t, y1 + dy1 * t)


def side_peak_offset(a, b, centre):
    """Where the mean gradient across the final line peaks (px from the line): ~0 when aligned."""
    nx, ny = normal_out(a, b, centre)
    prof = {}
    for k in range(SAMPLES):
        t = 0.10 + 0.80 * k / (SAMPLES - 1)
        cx, cy = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        for j in range(-8, 9):
            d = j * 0.5
            g = abs(lum(cx + nx * (d + 0.75), cy + ny * (d + 0.75)) - lum(cx + nx * (d - 0.75), cy + ny * (d - 0.75)))
            prof[d] = prof.get(d, 0.0) + g / SAMPLES
    best = max(prof, key=lambda d: prof[d])
    return best, prof[best]


SIDE_NAMES = ('top', 'right', 'bottom', 'left')
HOLD = ()
TRUST = ()


def outer_edge_check(a, b, centre):
    """Is the fitted edge really the print's edge — or the edge of CONTENT inside it?

    The signature of the mistake: the fitted edge goes bright -> dark outward (the print's
    lettering, a light picture region), then a dark TROUGH, then a stronger dark -> bright edge
    4-16px further out (the frame's inner edge). The trough is the print's own dark border band, so
    the print really extends to the frame. The New York print's top edge was fitted to the top of
    its lettering this way (~10px too low) and passed every other test, because a hand-placed seed
    sat on that interior edge and the fit just refined it. A real print edge outward goes
    dark print -> bright mat/frame/wall (positive), so a NEGATIVE fitted edge followed by a
    stronger positive one over a trough is flagged. Returns the outward offset of the frame edge
    (px), or None."""
    nx, ny = normal_out(a, b, centre)
    own, far, inner, gap = {}, {}, [], []
    for k in range(SAMPLES):
        t = 0.10 + 0.80 * k / (SAMPLES - 1)
        cx, cy = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        for j in range(-4, 33):
            d = j * 0.5
            g = (lum(cx + nx * (d + 1.0), cy + ny * (d + 1.0)) - lum(cx + nx * (d - 1.0), cy + ny * (d - 1.0))) / 2.0
            tgt = own if d <= 3.0 else far
            tgt[d] = tgt.get(d, 0.0) + g / SAMPLES
        inner.append(lum(cx - nx * 3.0, cy - ny * 3.0))
    own_g = min(own.values(), key=lambda v: v)          # most negative gradient near the edge
    own_peak = max(abs(v) for v in own.values())
    if own_peak < 2.0 or abs(own_g) < 0.8 * own_peak:    # the fitted edge is not a bright->dark one
        return None
    best = max(far, key=lambda d: far[d])               # the strongest positive (dark -> bright) edge outward
    if far[best] < 0.8 * own_peak:
        return None
    # the trough between them is darker than the picture inside
    mid = []
    for k in range(SAMPLES):
        t = 0.10 + 0.80 * k / (SAMPLES - 1)
        cx, cy = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        mid.append(lum(cx + nx * (best / 2.0 + 1.5), cy + ny * (best / 2.0 + 1.5)))
    if sorted(mid)[len(mid) // 2] < 0.8 * sorted(inner)[len(inner) // 2]:
        return round(best, 1)
    return None


def fit_poster(p):
    global HOLD, TRUST
    HOLD = tuple(p.get('hold', ()))
    TRUST = tuple(p.get('trust', ()))
    seed = [tuple(c) for c in p['seed']]
    quad = list(seed)
    centre = (sum(c[0] for c in seed) / 4, sum(c[1] for c in seed) / 4)
    sides_info = [None] * 4
    for search in PASSES:
        lines = []
        infos = []
        for i in range(4):
            a, b = quad[i], quad[(i + 1) % 4]
            fr, fline = on_frame(a, b)
            if fr:
                lines.append(fline); infos.append({'frame': True}); continue
            if SIDE_NAMES[i] in HOLD:
                lines.append(line_through(seed[i], seed[(i + 1) % 4])); infos.append({'frame': True, 'held': True}); continue
            r = fit_side(a, b, centre, search)
            if r is None:
                lines.append(line_through(a, b)); infos.append(None); continue
            lines.append(line_through(r['a'], r['b'])); infos.append(r)
        new = []
        for i in range(4):
            c = intersect(lines[(i - 1) % 4], lines[i])
            new.append(c if c and math.hypot(c[0] - quad[i][0], c[1] - quad[i][1]) < 20 else quad[i])
        quad = new
        sides_info = infos
    # verify every side against the FINAL quad
    sides = []
    ok = True
    sigmas = []
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        info = sides_info[i]
        if info and info.get('frame'):
            sides.append({'frame': True}); continue
        peak, mean_g = side_peak_offset(a, b, centre)
        outer = None if SIDE_NAMES[i] in TRUST else outer_edge_check(a, b, centre)
        good = bool(info) and info['rms'] <= 0.7 and info['inlier'] >= 0.6 and info['strength'] >= 4.0 and abs(peak) <= 0.5 and outer is None
        ok = ok and good
        if info:
            sigmas.append(info['sigma'])
        sides.append({'rms': round(info['rms'], 2) if info else None, 'inlier': round(info['inlier'], 2) if info else 0,
                      'strength': round(info['strength'], 1) if info else 0, 'peak': peak, 'outer': outer, 'ok': good})
    sigma = sorted(sigmas)[len(sigmas) // 2] if sigmas else 1.5
    shift = [math.hypot(quad[i][0] - seed[i][0], quad[i][1] - seed[i][1]) for i in range(4)]
    ok = ok and max(shift) <= MAX_DRIFT
    return quad, {'ok': ok, 'blur': round(max(0.4, min(5.0, sigma)), 2), 'shift': round(max(shift), 1), 'sides': sides}


def write(data):
    with open(POSTERS, 'w') as f:
        f.write('{\n  "_doc": %s,\n  "posters": [\n' % json.dumps(data['_doc']))
        rows = []
        for p in data['posters']:
            q = {k: p[k] for k in ('id', 'look') if k in p}
            for k in ('zoom', 'at', 'glare'):
                if k in p:
                    q[k] = p[k]
            for k in ('hold', 'trust'):
                if k in p:
                    q[k] = p[k]
            q['seed'] = p['seed']
            q['quad'] = [[round(x, 2), round(y, 2)] for x, y in p['quad']]
            if 'fit' in p:
                q['fit'] = p['fit']
            if 'light' in p:
                q['light'] = p['light']
            rows.append('    ' + json.dumps(q, separators=(', ', ': ')))
        f.write(',\n'.join(rows))
        f.write('\n  ]\n}\n')


def self_test():
    """The New York print's top edge, as it was fitted to the top of its lettering (~10px too low), must
    be flagged by outer_edge_check; the corrected edge (the frame's inner edge) must not be."""
    bad = [(772.12, 66.93), (884.29, 44.58), (890.98, 248.42), (773.14, 263.3)]
    good = [(774.0, 54.5), (885.5, 33.5), (890.5, 248.5), (773.0, 263.3)]
    c = lambda q: (sum(p[0] for p in q) / 4, sum(p[1] for p in q) / 4)
    flagged = outer_edge_check(bad[0], bad[1], c(bad))
    clean = outer_edge_check(good[0], good[1], c(good))
    assert flagged is not None, 'the interior-edge fit was not flagged'
    assert clean is None, 'the corrected edge was wrongly flagged'
    print('self-test ok: the lettering-edge fit is flagged at %.1fpx out; the frame edge is clean' % flagged)


def main():
    if '--self-test' in sys.argv:
        self_test()
        return
    data = json.load(open(POSTERS))
    if '--adopt' in sys.argv:
        for pid in sys.argv[sys.argv.index('--adopt') + 1].split(','):
            for p in data['posters']:
                if p['id'] == pid:
                    p['seed'] = p['quad']
    for p in data['posters']:
        if 'seed' not in p:
            p['seed'] = p['quad']          # first run: the hand-placed quad becomes the seed
        quad, fit = fit_poster(p)
        p['quad'] = quad
        p['fit'] = fit
    write(data)
    n_ok = sum(1 for p in data['posters'] if p['fit']['ok'])
    print(f'{n_ok}/{len(data["posters"])} prints fitted within tolerance; wrote {POSTERS}')
    if '--report' in sys.argv or True:
        print(f"{'id':10s} ok  blur  seed->fit shift   sides: rms/strength/peak")
        for p in data['posters']:
            f = p['fit']
            side = '  '.join('frame' if s.get('frame') else f"{s['rms']}/{s['strength']}/{s['peak']:+.1f}{'' if s['ok'] else '!'}{('@out' + str(s['outer'])) if s.get('outer') else ''}" for s in f['sides'])
            print(f"{p['id']:10s} {'yes' if f['ok'] else 'NO ':3s} {f['blur']:4.1f}  {f['shift']:5.1f}px            {side}")
    if '--overlay' in sys.argv:
        import os
        out = sys.argv[sys.argv.index('--overlay') + 1]
        os.makedirs(out, exist_ok=True)
        photo = Image.open(SRC).convert('RGB')
        for p in data['posters']:
            xs = [x for x, _ in p['quad']]; ys = [y for _, y in p['quad']]
            pad, z = 14, 4
            x0, y0, x1, y1 = int(min(xs)) - pad, max(0, int(min(ys)) - pad), int(max(xs)) + pad, int(max(ys)) + pad
            zz = min(z, max(1, int(900 / max(1, (x1 - x0)))))
            c = photo.crop((x0, y0, x1, y1)).resize(((x1 - x0) * zz, (y1 - y0) * zz), Image.LANCZOS)
            d = ImageDraw.Draw(c)
            d.polygon([((x - x0) * zz, (y - y0) * zz) for x, y in p['seed']], outline=(255, 70, 70))
            d.polygon([((x - x0) * zz, (y - y0) * zz) for x, y in p['quad']], outline=(0, 255, 0) if p['fit']['ok'] else (255, 200, 0))
            c.save(f"{out}/{p['id']}.png")


if __name__ == '__main__':
    main()
