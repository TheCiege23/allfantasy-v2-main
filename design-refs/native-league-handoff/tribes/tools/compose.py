#!/usr/bin/env python3
"""Compose tribe crests: frame + sport ornament + mascot (body + kit layers) + name banner.
Usage: compose.py [tribe_id ...]   -> writes build/<sport>/<id>.svg and build/marks/<id>-<kit>.svg
"""
import json, re, sys, os, colorsys
from xml.etree import ElementTree as ET
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, '..', 'fonts', 'fontsource-archivo', 'files', 'archivo-latin-800-normal.woff')
KITS = ['football', 'basketball', 'baseball', 'hockey', 'soccer']
SPORTS = {'nfl': 'football', 'ncaaf': 'football', 'nba': 'basketball', 'ncaab': 'basketball',
          'mlb': 'baseball', 'nhl': 'hockey', 'soccer': 'soccer'}
COLLEGE = {'ncaaf', 'ncaab'}
INK = '#0b0d14'

# ---------- colour helpers ----------
def hx(c):
    c = c.lstrip('#'); return tuple(int(c[i:i+2], 16) / 255 for i in (0, 2, 4))
def tohex(t): return '#' + ''.join(f'{max(0,min(255,round(v*255))):02x}' for v in t)
def shade(c, l=0.0, s=0.0):
    h, li, sa = colorsys.rgb_to_hls(*hx(c))
    return tohex(colorsys.hls_to_rgb(h, max(0, min(1, li + l)), max(0, min(1, sa + s))))

def palette(t):
    p, s = t['primary'], t['secondary']
    P = {
        'p': p, 'pd': shade(p, -0.16), 'pl': shade(p, 0.14),
        's': s, 'sd': shade(s, -0.16), 'sl': shade(s, 0.14),
        'l': '#f3ecdc', 'ld': '#cdbf9f',
        'k': INK, 'e': '#ffd84a', 'r': '#d23a3a', 'rd': '#4a1620',
        'br': '#8a4a22', 'brd': '#5e2f14', 'or': '#e2742b', 'ord': '#b5541a',
        'mt': '#c3cad6', 'mtd': '#7d8699', 'wd': '#dcb27a', 'wdd': '#a87c48',
    }
    base = p if colorsys.rgb_to_hls(*hx(p))[1] > 0.3 else s
    P['field'] = shade(base, -0.40, -0.15); P['field2'] = shade(base, -0.35, -0.15)
    return P

# ---------- text to path ----------
_font = None
def text_path(txt, cx, baseline, size, max_w, tracking=0.04):
    global _font
    if _font is None: _font = TTFont(FONT)
    gs = _font.getGlyphSet(); cmap = _font.getBestCmap(); upm = _font['head'].unitsPerEm
    hmtx = _font['hmtx']
    def build(sz):
        sc = sz / upm; x = 0; parts = []
        for ch in txt:
            gn = cmap.get(ord(ch));
            if gn is None: continue
            pen = SVGPathPen(gs)
            tp = TransformPen(pen, (sc, 0, 0, -sc, x, 0))
            gs[gn].draw(tp); parts.append(pen.getCommands())
            x += hmtx[gn][0] * sc + tracking * sz
        return parts, x - tracking * sz
    parts, w = build(size)
    if w > max_w:
        size = size * max_w / w; parts, w = build(size)
    return f'<path transform="translate({cx - w/2:.2f},{baseline:.2f})" d="{" ".join(parts)}"/>', size

# ---------- frames (viewBox 0 0 300 330) ----------
FRAMES = {
    'shield': 'M40,36 H260 V150 C260,232 200,282 150,308 C100,282 40,232 40,150 Z',
    'roundel': 'M150,38 A124,124 0 1 1 149.9,38 Z',
    'hex': 'M150,32 L264,98 L264,228 L150,294 L36,228 L36,98 Z',
    'pennant': 'M40,30 L112,30 L150,52 L188,30 L260,30 V160 C260,236 204,284 150,308 C96,284 40,236 40,160 Z',
}
CENTER = {'shield': (150, 165), 'roundel': (150, 162), 'hex': (150, 163), 'pennant': (150, 168)}

