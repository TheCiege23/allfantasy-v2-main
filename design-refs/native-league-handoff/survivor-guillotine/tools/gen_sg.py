"""Survivor Guillotine art pack: bamboo guillotine, the drop, torches (lit / snuffed), idols for this mode, tribe buffs,
immunity necklace, merge, winner, and 4 backgrounds. python3 gen_sg.py <out> -> <out>/survguil/...
All text outlined (no font dependency). Original art; no show logos.
"""
import os, sys, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_a import svg, lg, rg
from outline import text as T_

INK = '#0a0d18'
ORANGE, VELA, KOA, GOLD, RED, MINT = '#e2672a', '#8b7be0', '#3fa7b5', '#f2c94c', '#e0402e', '#7fe0c0'


def shadow(cx, cy, rx, op=.35):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{rx * .16}" fill="#000" opacity="{op}"/>'


def bamboo(u):
    return lg(f'{u}bb', [(0, '#e8d27a'), (.5, '#c9a94a'), (1, '#8a6a22')], 1, 0)


def pole(u, x, y0, y1, w=22):
    out = f'<rect x="{x - w / 2}" y="{y0}" width="{w}" height="{y1 - y0}" rx="5" fill="url(#{u}bb)" stroke="{INK}" stroke-width="4"/>'
    for y in range(int(y0) + 34, int(y1) - 10, 40):
        out += f'<path d="M{x - w / 2},{y} h{w}" stroke="{INK}" stroke-width="3"/>'
    return out


def flame(x, y, s=1, op=1):
    return (f'<g transform="translate({x},{y}) scale({s})" opacity="{op}"><path d="M0,-46 C16,-26 20,-12 14,2 C10,12 -10,12 -14,2 C-20,-12 -12,-24 0,-46 Z" fill="#ff8a2a" stroke="{INK}" stroke-width="3"/>'
            f'<path d="M0,-28 C8,-16 9,-6 5,2 C2,6 -2,6 -5,2 C-9,-6 -6,-16 0,-28 Z" fill="#ffd24a"/></g>')


def torch(x, y, lit=True, s=1):
    out = (f'<g transform="translate({x},{y}) scale({s})"><path d="M-7,0 L-4,120 L4,120 L7,0 Z" fill="#7a4a1e" stroke="{INK}" stroke-width="3"/>'
           f'<path d="M-16,-22 L16,-22 L11,4 L-11,4 Z" fill="#a8742e" stroke="{INK}" stroke-width="3.5"/>'
           f'<path d="M-16,-12 H16 M-14,-2 H14" stroke="{INK}" stroke-width="2"/>')
    if lit:
        out += flame(0, -20, 1)
    else:
        out += ''.join(f'<path d="M{dx},-28 c-10,-14 10,-22 0,-38 c-8,-12 8,-18 2,-30" stroke="#a8b0c0" stroke-width="4" fill="none" opacity=".5" stroke-linecap="round"/>' for dx in (-4, 6))
        out += '<ellipse cx="0" cy="-22" rx="14" ry="4" fill="#2a1a10"/>'
    return out + '</g>'


def blade(u, x, y, w=96):
    return (f'<g transform="translate({x},{y})"><rect x="{-w / 2 - 4}" y="-12" width="{w + 8}" height="16" rx="4" fill="#5a3a16" stroke="{INK}" stroke-width="3.5"/>'
            f'<path d="M{-w / 2},4 H{w / 2} V40 L{-w / 2},72 Z" fill="url(#{u}st)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
            f'<path d="M{-w / 2 + 6},66 L{w / 2 - 4},38" stroke="#fff" stroke-width="3" opacity=".8"/></g>')


def steel(u):
    return lg(f'{u}st', [(0, '#f2f5fa'), (.6, '#b8c2d0'), (1, '#7a8698')], 1, 1)


