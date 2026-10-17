#!/usr/bin/env python3
"""Exile Island token (gold coin with carved E) — generates assets/*.svg"""
import math, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'fonts')
CINZEL = TTFont(os.path.join(FONTS, 'fontsource-cinzel', 'files', 'cinzel-latin-700-normal.woff'))
OUT = os.path.join(HERE, 'assets'); os.makedirs(OUT, exist_ok=True)

def glyph(font, ch, size):
    gs = font.getGlyphSet(); gn = font.getBestCmap()[ord(ch)]; upm = font['head'].unitsPerEm
    sc = size / upm; pen = SVGPathPen(gs)
    gs[gn].draw(TransformPen(pen, (sc, 0, 0, -sc, 0, 0)))
    return pen.getCommands(), font['hmtx'][gn][0] * sc

def arc_text(txt, cx, cy, r, center_deg, size, top=True, track=0.18):
    """Place glyphs along a circle. top=True reads clockwise along the top; False reads along the bottom."""
    gl = [glyph(CINZEL, c, size) if c != ' ' else ('', size * 0.35) for c in txt]
    widths = [w + track * size for _, w in gl]; total = sum(widths) - track * size
    ang_total = total / r  # radians
    out = []
    a = math.radians(center_deg) - (ang_total / 2 if top else -ang_total / 2)
    for (d, w), adv in zip(gl, widths):
        mid = a + (w / 2 / r if top else -w / 2 / r)
        if top:
            x, y = cx + r * math.cos(mid - math.pi/2), cy + r * math.sin(mid - math.pi/2)
            rot = math.degrees(mid)
            tr = f'translate({x:.2f},{y:.2f}) rotate({rot:.2f}) translate({-w/2:.2f},{size*0.36:.2f})'
        else:
            x, y = cx + r * math.cos(mid + math.pi/2), cy + r * math.sin(mid + math.pi/2)
            rot = math.degrees(mid)
            tr = f'translate({x:.2f},{y:.2f}) rotate({rot:.2f}) translate({-w/2:.2f},{size*0.36:.2f})'
        if d: out.append(f'<path transform="{tr}" d="{d}"/>')
        a += (adv / r) if top else -(adv / r)
    return ''.join(out)

# Carved E — chiselled slab E with notched arm ends (wood/stone carving feel)
E = ('M66,54 L134,54 L138,58 L134,62 L131,76 L124,72 L120,70 L92,70 L92,92 L114,92 L118,86 L124,98 L118,110 L114,104 L92,104 '
     'L92,128 L122,128 L126,124 L132,120 L136,134 L138,142 L134,146 L66,146 L62,142 L68,136 L68,64 L62,58 Z')

def coin(uid, size=200, state='hero', label=True):
    gold = {'hero': ('#fff1b8', '#f2c94c', '#c8922a', '#8a5a14', '#5a3a0c'),
            'wiped': ('#d9d4c7', '#a8a090', '#7d7566', '#57503f', '#3a352a')}[ 'wiped' if state == 'wiped' else 'hero']
    hi, g1, g2, g3, g4 = gold
    ticks = ''.join(f'<rect x="99" y="4.5" width="2" height="7" rx="1" transform="rotate({i*5} 100 100)"/>' for i in range(72))
    rings = ''.join(f'<circle cx="100" cy="100" r="{r}" fill="none" stroke="{g3}" stroke-width=".6" opacity=".18"/>' for r in range(10, 60, 4))
    dots = ''.join(f'<circle cx="{100+71*math.cos(math.radians(a)):.1f}" cy="{100+71*math.sin(math.radians(a)):.1f}" r="1.6"/>' for a in range(0, 360, 10))
    text = (arc_text('EXILE ISLAND', 100, 100, 79, 0, 12.5, True) + arc_text('TOKEN', 100, 100, 79, 0, 12.5, False)) if label else ''
    stars = ''.join(f'<path transform="translate({100+79*math.cos(math.radians(a)):.1f},{100+79*math.sin(math.radians(a)):.1f}) scale(.9)" d="M0,-5 L1.4,-1.4 L5,0 L1.4,1.4 L0,5 L-1.4,1.4 L-5,0 L-1.4,-1.4 Z"/>' for a in (180, 0))
    crack = ''
    if state == 'wiped':
        crack = (f'<path d="M58,30 L74,62 L66,84 L88,104 L80,128 L104,150 L98,176" fill="none" stroke="#1d1a14" stroke-width="4" stroke-linejoin="round"/>'
                 f'<path d="M60,30 L76,62 L68,84 L90,104 L82,128 L106,150 L100,176" fill="none" stroke="#efe8d6" stroke-width="1.2" opacity=".6" stroke-linejoin="round"/>'
                 f'<path d="M88,104 L112,96 L124,104" fill="none" stroke="#1d1a14" stroke-width="3" stroke-linejoin="round"/>')
    glow = ''
    if state == 'earned':
        rays = ''.join(f'<path d="M100,100 L{100+150*math.cos(math.radians(a-4)):.1f},{100+150*math.sin(math.radians(a-4)):.1f} L{100+150*math.cos(math.radians(a+4)):.1f},{100+150*math.sin(math.radians(a+4)):.1f} Z"/>' for a in range(0, 360, 20))
        glow = f'<g fill="url(#ray-{uid})">{rays}</g><circle cx="100" cy="100" r="122" fill="url(#halo-{uid})"/>'
    vb = '-50 -50 300 300' if state == 'earned' else '0 0 200 200'
    w = size * (1.5 if state == 'earned' else 1)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w:.0f}" height="{w:.0f}" role="img" aria-label="Exile Island token{' (wiped)' if state=='wiped' else ''}">