def scaled(d, f, c):
    cx, cy = c
    if 'A' in d:  # roundel: rebuild the circle at the scaled radius
        r = 124 * f; top = cy - r
        return f'M{cx},{top:.1f} A{r:.1f},{r:.1f} 0 1 1 {cx-0.1},{top:.1f} Z'
    def rep(m):
        x, y = float(m.group(1)), float(m.group(2))
        return f'{cx + (x - cx) * f:.1f},{cy + (y - cy) * f:.1f}'
    d2 = re.sub(r'(-?\d+\.?\d*),(-?\d+\.?\d*)', rep, d)
    # arc radii for roundel
    d2 = re.sub(r'A(\d+),(\d+)', lambda m: f'A{float(m.group(1))*f:.1f},{float(m.group(2))*f:.1f}', d2)
    return d2

# ---------- sport ornaments (behind frame) ----------
def football(cx, cy, rot, P, L=80, H=44):
    return f'''<g transform="translate({cx},{cy}) rotate({rot})">
<path d="M{-L/2},0 C{-L/4},{-H/1.6} {L/4},{-H/1.6} {L/2},0 C{L/4},{H/1.6} {-L/4},{H/1.6} {-L/2},0 Z" fill="{P['br']}" stroke="{INK}" stroke-width="5"/>
<path d="M{-L/2+10},-4 C{-L/4},{-H/2.3} {L/4},{-H/2.3} {L/2-10},-4" fill="none" stroke="{P['brd']}" stroke-width="3" opacity=".7"/>
<path d="M{-L*0.36},{-H*0.18} C{-L*0.3},{-H*0.05} {-L*0.3},{H*0.05} {-L*0.36},{H*0.18} M{L*0.36},{-H*0.18} C{L*0.3},{-H*0.05} {L*0.3},{H*0.05} {L*0.36},{H*0.18}" fill="none" stroke="{P['l']}" stroke-width="3.5"/>
<path d="M{-L*0.18},-2 H{L*0.18}" stroke="{P['l']}" stroke-width="4" stroke-linecap="round"/>
{''.join(f'<path d="M{x},-8 V4" stroke="{P["l"]}" stroke-width="3.5" stroke-linecap="round"/>' for x in (-12,-4,4,12))}
</g>'''