def guillotine(dropped=False):
    u = 'gd' if dropped else 'gu'
    d = bamboo(u) + steel(u) + rg(f'{u}gl', [(0, '#ffb86a66'), (1, '#ffb86a00')]) + lg(f'{u}sd', [(0, '#e8c48a'), (1, '#b88a4a')])
    by = 196 if dropped else 70
    b = (f'<ellipse cx="120" cy="150" rx="130" ry="150" fill="url(#{u}gl)"/>'
         + f'<path d="M0,262 C60,250 180,250 240,262 L240,300 L0,300 Z" fill="url(#{u}sd)"/>' + shadow(120, 266, 96)
         + torch(28, 150, True, .8) + torch(212, 150, True, .8)
         + pole(u, 66, 40, 268) + pole(u, 174, 40, 268)
         + f'<rect x="48" y="26" width="144" height="24" rx="6" fill="url(#{u}bb)" stroke="{INK}" stroke-width="4"/>'
         f'<path d="M58,22 C46,8 52,0 64,6 M182,22 C194,8 188,0 176,6" stroke="{INK}" stroke-width="5" fill="none" stroke-linecap="round"/>'
         + ('' if dropped else '<path d="M120,50 V60" stroke="#e8d27a" stroke-width="3" stroke-dasharray="3 3"/>')
         + f'<rect x="76" y="226" width="88" height="20" rx="6" fill="#7a4a1e" stroke="{INK}" stroke-width="4"/><path d="M106,226 a14,14 0 0 1 28,0" fill="#3a2410" stroke="{INK}" stroke-width="3"/>'
         + blade(u, 120, by))
    if dropped:
        b += ''.join(f'<path d="M{120 + dx},{256} l{dx * .4},-14" stroke="{GOLD}" stroke-width="3" stroke-linecap="round"/>' for dx in (-46, -30, 30, 46))
        b += (f'<g transform="rotate(-10 120 140)"><rect x="34" y="114" width="172" height="52" rx="8" fill="#1a0a04" fill-opacity=".9" stroke="{RED}" stroke-width="5"/>'
              + T_('CHOPPED', 120, 154, 'bebas', 42, '#ff6a5a', 'middle', 4) + '</g>')
    return svg(240, 300, b, 'Guillotine' + (' dropped' if dropped else ''), d)


def torch_art(lit):
    u = 'tl' if lit else 'to'
    d = rg(f'{u}gl', [(0, '#ffb86a99' if lit else '#a8b0c022'), (1, '#ffb86a00')])
    b = (f'<circle cx="120" cy="110" r="{110 if lit else 80}" fill="url(#{u}gl)"/>' + shadow(120, 280, 50)
         + torch(120, 140, lit, 1.6))
    if not lit:
        b += T_('SNUFFED', 120, 296, 'bebas', 26, '#a8b0c0', 'middle', 4)
    return svg(240, 300, b, 'Torch ' + ('lit' if lit else 'snuffed'), d)


def tiki(u, x, y, s=1, eyes='#ffd24a'):
    return (f'<g transform="translate({x},{y}) scale({s})"><path d="M-40,-90 L40,-90 L46,70 L-46,70 Z" fill="url(#{u}wd)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
            f'<path d="M-50,-92 L50,-92 L42,-112 L-42,-112 Z" fill="#6a3a14" stroke="{INK}" stroke-width="4"/>'
            f'<rect x="-28" y="-62" width="20" height="16" rx="2" fill="{eyes}" stroke="{INK}" stroke-width="3"/><rect x="8" y="-62" width="20" height="16" rx="2" fill="{eyes}" stroke="{INK}" stroke-width="3"/>'
            f'<path d="M-6,-40 L0,-14 L6,-40" fill="none" stroke="{INK}" stroke-width="3.5"/>'
            f'<rect x="-24" y="2" width="48" height="12" rx="2" fill="{eyes}" stroke="{INK}" stroke-width="3"/><path d="M-12,2 v12 M0,2 v12 M12,2 v12" stroke="{INK}" stroke-width="2"/>'
            f'<path d="M-40,34 H40 M-42,50 H42" stroke="#4a2408" stroke-width="3" opacity=".6"/></g>')