<defs>
<radialGradient id="rim-{uid}" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="{hi}"/><stop offset=".35" stop-color="{g1}"/><stop offset=".75" stop-color="{g2}"/><stop offset="1" stop-color="{g3}"/></radialGradient>
<linearGradient id="bevel-{uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{g3}"/><stop offset=".5" stop-color="{g2}"/><stop offset="1" stop-color="{hi}"/></linearGradient>
<radialGradient id="field-{uid}" cx="40%" cy="34%" r="75%"><stop offset="0" stop-color="{hi}"/><stop offset=".45" stop-color="{g1}"/><stop offset="1" stop-color="{g2}"/></radialGradient>
<linearGradient id="shine-{uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity=".0"/><stop offset=".5" stop-color="#fff" stop-opacity=".42"/><stop offset=".56" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<radialGradient id="halo-{uid}"><stop offset=".55" stop-color="#ffd66b" stop-opacity=".45"/><stop offset="1" stop-color="#ffd66b" stop-opacity="0"/></radialGradient>
<radialGradient id="ray-{uid}"><stop offset=".3" stop-color="#ffe08a" stop-opacity=".55"/><stop offset="1" stop-color="#ffe08a" stop-opacity="0"/></radialGradient>
<clipPath id="clip-{uid}"><circle cx="100" cy="100" r="96"/></clipPath>
</defs>
{glow}
<circle cx="100" cy="104" r="97" fill="#000" opacity=".35"/>
<circle cx="100" cy="100" r="97" fill="url(#rim-{uid})" stroke="{g4}" stroke-width="2"/>
<g fill="{g3}" opacity=".55">{ticks}</g>
<circle cx="100" cy="100" r="88" fill="url(#bevel-{uid})" stroke="{g4}" stroke-width="1.2"/>
<circle cx="100" cy="100" r="85" fill="url(#field-{uid})"/>
{rings}
<g fill="{g3}">{dots}</g>
<circle cx="100" cy="100" r="66" fill="none" stroke="{g3}" stroke-width="1.6"/>
<circle cx="100" cy="100" r="64.5" fill="none" stroke="{hi}" stroke-width=".8" opacity=".8"/>
<g fill="{g4}">{text}</g>
<g fill="{g3}">{stars}</g>
<g transform="translate(100,100) scale({0.98 if label else 1.18}) translate(-100,-100)">
  <path d="{E}" transform="translate(1.8,2.2)" fill="{hi}" opacity=".9"/>
  <path d="{E}" fill="{g4}"/>
  <path d="{E}" transform="translate(100,100) scale(.94) translate(-100,-100)" fill="{g3}"/>
  <path d="{E}" transform="translate(100.5,101) scale(.86) translate(-100,-100)" fill="{g2}" opacity=".55"/>
  <path d="M70,58 L130,58 M96,96 L114,96 M96,132 L122,132" stroke="{g4}" stroke-width="1.4" opacity=".55" fill="none"/>
</g>
{crack}
<g clip-path="url(#clip-{uid})"><rect x="-40" y="-40" width="280" height="280" fill="url(#shine-{uid})"/></g>
<path d="M38,54 A72,72 0 0 1 86,22" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="{'.55' if state!='wiped' else '.25'}"/>
{'<path transform="translate(160,154)" d="M0,-12 L2.6,-2.6 L12,0 L2.6,2.6 L0,12 L-2.6,2.6 L-12,0 L-2.6,-2.6 Z" fill="#fff" opacity=".9"/>' if state != 'wiped' else ''}
</svg>'''

def icon(uid):
    """Simplified mark for 16–32px use: thick rim + bold E, no text, no ticks."""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Exile token">
<defs><radialGradient id="i-{uid}" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#fff1b8"/><stop offset=".4" stop-color="#f2c94c"/><stop offset="1" stop-color="#b9821f"/></radialGradient></defs>
<circle cx="32" cy="32" r="30" fill="url(#i-{uid})" stroke="#5a3a0c" stroke-width="2.5"/>
<circle cx="32" cy="32" r="23.5" fill="none" stroke="#8a5a14" stroke-width="2"/>
<path transform="translate(32,32) scale(.36) translate(-100,-100)" d="{E}" fill="#5a3a0c"/>
<path d="M14,22 A20,20 0 0 1 26,12" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".6"/>
</svg>'''

def empty():
    return '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Empty token slot">
<circle cx="32" cy="32" r="29" fill="rgba(217,180,90,.06)" stroke="#d9b45a" stroke-opacity=".45" stroke-width="2" stroke-dasharray="5 4"/>
<path transform="translate(32,32) scale(.3) translate(-100,-100)" d="''' + E + '''" fill="#d9b45a" opacity=".22"/>
</svg>'''

if __name__ == '__main__':
    open(os.path.join(OUT, 'token-coin.svg'), 'w').write(coin('hero'))
    open(os.path.join(OUT, 'token-coin-earned.svg'), 'w').write(coin('earned', state='earned'))
    open(os.path.join(OUT, 'token-coin-wiped.svg'), 'w').write(coin('wiped', state='wiped'))
    open(os.path.join(OUT, 'token-icon.svg'), 'w').write(icon('icon'))
    open(os.path.join(OUT, 'token-empty.svg'), 'w').write(empty())
    print('ok')