def ornament(kit, P):
    if kit == 'football':
        return football(40, 70, -40, P, 104, 56) + football(260, 70, 40, P, 104, 56)
    if kit == 'basketball':
        return f'''<g transform="translate(150,40)"><circle r="52" fill="{P['or']}" stroke="{INK}" stroke-width="6"/>
<path d="M-58,0 H58 M0,-58 V58 M-41,-41 C-14,-18 -14,18 -41,41 M41,-41 C14,-18 14,18 41,41" fill="none" stroke="{INK}" stroke-width="4"/>
<path d="M-40,-30 A50,50 0 0 1 -6,-50" fill="none" stroke="#f6a76a" stroke-width="5" stroke-linecap="round" opacity=".8"/></g>'''
    if kit == 'baseball':
        bat = lambda r: f'''<g transform="translate(150,170) rotate({r})"><path d="M-6,150 L-7,30 C-9,-20 -16,-80 -14,-150 C-13,-162 13,-162 14,-150 C16,-80 9,-20 7,30 L6,150 Z" fill="{P['wd']}" stroke="{INK}" stroke-width="5"/>
<path d="M-11,150 H11 V160 H-11 Z" fill="{P['wdd']}" stroke="{INK}" stroke-width="4"/><path d="M-6,105 H6 M-6,115 H6 M-6,125 H6" stroke="{INK}" stroke-width="2.5"/>
<path d="M-6,-140 C-7,-100 -4,-60 -3,-20" stroke="#f4dcae" stroke-width="3" fill="none" stroke-linecap="round"/></g>'''
        ball = f'''<g transform="translate(150,26)"><circle r="24" fill="{P['l']}" stroke="{INK}" stroke-width="5"/>
<path d="M-15,-20 C-6,-8 -6,8 -15,20 M15,-20 C6,-8 6,8 15,20" fill="none" stroke="{P['r']}" stroke-width="3" stroke-dasharray="4 3"/></g>'''
        return bat(-40) + bat(40) + ball
    if kit == 'hockey':
        stick = lambda r, flip: f'''<g transform="translate(150,150) rotate({r}) scale({flip},1)"><path d="M-6,-215 L6,-215 L6,110 C6,128 18,136 46,136 L50,152 C14,154 -6,146 -6,120 Z" fill="{P['wd']}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M-6,-215 H6 V-175 H-6 Z" fill="{INK}"/><path d="M-7,-221 H7 V-213 H-7 Z" fill="{INK}"/><path d="M8,128 C20,138 34,140 48,141" stroke="{P['l']}" stroke-width="5" fill="none"/></g>'''
        puck = f'''<g transform="translate(150,20)"><ellipse cx="0" cy="6" rx="30" ry="11" fill="{INK}"/><ellipse rx="30" ry="11" fill="#22252e" stroke="{INK}" stroke-width="4"/><ellipse rx="25" ry="7" fill="none" stroke="{P['mtd']}" stroke-width="2"/></g>'''
        return stick(-38, 1) + stick(38, -1) + puck
    if kit == 'soccer':
        pent = lambda x, y, r, s: f'<polygon transform="translate({x},{y}) rotate({r}) scale({s})" points="0,-10 9.5,-3.1 5.9,8.1 -5.9,8.1 -9.5,-3.1" fill="{INK}"/>'
        return f'''<g transform="translate(150,40)"><circle r="50" fill="{P['l']}" stroke="{INK}" stroke-width="6"/>
{pent(0,0,0,1.6)}{pent(0,-44,180,1.1)}{pent(42,-14,180,1.1)}{pent(26,36,180,1.1)}{pent(-26,36,180,1.1)}{pent(-42,-14,180,1.1)}
<path d="M0,-16 L0,-33 M15,-5 L32,-10 M9,13 L20,27 M-9,13 L-20,27 M-15,-5 L-32,-10" stroke="{INK}" stroke-width="3"/></g>
<g fill="{P['s']}" stroke="{INK}" stroke-width="3">{star(30,30,14)}{star(270,30,14)}</g>'''
    return ''

def star(cx, cy, r):
    import math
    pts = []
    for i in range(10):
        a = -math.pi/2 + i*math.pi/5; rr = r if i % 2 == 0 else r*0.45
        pts.append(f'{cx + rr*math.cos(a):.1f},{cy + rr*math.sin(a):.1f}')
    return f'<polygon points="{" ".join(pts)}"/>'

# ---------- mascot loading ----------
def load_mascot(mid):
    path = os.path.join(HERE, 'mascots', f'{mid}.svg')
    src = open(path).read()
    layers = {}
    for m in re.finditer(r'<g\s+id="([a-z\-]+)"[^>]*>(.*?)</g>\s*<!--\s*/\1\s*-->', src, re.S):
        layers[m.group(1)] = m.group(2)
    return layers

def resolve(svg, P):
    def rep(m):
        cls = m.group(1)
        if cls not in P: raise ValueError(f'unknown colour class {cls}')
        return f'fill="{P[cls]}"'
    svg = re.sub(r'stroke-class="([a-z]+)"', lambda m: f'stroke="{P[m.group(1)]}"', svg)
    svg = re.sub(r'(?<![-\w])class="([a-z]+)"', rep, svg)
    return svg