def wood(u):
    return lg(f'{u}wd', [(0, '#c48a52'), (1, '#6a3a16')], 1, 1)


def idol(kind):
    u = 'id' + kind[:3]
    d = wood(u) + steel(u)
    glow = {'block': MINT, 'boost': '#8be03a', 'curse': RED, 'sniffer': '#7ee8ff', 'tribe': VELA}[kind]
    d += rg(f'{u}gl', [(0, glow + '88'), (1, glow + '00')])
    b = f'<circle cx="120" cy="150" r="120" fill="url(#{u}gl)"/>' + shadow(120, 276, 70)
    if kind == 'block':
        b += tiki(u, 120, 222, .9, MINT)
        b += (f'<g transform="rotate(-8 120 60)">' + blade(u, 120, 34, 104) + '</g>'
              + f'<path d="M30,128 C70,98 170,98 210,128" fill="none" stroke="{MINT}" stroke-width="10" stroke-linecap="round"/>'
              f'<path d="M30,128 C70,98 170,98 210,128" fill="none" stroke="#e8fff8" stroke-width="3" stroke-linecap="round"/>'
              + ''.join(f'<path d="M{x},{y} l{dx},{dy}" stroke="{GOLD}" stroke-width="4" stroke-linecap="round"/>' for x, y, dx, dy in ((40, 120, -16, -8), (200, 120, 16, -8))))
    else:
        b += tiki(u, 120, 206, .95, {'boost': '#c8f08a', 'curse': '#ff9a8a', 'sniffer': '#bfe9ff', 'tribe': '#d8cfff'}[kind])
        if kind == 'boost':
            b += (f'<path d="M190,120 L190,60 L176,60 L198,30 L220,60 L206,60 L206,120 Z" fill="#8be03a" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
                  + T_('+10', 54, 64, 'bebas', 46, '#c8f08a', 'middle', 2))
        elif kind == 'curse':
            b += (f'<path d="M190,30 L190,90 L176,90 L198,120 L220,90 L206,90 L206,30 Z" fill="{RED}" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
                  + T_('-10', 54, 64, 'bebas', 46, '#ff9a8a', 'middle', 2))
        elif kind == 'sniffer':
            b += (f'<path d="M40,56 C80,16 160,16 200,56 C160,96 80,96 40,56 Z" fill="#e8f6ff" stroke="{INK}" stroke-width="4"/>'
                  f'<circle cx="120" cy="56" r="20" fill="#2a8ad8" stroke="{INK}" stroke-width="4"/><circle cx="120" cy="56" r="8" fill="{INK}"/><circle cx="114" cy="50" r="4" fill="#fff"/>')
        else:
            b += (f'<path d="M120,8 L166,24 L166,58 C166,80 144,92 120,98 C96,92 74,80 74,58 L74,24 Z" fill="{VELA}" stroke="{INK}" stroke-width="5"/>'
                  f'<path d="M100,52 L114,66 L142,38" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>')
    return svg(240, 300, b, 'Idol ' + kind, d)


SYM = {
    'vela': lambda: f'<path d="M0,-34 L10,-10 L36,-8 L16,8 L22,34 L0,20 L-22,34 L-16,8 L-36,-8 L-10,-10 Z" fill="#fff" stroke="{INK}" stroke-width="3"/>',
    'koa': lambda: (f'<path d="M-36,10 C-24,-8 -12,-8 0,10 C12,28 24,28 36,10" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>'
                    f'<path d="M-36,-12 C-24,-30 -12,-30 0,-12 C12,6 24,6 36,-12" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>'),
    'ember': lambda: '<path d="M0,-38 C18,-16 24,0 16,18 C10,30 -10,30 -16,18 C-24,0 -14,-16 0,-38 Z" fill="#ffd24a" stroke="#0a0d18" stroke-width="3.5"/><path d="M0,-12 C8,-2 9,8 5,16 C2,20 -2,20 -5,16 C-9,8 -6,-2 0,-12 Z" fill="#fff4c8"/>',
}
TC = {'vela': ('#a99bff', '#4a3a98'), 'koa': ('#5fc7d4', '#1f6f7a'), 'ember': ('#ff9a52', '#a8401a')}


