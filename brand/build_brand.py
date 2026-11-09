"""
DUM-E Labs brand builder.

Generates the brain-mesh mark, the full logo, the banner and the classic
hexagon logo as true vector SVGs (wordmark converted to outlines), then
renders every SVG to a high-resolution PNG with headless Chrome.

    python brand/build_brand.py            # build everything (4096 px)
    python brand/build_brand.py --size 1024  # quick preview

Requires: numpy, scipy, fonttools, playwright (with Chrome installed).
The Montserrat font (SIL OFL) is fetched once from Google Fonts and cached
in brand/.cache/.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import urllib.request
from pathlib import Path

import numpy as np
from scipy.spatial import Delaunay

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CACHE = HERE / ".cache"

BONE = "#ECE8E1"      # logo line colour (warm off-white, sampled from the original)
INK = "#000000"       # logo background

# --------------------------------------------------------------------------
# Brain mesh
# --------------------------------------------------------------------------

# Lateral view of a human brain, frontal lobe facing left (y grows downward).
BRAIN_OUTLINE = [
    (70, 430), (84, 322), (138, 214), (228, 138), (348, 86), (480, 64),
    (612, 74), (728, 110), (822, 172), (892, 258), (932, 356), (938, 448),
    (908, 520),
    (852, 556),                                   # occipital / cerebellum notch
    (888, 602), (874, 672), (808, 720), (716, 730), (650, 704),  # cerebellum
    (590, 670),                                   # pons notch
    (500, 652), (400, 640), (300, 616), (244, 576),  # temporal lobe
    (208, 524),                                   # sylvian / orbital notch
    (116, 502),
]


def point_in_poly(x: float, y: float, poly: np.ndarray) -> bool:
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            xc = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < xc:
                inside = not inside
        j = i
    return inside


def dist_to_poly(x: float, y: float, poly: np.ndarray) -> float:
    best = 1e9
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
        px, py = ax + t * dx, ay + t * dy
        best = min(best, math.hypot(x - px, y - py))
    return best


def densify(poly: list[tuple[float, float]], max_len: float) -> np.ndarray:
    out = []
    n = len(poly)
    for i in range(n):
        a = np.array(poly[i], float)
        b = np.array(poly[(i + 1) % n], float)
        out.append(a)
        seg = np.linalg.norm(b - a)
        k = int(seg // max_len)
        for s in range(1, k + 1):
            out.append(a + (b - a) * s / (k + 1))
    return np.array(out)


def build_brain_mesh(spacing: float = 112, seed: int = 23):
    rng = np.random.default_rng(seed)
    boundary = densify(BRAIN_OUTLINE, max_len=spacing * 1.15)
    poly = np.array(BRAIN_OUTLINE, float)

    xmin, ymin = poly.min(axis=0)
    xmax, ymax = poly.max(axis=0)

    # Poisson-disc style dart throwing for interior nodes
    interior: list[np.ndarray] = []
    for _ in range(40000):
        p = np.array([rng.uniform(xmin, xmax), rng.uniform(ymin, ymax)])
        if not point_in_poly(p[0], p[1], poly):
            continue
        if dist_to_poly(p[0], p[1], poly) < spacing * 0.62:
            continue
        if any(np.linalg.norm(p - q) < spacing for q in interior):
            continue
        interior.append(p)
    interior_arr = np.array(interior)

    # Lloyd relaxation (boundary fixed) for an even, calm triangulation
    gx, gy = np.meshgrid(np.arange(xmin, xmax, 6.0), np.arange(ymin, ymax, 6.0))
    grid = np.stack([gx.ravel(), gy.ravel()], axis=1)
    mask = np.array([point_in_poly(x, y, poly) for x, y in grid])
    grid = grid[mask]
    for _ in range(30):
        sites = np.vstack([boundary, interior_arr])
        d2 = ((grid[:, None, :] - sites[None, :, :]) ** 2).sum(-1)
        owner = d2.argmin(1)
        nb = len(boundary)
        for k in range(len(interior_arr)):
            pts = grid[owner == nb + k]
            if len(pts):
                c = pts.mean(0)
                if dist_to_poly(c[0], c[1], poly) > spacing * 0.42:
                    interior_arr[k] = c

    nodes = np.vstack([boundary, interior_arr])
    nb = len(boundary)
    tri = Delaunay(nodes)

    def is_boundary_edge(i: int, j: int) -> bool:
        return i < nb and j < nb and (abs(i - j) == 1 or abs(i - j) == nb - 1)

    keep = []
    for t in tri.simplices:
        c = nodes[t].mean(0)
        if not point_in_poly(c[0], c[1], poly):
            continue
        ok = True
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            if is_boundary_edge(a, b):
                continue
            m = (nodes[a] + nodes[b]) / 2
            if not point_in_poly(m[0], m[1], poly):
                ok = False
                break
        if ok:
            keep.append(t)

    edges = set()
    for t in keep:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            edges.add((min(a, b), max(a, b)))
    for i in range(nb):
        a, b = i, (i + 1) % nb
        edges.add((min(a, b), max(a, b)))

    return nodes, sorted(edges), nb


def fit_nodes(nodes: np.ndarray, box: tuple[float, float, float, float]) -> np.ndarray:
    """Scale/translate nodes to fit centered inside box=(x, y, w, h)."""
    x, y, w, h = box
    mn, mx = nodes.min(0), nodes.max(0)
    s = min(w / (mx[0] - mn[0]), h / (mx[1] - mn[1]))
    size = (mx - mn) * s
    off = np.array([x + (w - size[0]) / 2, y + (h - size[1]) / 2])
    return (nodes - mn) * s + off


def mesh_svg_group(nodes, edges, nb, stroke, color, dots=True, hubs=()):
    lines = []
    for a, b in edges:
        (x1, y1), (x2, y2) = nodes[a], nodes[b]
        lines.append(f"M{x1:.2f} {y1:.2f}L{x2:.2f} {y2:.2f}")
    outline = "M" + "L".join(f"{x:.2f} {y:.2f}" for x, y in nodes[:nb]) + "Z"
    g = [
        f'<g fill="none" stroke="{color}" stroke-width="{stroke:.2f}" '
        f'stroke-linecap="round" stroke-linejoin="round">',
        f'<path d="{"".join(lines)}"/>',
        f'<path d="{outline}" stroke-width="{stroke * 1.18:.2f}"/>',
        "</g>",
    ]
    if dots:
        g.append(f'<g fill="{color}">')
        for i, (x, y) in enumerate(nodes):
            r = stroke * (1.9 if i in hubs else 1.05)
            g.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r:.2f}"/>')
        g.append("</g>")
        for i in hubs:
            x, y = nodes[i]
            g.append(
                f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{stroke * 3.6:.2f}" fill="none" '
                f'stroke="{color}" stroke-width="{stroke * 0.55:.2f}" opacity="0.55"/>'
            )
    return "\n".join(g)


# --------------------------------------------------------------------------
# Classic hexagon (redrawn from the original logo as clean vectors)
# --------------------------------------------------------------------------

def hex_mesh(cx: float, cy: float, R: float):
    def pt(angle_deg, r):
        a = math.radians(angle_deg)
        return (cx + r * math.cos(a), cy - r * math.sin(a))

    T, UR, LR, B, LL, UL = (pt(a, R) for a in (90, 30, -30, -90, -150, 150))
    C = (cx, cy)
    N, Q2, Q4, S, Q3, Q1 = (pt(a, R * 0.49) for a in (90, 30, -30, -90, -150, 150))

    def lerp(p, q, t):
        return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)

    P1, P2 = lerp(T, LL, 0.30), lerp(T, LR, 0.30)
    P3, P4 = lerp(B, UL, 0.30), lerp(B, UR, 0.30)
    segs = [
        (T, UR), (UR, LR), (LR, B), (B, LL), (LL, UL), (UL, T),   # outer hexagon
        (T, B), (UL, LR), (UR, LL),                               # main diagonals
        (T, LL), (T, LR), (B, UL), (B, UR),                       # star triangles
        (UL, P1), (P1, N), (N, P2), (P2, UR),                     # top zig-zag
        (LL, P3), (P3, S), (S, P4), (P4, LR),                     # bottom zig-zag
        (N, Q2), (Q2, Q4), (Q4, S), (S, Q3), (Q3, Q1), (Q1, N),   # inner hexagon
    ]
    return segs


def hex_svg_group(cx, cy, R, stroke, color):
    d = "".join(f"M{a[0]:.2f} {a[1]:.2f}L{b[0]:.2f} {b[1]:.2f}" for a, b in hex_mesh(cx, cy, R))
    return (
        f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{stroke:.2f}" '
        f'stroke-linecap="round" stroke-linejoin="round"/>'
    )


# --------------------------------------------------------------------------
# Wordmark: Montserrat glyph outlines (with GPOS pair kerning)
# --------------------------------------------------------------------------

FONT_CSS = "https://fonts.googleapis.com/css2?family=Montserrat:wght@{w}"


def font_path(weight: int) -> Path:
    CACHE.mkdir(exist_ok=True)
    p = CACHE / f"Montserrat-{weight}.ttf"
    if not p.exists():
        css = urllib.request.urlopen(FONT_CSS.format(w=weight), timeout=30).read().decode()
        url = re.search(r"url\((https://[^)]+\.ttf)\)", css).group(1)
        p.write_bytes(urllib.request.urlopen(url, timeout=60).read())
    return p


class Wordmark:
    def __init__(self, weight: int):
        from fontTools.ttLib import TTFont

        self.font = TTFont(font_path(weight))
        self.glyphs = self.font.getGlyphSet()
        self.cmap = self.font.getBestCmap()
        self.upm = self.font["head"].unitsPerEm
        self.hmtx = self.font["hmtx"]
        self.kern = self._read_kerning()
        os2 = self.font["OS/2"]
        self.cap = getattr(os2, "sCapHeight", 0) or 700

    def _read_kerning(self):
        pairs: dict[tuple[str, str], int] = {}
        if "GPOS" not in self.font:
            return pairs
        gpos = self.font["GPOS"].table
        kern_lookups = set()
        for fr in gpos.FeatureList.FeatureRecord:
            if fr.FeatureTag == "kern":
                kern_lookups.update(fr.Feature.LookupListIndex)
        for li in kern_lookups:
            lookup = gpos.LookupList.Lookup[li]
            subtables = lookup.SubTable
            if lookup.LookupType == 9:
                subtables = [s.ExtSubTable for s in subtables]
            for st in subtables:
                if getattr(st, "LookupType", 2) != 2:
                    continue
                cov = st.Coverage.glyphs
                if st.Format == 1:
                    for i, first in enumerate(cov):
                        for pvr in st.PairSet[i].PairValueRecord:
                            v = getattr(pvr.Value1, "XAdvance", 0) or 0
                            if v:
                                pairs.setdefault((first, pvr.SecondGlyph), v)
                elif st.Format == 2:
                    cd1 = st.ClassDef1.classDefs
                    cd2 = st.ClassDef2.classDefs
                    for first in cov:
                        c1 = cd1.get(first, 0)
                        rec = st.Class1Record[c1]
                        for second, c2 in list(cd2.items()):
                            v = getattr(rec.Class2Record[c2].Value1, "XAdvance", 0) or 0
                            if v:
                                pairs.setdefault((first, second), v)
        return pairs

    def layout(self, text: str, tracking_em: float = 0.0):
        from fontTools.pens.svgPathPen import SVGPathPen
        from fontTools.pens.transformPen import TransformPen

        x = 0.0
        out = []
        names = [self.cmap[ord(ch)] for ch in text]
        for i, name in enumerate(names):
            pen = SVGPathPen(self.glyphs)
            # flip y (font units are y-up)
            tp = TransformPen(pen, (1, 0, 0, -1, x, 0))
            self.glyphs[name].draw(tp)
            out.append(pen.getCommands())
            adv = self.hmtx[name][0]
            if i + 1 < len(names):
                adv += self.kern.get((name, names[i + 1]), 0)
                adv += tracking_em * self.upm
            x += adv
        return " ".join(out), x

    def svg(self, text, x, baseline, cap_px, color, tracking_em=0.0, anchor="middle"):
        d, width = self.layout(text, tracking_em)
        s = cap_px / self.cap
        w_px = width * s
        if anchor == "middle":
            x0 = x - w_px / 2
        elif anchor == "end":
            x0 = x - w_px
        else:
            x0 = x
        return (
            f'<path transform="translate({x0:.2f} {baseline:.2f}) scale({s:.5f})" '
            f'fill="{color}" d="{d}"/>'
        ), w_px


# --------------------------------------------------------------------------
# Compositions
# --------------------------------------------------------------------------

WORD = "DUM-E LABS"
TAGLINE = "NEUROMORPHIC SILICON & BRAIN-NATIVE AI"


def svg_doc(w, h, body, bg=None):
    rect = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}">{rect}{body}</svg>\n'
    )


def build(size: int, out: Path, render: bool = True):
    out.mkdir(parents=True, exist_ok=True)
    nodes0, edges, nb = build_brain_mesh()
    regular = Wordmark(400)
    light = Wordmark(300)

    # pick a few "hub" neurons (interior nodes with the most connections)
    deg = np.zeros(len(nodes0), int)
    for a, b in edges:
        deg[a] += 1
        deg[b] += 1
    interior_idx = [i for i in range(nb, len(nodes0))]
    hubs = sorted(interior_idx, key=lambda i: -deg[i])[:0]

    files: dict[str, tuple[str, int, int, bool]] = {}

    # 1. Mark only (transparent + on black), square 1000
    nodes = fit_nodes(nodes0, (90, 90, 820, 820))
    mark = mesh_svg_group(nodes, edges, nb, stroke=11, color=BONE, hubs=hubs)
    files["dume-labs-mark"] = (svg_doc(1000, 1000, mark), 1000, 1000, True)
    files["dume-labs-mark-black"] = (svg_doc(1000, 1000, mark, INK), 1000, 1000, False)

    # 2. Full logo, square 1000 (mark above wordmark, like the original)
    nodes = fit_nodes(nodes0, (230, 190, 540, 470))
    body = mesh_svg_group(nodes, edges, nb, stroke=7.4, color=BONE, hubs=hubs)
    word, _ = regular.svg(WORD, 500, 790, 46, BONE, tracking_em=0.10)
    files["dume-labs-logo"] = (svg_doc(1000, 1000, body + word, INK), 1000, 1000, False)
    files["dume-labs-logo-transparent"] = (svg_doc(1000, 1000, body + word), 1000, 1000, True)

    # 3. Banner 1800 x 1000 (mark left, wordmark + rule + tagline right; group centred)
    W, H = 1800, 1000
    word_cap, word_track = 112, 0.06
    _, word_w = regular.svg(WORD, 0, 0, word_cap, BONE, tracking_em=word_track, anchor="start")
    # justify the tagline to the wordmark width (as in the original lockup)
    tag_cap, min_track = 30, 0.05
    _, w0 = light.svg(TAGLINE, 0, 0, tag_cap, BONE, tracking_em=0, anchor="start")
    gaps = len(TAGLINE) - 1
    per_em = light.upm * tag_cap / light.cap
    tag_track = (word_w - w0) / (gaps * per_em)
    if tag_track < min_track:
        tag_cap = tag_cap * word_w / (w0 + gaps * min_track * per_em)
        tag_track = min_track
    text_w = word_w
    mark_w, gap = 300, 80
    group_w = mark_w + gap + text_w
    gx = (W - group_w) / 2
    nodes = fit_nodes(nodes0, (gx, H / 2 - 150, mark_w, 300))
    body = mesh_svg_group(nodes, edges, nb, stroke=4.6, color=BONE, hubs=hubs)
    tx = gx + mark_w + gap
    word_svg, _ = regular.svg(WORD, tx, H / 2 - 28, word_cap, BONE, tracking_em=word_track, anchor="start")
    tag_svg, _ = light.svg(TAGLINE, tx, H / 2 + 92, tag_cap, BONE, tracking_em=tag_track, anchor="start")
    rule = (
        f'<rect x="{tx:.2f}" y="{H / 2 + 12:.2f}" width="{text_w:.2f}" height="3.5" '
        f'fill="{BONE}"/>'
    )
    files["dume-labs-banner"] = (svg_doc(W, H, body + word_svg + rule + tag_svg, INK), W, H, False)

    # 4. Classic hexagon logo, corrected wordmark
    hexg = hex_svg_group(500, 400, 232, 9.5, BONE)
    word, _ = regular.svg(WORD, 500, 790, 46, BONE, tracking_em=0.10)
    files["dume-labs-logo-hex"] = (svg_doc(1000, 1000, hexg + word, INK), 1000, 1000, False)

    # 5. Favicon (mark on black rounded square)
    # sparser mesh so it still reads at 16-32 px
    fnodes, fedges, fnb = build_brain_mesh(spacing=190, seed=5)
    nodes = fit_nodes(fnodes, (56, 66, 400, 380))
    fav = mesh_svg_group(nodes, fedges, fnb, stroke=17, color=BONE, dots=False)
    files["favicon"] = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        f'<rect width="512" height="512" rx="112" fill="{INK}"/>{fav}</svg>\n',
        512, 512, False,
    )

    for name, (svg, *_rest) in files.items():
        (out / f"{name}.svg").write_text(svg, encoding="utf-8")

    # Mesh data for the website's animated mark (normalised to a 100x100 box):
    # "full" is the logo mesh, "small" the sparse favicon mesh for tiny sizes.
    def web(n, e, b):
        nw = fit_nodes(n, (2, 2, 96, 96))
        return {
            "nodes": [[round(x, 2), round(y, 2)] for x, y in nw],
            "edges": [[int(p), int(q)] for p, q in e],
            "outline": b,
        }

    data = {"full": web(nodes0, edges, nb), "small": web(fnodes, fedges, fnb)}
    js = ROOT / "assets" / "js" / "mark-data.js"
    js.parent.mkdir(parents=True, exist_ok=True)
    js.write_text(
        "// Generated by brand/build_brand.py — brain-mesh mark geometry (100x100 box).\n"
        f"window.DUME_MARK = {json.dumps(data, separators=(',', ':'))};\n",
        encoding="utf-8",
    )

    if render:
        render_pngs(files, out, size)


def render_pngs(files, out: Path, size: int):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        for name, (svg, w, h, transparent) in files.items():
            scale = size / max(w, h)
            if name == "favicon":
                scale = 1024 / w
            page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=scale)
            page.set_content(
                "<html><body style='margin:0;background:transparent'>" + svg + "</body></html>"
            )
            page.screenshot(
                path=str(out / f"{name}.png"),
                omit_background=transparent,
                clip={"x": 0, "y": 0, "width": w, "height": h},
            )
            page.close()
            print(f"  {name}.png  {round(w * scale)}x{round(h * scale)}")
        browser.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=4096, help="long edge of PNGs in px")
    ap.add_argument("--out", type=Path, default=HERE)
    ap.add_argument("--no-render", action="store_true")
    args = ap.parse_args()
    build(args.size, args.out, render=not args.no_render)