# ---------- crest ----------
def crest(t, sport):
    kit = SPORTS[sport]; P = palette(t); uid = f"{t['id']}-{sport}"
    fr = t['frame']; d = FRAMES[fr]; c = CENTER[fr]
    L = load_mascot(t['id'])
    mascot = L.get(f'back-{kit}', '') + L['body'] + L.get(f'front-{kit}', '')
    mascot = resolve(mascot, P)
    name, size = text_path(t['name'].upper(), 150, 283, 30, 168)
    inner = scaled(d, 0.88, c); inner2 = scaled(d, 0.82, c)
    college = sport in COLLEGE
    stripes = ''.join(f'<path d="M{x},0 L{x-330},330" stroke="{P["field2"]}" stroke-width="9"/>' for x in range(0, 700, 26))
    banner_fill = P['s']; banner_ink = INK if sum(hx(P['s'])) > 1.6 else P['l']
    tail = lambda sx: f'''<path transform="translate(150,0) scale({sx},1) translate(-150,0)" d="M58,262 L14,268 L30,284 L12,300 L66,296 Z" fill="{P['sd']}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path transform="translate(150,0) scale({sx},1) translate(-150,0)" d="M58,262 L66,296 L76,288 Z" fill="{INK}" opacity=".55"/>'''
    varsity = (f'<path d="M48,{'260'} Q150,250 252,260" fill="none" stroke="{P["p"]}" stroke-width="3"/>'
               f'<path d="M48,{'299'} Q150,289 252,299" fill="none" stroke="{P["p"]}" stroke-width="3"/>') if college else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -26 300 356" width="300" height="356">
<title>{t['name']} — {t['mascot']} ({sport.upper()})</title>
<defs><clipPath id="c-{uid}"><path d="{inner}"/></clipPath>
<radialGradient id="v-{uid}" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="{P['pl']}" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient></defs>
<g>{ornament(kit, P)}</g>
<path d="{d}" fill="{P['s']}" stroke="{INK}" stroke-width="12" stroke-linejoin="round"/>
<path d="{d}" fill="none" stroke="{P['sl']}" stroke-width="2" opacity=".6"/>
<path d="{inner}" fill="{P['field']}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<g clip-path="url(#c-{uid})">{stripes}<rect y="-26" width="300" height="356" fill="url(#v-{uid})"/></g>
<path d="{inner2}" fill="none" stroke="{P['p']}" stroke-width="2.5" opacity=".55" stroke-dasharray="{'7 5' if college else 'none'}"/>
<g transform="translate({c[0]-104},{c[1]-122}) scale({208/240:.4f})">{mascot}</g>
{tail(1)}{tail(-1)}
<path d="M44,256 Q150,244 256,256 L256,300 Q150,288 44,300 Z" fill="{banner_fill}" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
<path d="M50,262 Q150,251 250,262" fill="none" stroke="#fff" stroke-width="2" opacity=".35"/>
{varsity}
<g fill="{banner_ink}">{name}</g>
</svg>'''

def mark(t, kit):
    """Small circular mark (avatar / board header): mascot + kit on field, no banner."""
    P = palette(t); uid = f"{t['id']}-m-{kit}"
    L = load_mascot(t['id'])
    mascot = resolve(L.get(f'back-{kit}', '') + L['body'] + L.get(f'front-{kit}', ''), P)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
<title>{t['name']} mark</title>
<defs><clipPath id="c-{uid}"><circle cx="120" cy="120" r="108"/></clipPath></defs>
<circle cx="120" cy="120" r="114" fill="{P['s']}" stroke="{INK}" stroke-width="8"/>
<circle cx="120" cy="120" r="102" fill="{P['field']}" stroke="{INK}" stroke-width="4"/>
<g clip-path="url(#c-{uid})"><g transform="translate(14,10) scale(.88)">{mascot}</g></g>
</svg>'''

if __name__ == '__main__':
    tribes = json.load(open(os.path.join(HERE, 'tribes.json')))
    want = set(sys.argv[1:])
    for t in tribes:
        if want and t['id'] not in want: continue
        if not os.path.exists(os.path.join(HERE, 'mascots', f"{t['id']}.svg")):
            continue
        for sp in SPORTS:
            os.makedirs(os.path.join(HERE, 'build', sp), exist_ok=True)
            open(os.path.join(HERE, 'build', sp, f"{t['id']}.svg"), 'w').write(crest(t, sp))
        os.makedirs(os.path.join(HERE, 'build', 'marks'), exist_ok=True)
        for k in KITS:
            open(os.path.join(HERE, 'build', 'marks', f"{t['id']}-{k}.svg"), 'w').write(mark(t, k))
        print('built', t['id'])