def buff_shape(u, name, x, y, s=1, rot=0):
    c1, c2 = TC[name]
    return (f'<g transform="translate({x},{y}) rotate({rot}) scale({s})">'
            f'<path d="M-90,-70 C-30,-84 30,-56 90,-70 L84,70 C30,56 -30,84 -84,70 Z" fill="url(#{u}{name})" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
            + ''.join(f'<path d="M-80,{yy} C-30,{yy - 10} 30,{yy + 12} 80,{yy}" stroke="#ffffff" stroke-width="3" fill="none" opacity=".25"/>' for yy in (-44, 48))
            + f'<g transform="translate(0,-8)">{SYM[name]()}</g>'
            + T_(name.upper(), 0, 52, 'bebas', 26, '#fff', 'middle', 5) + '</g>')


def buff(name):
    u = 'bf' + name[:2]
    c1, c2 = TC[name]
    d = lg(f'{u}{name}', [(0, c1), (1, c2)], 1, 1)
    b = shadow(120, 272, 90) + buff_shape(u, name, 120, 150, 1.15)
    return svg(240, 300, b, f'Tribe {name} buff', d)


def necklace():
    u = 'nk'
    d = wood(u) + rg(f'{u}gl', [(0, '#f2c94c88'), (1, '#f2c94c00')])
    beads = ''
    for k in range(17):
        a = math.pi * (0.08 + 0.84 * k / 16)
        x, y = 120 + math.cos(a) * 92, 40 + math.sin(a) * 120
        beads += f'<circle cx="{x:.1f}" cy="{y:.1f}" r="9" fill="{[ORANGE, GOLD, "#f2e2c8"][k % 3]}" stroke="{INK}" stroke-width="3"/>'
    b = (f'<circle cx="120" cy="170" r="110" fill="url(#{u}gl)"/>' + shadow(120, 284, 60)
         + f'<path d="M34,60 C40,150 200,150 206,60" fill="none" stroke="#6a3a14" stroke-width="5"/>' + beads
         + f'<path d="M120,158 L160,190 L148,256 L120,276 L92,256 L80,190 Z" fill="url(#{u}wd)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
         f'<path d="M120,180 L140,200 L132,242 L120,252 L108,242 L100,200 Z" fill="{GOLD}" stroke="{INK}" stroke-width="3"/>'
         f'<circle cx="120" cy="214" r="9" fill="{INK}"/>')
    return svg(240, 300, b, 'Immunity necklace', d)


def merge():
    u = 'mg'
    d = ''.join(lg(f'{u}{n}', [(0, TC[n][0]), (1, TC[n][1])], 1, 1) for n in TC) + rg(f'{u}gl', [(0, '#ff9a5288'), (1, '#ff9a5200')])
    b = (f'<circle cx="120" cy="190" r="110" fill="url(#{u}gl)"/>' + shadow(120, 286, 90)
         + buff_shape(u, 'vela', 64, 70, .5, -14) + buff_shape(u, 'koa', 176, 70, .5, 14)
         + f'<path d="M80,116 C90,150 104,160 116,170 M160,116 C150,150 136,160 124,170" fill="none" stroke="{ORANGE}" stroke-width="6" stroke-dasharray="2 10" stroke-linecap="round"/>'
         + buff_shape(u, 'ember', 120, 222, .66))
    return svg(240, 300, b, 'Merge', d)


def winner():
    u = 'wn'
    d = bamboo(u) + steel(u) + rg(f'{u}gl', [(0, '#f2c94caa'), (1, '#f2c94c00')]) + lg(f'{u}gd', [(0, '#fff3b8'), (.5, GOLD), (1, '#9a6a14')], 1, 1)
    leaf = lambda side: ''.join(f'<ellipse cx="{120 + side * (60 + 8 * math.sin(k))}" cy="{250 - k * 22}" rx="16" ry="7" fill="#7ac85a" stroke="{INK}" stroke-width="2.5" transform="rotate({side * (30 + k * 8)} {120 + side * (60 + 8 * math.sin(k))} {250 - k * 22})"/>' for k in range(7))
    b = (f'<circle cx="120" cy="130" r="120" fill="url(#{u}gl)"/>' + shadow(120, 284, 70) + leaf(-1) + leaf(1)
         + f'<g transform="translate(10,14) rotate(-24 120 170)"><path d="M112,80 L114,270 L126,270 L128,80 Z" fill="url(#{u}gd)" stroke="{INK}" stroke-width="4"/>'
         f'<path d="M100,56 L140,56 L134,84 L106,84 Z" fill="url(#{u}gd)" stroke="{INK}" stroke-width="4"/>' + flame(120, 56, 1.3) + '</g>'
         + f'<g transform="rotate(24 120 170)">' + blade(u, 120, 70, 70) + f'<rect x="114" y="140" width="12" height="130" rx="4" fill="#6a3a14" stroke="{INK}" stroke-width="3.5"/></g>'
         + T_('LAST ONE STANDING', 120, 296, 'bebas', 22, '#ffe9a6', 'middle', 3))
    return svg(240, 300, b, 'Winner', d)


# ---------------------------------------------------------------- backgrounds 1600x600
def palm(x, y, s=1, col='#120a10'):
    return (f'<g transform="translate({x},{y}) scale({s})"><path d="M0,0 C-8,-90 10,-180 0,-260" stroke="{col}" stroke-width="14" fill="none"/>'
            + ''.join(f'<path d="M0,-260 q{dx},{dy} {dx * 2},{dy * .2 + 40}" stroke="{col}" stroke-width="16" fill="none" stroke-linecap="round"/>' for dx, dy in ((60, -40), (-60, -40), (50, 10), (-50, 10), (20, -60)))
            + '</g>')


def big_guillotine(x, y, s, col_fill='#1a0e0a', lit=True, u='bg'):
    out = f'<g transform="translate({x},{y}) scale({s})">'
    out += (f'<rect x="-80" y="-300" width="22" height="300" rx="4" fill="{col_fill}" stroke="{INK}" stroke-width="4"/><rect x="58" y="-300" width="22" height="300" rx="4" fill="{col_fill}" stroke="{INK}" stroke-width="4"/>'
            f'<rect x="-96" y="-320" width="192" height="26" rx="5" fill="{col_fill}" stroke="{INK}" stroke-width="4"/>'
            f'<path d="M-56,-280 H56 V-236 L-56,-200 Z" fill="#c8d0dc" stroke="{INK}" stroke-width="4"/><path d="M-50,-206 L50,-238" stroke="#fff" stroke-width="3"/>'
            f'<rect x="-60" y="-50" width="120" height="22" rx="4" fill="{col_fill}" stroke="{INK}" stroke-width="4"/>')
    out += torch(-150, -150, lit, 1.3) + torch(150, -150, lit, 1.3)
    return out + '</g>'


def bg(kind):
    u = 'bg' + kind[:3]
    D = ''
    r = random.Random(7)
    if kind == 'beach-dusk':
        D = lg(f'{u}sk', [(0, '#2a1440'), (.45, '#c8483a'), (.75, '#ff9a52'), (1, '#ffd08a')]) + rg(f'{u}sn', [(0, '#fff2c0'), (1, '#ffb86a00')]) + lg(f'{u}sea', [(0, '#3a2a5a'), (1, '#12102a')])
        b = (f'<rect width="1600" height="600" fill="url(#{u}sk)"/><circle cx="1140" cy="360" r="200" fill="url(#{u}sn)"/><circle cx="1140" cy="380" r="70" fill="#fff0c8"/>'
             + f'<rect x="0" y="420" width="1600" height="180" fill="url(#{u}sea)"/>'
             + ''.join(f'<path d="M{x},{430 + k * 18} h{60 + (x % 5) * 20}" stroke="#ffb86a" stroke-width="3" opacity="{.5 - k * .1:.2f}"/>' for k in range(4) for x in range(1040, 1260, 70))
             + f'<path d="M600,520 C900,480 1300,480 1600,500 L1600,600 L600,600 Z" fill="#2a1408"/>'
             + big_guillotine(1140, 540, .9, '#2a160c') + palm(760, 560, 1) + palm(1500, 560, 1.1) + palm(1560, 580, .8))
    elif kind == 'jungle-camp':
        D = lg(f'{u}sk', [(0, '#0a2018'), (1, '#1a3a24')]) + rg(f'{u}fr', [(0, '#ffb86aaa'), (1, '#ffb86a00')])
        leaves = ''.join(f'<ellipse cx="{r.uniform(600, 1600):.0f}" cy="{r.uniform(0, 260):.0f}" rx="{r.uniform(60, 140):.0f}" ry="{r.uniform(20, 50):.0f}" fill="{r.choice(["#1f4a2a", "#2a5a32", "#163a22"])}" transform="rotate({r.uniform(-40, 40):.0f} 0 0)" opacity=".9"/>' for _ in range(40))
        b = (f'<rect width="1600" height="600" fill="url(#{u}sk)"/>' + leaves
             + f'<rect x="0" y="470" width="1600" height="130" fill="#2a1a10"/>'
             + f'<g transform="translate(1260,470)"><path d="M-200,0 L-160,-180 L160,-180 L200,0" fill="none" stroke="{INK}" stroke-width="0"/>'
             f'<rect x="-170" y="-170" width="14" height="170" fill="#6a4a1e" stroke="{INK}" stroke-width="3"/><rect x="156" y="-170" width="14" height="170" fill="#6a4a1e" stroke="{INK}" stroke-width="3"/>'
             f'<path d="M-210,-150 L0,-250 L210,-150 Z" fill="#b8963a" stroke="{INK}" stroke-width="5"/>'
             + ''.join(f'<path d="M{-200 + k * 20},-150 L{-180 + k * 20},-140" stroke="#6a4a1e" stroke-width="3"/>' for k in range(21))
             + f'<rect x="-150" y="-70" width="300" height="16" rx="4" fill="#8a6a2e" stroke="{INK}" stroke-width="3"/></g>'
             + f'<circle cx="960" cy="470" r="150" fill="url(#{u}fr)"/>'
             + ''.join(f'<rect x="{900 + k * 24}" y="458" width="70" height="12" rx="5" fill="#5a3a1e" stroke="{INK}" stroke-width="3" transform="rotate({(-1) ** k * 20} {935 + k * 24} 464)"/>' for k in range(3))
             + flame(958, 456, 1.6) + torch(760, 470, True, 1.2) + torch(1560, 470, True, 1.2))
    elif kind == 'chop-stage':
        D = lg(f'{u}sk', [(0, '#05060f'), (1, '#1a0e1a')]) + rg(f'{u}gl', [(0, '#ff8a2a66'), (1, '#ff8a2a00')])
        stars = ''.join(f'<circle cx="{r.uniform(0, 1600):.0f}" cy="{r.uniform(0, 300):.0f}" r="{r.uniform(.6, 1.8):.1f}" fill="#ffe8c8" opacity="{r.uniform(.3, .9):.2f}"/>' for _ in range(110))
        b = (f'<rect width="1600" height="600" fill="url(#{u}sk)"/>' + stars + f'<ellipse cx="1140" cy="380" rx="420" ry="260" fill="url(#{u}gl)"/>'
             + f'<path d="M760,600 L840,500 L1440,500 L1520,600 Z" fill="#3a2410" stroke="{INK}" stroke-width="5"/>'
             + ''.join(f'<path d="M{860 + k * 60},500 l-6,100" stroke="#2a1808" stroke-width="3"/>' for k in range(10))
             + big_guillotine(1140, 500, 1.05, '#4a2a12')
             + ''.join(f'<g transform="translate({x},560)"><path d="M-40,0 L40,0 L28,30 L-28,30 Z" fill="#3a2a1a" stroke="{INK}" stroke-width="4"/>' + flame(-14, 0, 1.1) + flame(14, 2, .9) + '</g>' for x in (800, 1480)))
    else:  # merge-feast
        D = lg(f'{u}sk', [(0, '#3a1a3a'), (.6, '#a8401a'), (1, '#ff9a52')]) + lg(f'{u}tb', [(0, '#8a5a2a'), (1, '#4a2a10')])
        b = (f'<rect width="1600" height="600" fill="url(#{u}sk)"/><circle cx="1200" cy="380" r="90" fill="#ffd08a" opacity=".85"/>'
             + f'<rect x="0" y="460" width="1600" height="140" fill="#2a1408"/>'
             + f'<rect x="820" y="420" width="700" height="34" rx="6" fill="url(#{u}tb)" stroke="{INK}" stroke-width="5"/>'
             + ''.join(f'<path d="M{x},454 v80" stroke="{INK}" stroke-width="12"/>' for x in (860, 1480))
             + ''.join(f'<circle cx="{860 + k * 52}" cy="{404 - (k % 3) * 6}" r="{16 + (k % 2) * 6}" fill="{["#ff6a3a", "#f2c94c", "#7ac85a", "#c84a8a"][k % 4]}" stroke="{INK}" stroke-width="3"/>' for k in range(13))
             + f'<g transform="translate(1170,250)"><path d="M-150,-90 C-50,-110 50,-70 150,-90 L144,60 C50,40 -50,80 -144,60 Z" fill="#c8501a" stroke="{INK}" stroke-width="5"/>'
             + f'<g transform="translate(0,-14) scale(1.4)">{SYM["ember"]()}</g>' + T_('EMBER', 0, 48, 'bebas', 34, '#fff', 'middle', 6) + '</g>'
             + ''.join(f'<path d="M{x},140 v-140" stroke="{INK}" stroke-width="3"/>' for x in (1030, 1310))
             + torch(760, 470, True, 1.3) + torch(1560, 470, True, 1.3) + palm(700, 600, .9))
    return svg(1600, 600, b, kind, D)


# ---------------------------------------------------------------- blank buffs + symbols (for preset and custom tribe names)
BUFF_COLORS = {'purple': ('#a99bff', '#4a3a98'), 'teal': ('#5fc7d4', '#1f6f7a'), 'orange': ('#ff9a52', '#a8401a'), 'red': ('#ff6a5a', '#8a1a14'),
               'gold': ('#ffd86a', '#9a6a14'), 'green': ('#7ad87a', '#1f6a2a'), 'blue': ('#6ab8ff', '#1a3a8a'), 'pink': ('#ff8ad0', '#8a1a5a')}
SYMS = {
    'star': '<path d="M0,-34 L10,-10 L36,-8 L16,8 L22,34 L0,20 L-22,34 L-16,8 L-36,-8 L-10,-10 Z" fill="#fff" stroke="#0a0d18" stroke-width="3"/>',
    'wave': SYM['koa'](),
    'flame': SYM['ember'](),
    'leaf': '<path d="M0,36 C-40,10 -30,-30 0,-38 C30,-30 40,10 0,36 Z" fill="#fff" stroke="#0a0d18" stroke-width="3"/><path d="M0,30 V-30" stroke="#0a0d18" stroke-width="3"/>',
    'sun': '<circle r="16" fill="#fff" stroke="#0a0d18" stroke-width="3"/>' + ''.join(f'<path d="M{math.cos(a) * 22:.1f},{math.sin(a) * 22:.1f} L{math.cos(a) * 34:.1f},{math.sin(a) * 34:.1f}" stroke="#fff" stroke-width="6" stroke-linecap="round"/>' for a in [k * math.pi / 4 for k in range(8)]),
    'moon': '<path d="M14,-32 A34,34 0 1 0 14,32 A26,26 0 0 1 14,-32 Z" fill="#fff" stroke="#0a0d18" stroke-width="3"/>',
    'bolt': '<path d="M8,-38 L-20,4 L-2,4 L-10,38 L20,-6 L2,-6 Z" fill="#fff" stroke="#0a0d18" stroke-width="3" stroke-linejoin="round"/>',
    'mountain': '<path d="M-38,30 L-10,-26 L4,-2 L14,-16 L38,30 Z" fill="#fff" stroke="#0a0d18" stroke-width="3" stroke-linejoin="round"/>',
    'fin': '<path d="M-36,28 C-10,20 4,-6 10,-36 C20,-10 30,14 36,28 Z" fill="#fff" stroke="#0a0d18" stroke-width="3" stroke-linejoin="round"/>',
    'shell': '<path d="M0,-32 C26,-32 36,-6 30,18 L0,32 L-30,18 C-36,-6 -26,-32 0,-32 Z" fill="#fff" stroke="#0a0d18" stroke-width="3"/>' + ''.join(f'<path d="M0,30 L{x},-24" stroke="#0a0d18" stroke-width="2.5"/>' for x in (-22, -8, 8, 22)),
}


def buff_base(color):
    u = 'bb' + color[:3]
    c1, c2 = BUFF_COLORS[color]
    d = lg(f'{u}g', [(0, c1), (1, c2)], 1, 1)
    b = (shadow(120, 250, 90)
         + f'<g transform="translate(120,130) scale(1.15)"><path d="M-90,-70 C-30,-84 30,-56 90,-70 L84,70 C30,56 -30,84 -84,70 Z" fill="url(#{u}g)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
         + ''.join(f'<path d="M-80,{yy} C-30,{yy - 10} 30,{yy + 12} 80,{yy}" stroke="#ffffff" stroke-width="3" fill="none" opacity=".25"/>' for yy in (-44, 48)) + '</g>')
    return svg(240, 260, b, f'Blank {color} buff', d)


def sym(name):
    return svg(80, 80, f'<g transform="translate(40,40)">{SYMS[name]}</g>', f'{name} symbol')


def all_files():
    f = {'guillotine.svg': guillotine(), 'guillotine-drop.svg': guillotine(True), 'torch-lit.svg': torch_art(True), 'torch-out.svg': torch_art(False),
         'necklace.svg': necklace(), 'merge.svg': merge(), 'winner.svg': winner()}
    for k in ('block', 'boost', 'curse', 'sniffer', 'tribe'):
        f[f'idol-{k}.svg'] = idol(k)
    for k in ('vela', 'koa', 'ember'):
        f[f'buff-{k}.svg'] = buff(k)
    for c in BUFF_COLORS:
        f[f'tribes/buff-{c}.svg'] = buff_base(c)
    for n in SYMS:
        f[f'tribes/sym-{n}.svg'] = sym(n)
    for k in ('beach-dusk', 'jungle-camp', 'chop-stage', 'merge-feast'):
        f[f'bg/{k}.svg'] = bg(k)
    return f


if __name__ == '__main__':
    base = os.path.join(sys.argv[1], 'survguil'); os.makedirs(os.path.join(base, 'bg'), exist_ok=True); os.makedirs(os.path.join(base, 'tribes'), exist_ok=True)
    fs = all_files()
    for p, s in fs.items():
        open(os.path.join(base, p), 'w').write(s)
    print('wrote', len(fs))
