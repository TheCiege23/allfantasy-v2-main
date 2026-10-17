"""Guilly (NBA guillotine league) art pack.
python3 gen_guilly.py <out_dir>  ->  <out_dir>/guilly/...
All text is outlined (no font dependency). Basketball 'heads' keep it fun, not gory.
"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_a import svg, lg, rg
from outline import text as T_, width as W_

INK = '#0e0a08'
RED, RED2, GOLD, GOLD2 = '#ff3d2e', '#9e1410', '#ffc531', '#c98a0c'

def defs(u):
    return (lg(f'{u}st', [(0, '#f6f8fb'), (.5, '#b4bccb'), (1, '#5d6676')], 1, 1) +
            lg(f'{u}wd', [(0, '#e0a868'), (.5, '#c27c3c'), (1, '#8a4c1c')], 1, 0) +
            rg(f'{u}bl', [(0, '#ffb26a'), (.55, '#ee7a2c'), (1, '#a8460f')], '38%', '32%', '75%') +
            lg(f'{u}gd', [(0, '#fff0a8'), (.45, GOLD), (1, GOLD2)]) +
            lg(f'{u}rd', [(0, '#ff6a4e'), (1, RED2)]))

# ------------------------------------------------------------------ basketball heads
def ball(u, cx, cy, r, face='calm', rot=0):
    s = r / 50
    seams = (f'<g transform="translate({cx},{cy}) rotate({rot})"><circle r="{r}" fill="url(#{u}bl)" stroke="{INK}" stroke-width="{3.2 * s + 1}"/>'
             f'<path d="M0,{-r} V{r} M{-r},0 H{r} M{-r * .72},{-r * .7} C{-r * .25},{-r * .3} {-r * .25},{r * .3} {-r * .72},{r * .7} M{r * .72},{-r * .7} C{r * .25},{-r * .3} {r * .25},{r * .3} {r * .72},{r * .7}" '
             f'fill="none" stroke="{INK}" stroke-width="{2.2 * s + .6}" opacity=".55"/>'
             f'<ellipse cx="{-r * .35}" cy="{-r * .45}" rx="{r * .28}" ry="{r * .14}" fill="#fff" opacity=".35" transform="rotate(-30 {-r * .35} {-r * .45})"/></g>')
    ex, ey, er = r * .32, -r * .08, r * .2
    f = ''
    if face in ('calm', 'crown'):
        f += ''.join(f'<ellipse cx="{cx + d * ex}" cy="{cy + ey}" rx="{er * .8}" ry="{er}" fill="#fff" stroke="{INK}" stroke-width="{2 * s}"/><circle cx="{cx + d * ex + er * .15}" cy="{cy + ey + er * .2}" r="{er * .45}" fill="{INK}"/>' for d in (-1, 1))
        f += f'<path d="M{cx - r * .3},{cy + r * .3} Q{cx},{cy + r * .58} {cx + r * .3},{cy + r * .3}" fill="none" stroke="{INK}" stroke-width="{3.4 * s}" stroke-linecap="round"/>'
    elif face == 'nervous':
        f += ''.join(f'<ellipse cx="{cx + d * ex}" cy="{cy + ey}" rx="{er * .95}" ry="{er * 1.2}" fill="#fff" stroke="{INK}" stroke-width="{2 * s}"/><circle cx="{cx + d * ex + er * .3}" cy="{cy + ey - er * .35}" r="{er * .38}" fill="{INK}"/>' for d in (-1, 1))
        f += ''.join(f'<path d="M{cx + d * ex - er},{cy + ey - er * 1.7} L{cx + d * ex + er},{cy + ey - er * 1.3 - d * er * .3}" stroke="{INK}" stroke-width="{3 * s}" stroke-linecap="round"/>' for d in (-1, 1))
        w = r * .5
        f += (f'<path d="M{cx - w},{cy + r * .42} q{w / 4},{-r * .12} {w / 2},0 t{w / 2},0 t{w / 2},0 t{w / 2},0" fill="none" stroke="{INK}" stroke-width="{3.2 * s}" stroke-linecap="round"/>'
              f'<path d="M{cx + r * .78},{cy - r * .62} c{-r * .12},{r * .2} {-r * .14},{r * .32} 0,{r * .36} c{r * .14},{-r * .04} {r * .12},{-r * .16} 0,{-r * .36} Z" fill="#8fd8ff" stroke="{INK}" stroke-width="{1.6 * s}"/>')
    elif face == 'ko':
        for d in (-1, 1):
            x0, y0 = cx + d * ex, cy + ey
            f += f'<path d="M{x0 - er},{y0 - er} L{x0 + er},{y0 + er} M{x0 + er},{y0 - er} L{x0 - er},{y0 + er}" stroke="{INK}" stroke-width="{4 * s}" stroke-linecap="round"/>'
        f += (f'<ellipse cx="{cx}" cy="{cy + r * .42}" rx="{r * .2}" ry="{r * .14}" fill="#3a0a06" stroke="{INK}" stroke-width="{2 * s}"/>'
              f'<path d="M{cx - r * .06},{cy + r * .5} q{r * .1},{r * .22} {r * .2},0" fill="#ff7a9a" stroke="{INK}" stroke-width="{1.6 * s}"/>')
    if face == 'crown':
        f += (f'<path d="M{cx - r * .55},{cy - r * .78} L{cx - r * .62},{cy - r * 1.32} L{cx - r * .28},{cy - r * 1.04} L{cx},{cy - r * 1.42} L{cx + r * .28},{cy - r * 1.04} L{cx + r * .62},{cy - r * 1.32} L{cx + r * .55},{cy - r * .78} Z" '
              f'fill="url(#{u}gd)" stroke="{INK}" stroke-width="{2.6 * s}" stroke-linejoin="round"/>'
              + ''.join(f'<circle cx="{cx + d * r * .3}" cy="{cy - r * .92}" r="{r * .07}" fill="{RED}"/>' for d in (-1, 0, 1)))
    return seams + f

def stars_ring(cx, cy, rr, n=4, c=GOLD, sz=8):
    out = ''
    for i in range(n):
        a = math.radians(-160 + i * (140 / (n - 1)))
        x, y = cx + rr * math.cos(a), cy + rr * .45 * math.sin(a)
        pts = ' '.join(f'{x + (sz if k % 2 == 0 else sz * .42) * math.cos(math.radians(-90 + k * 36)):.1f},{y + (sz if k % 2 == 0 else sz * .42) * math.sin(math.radians(-90 + k * 36)):.1f}' for k in range(10))
        out += f'<polygon points="{pts}" fill="{c}" stroke="{INK}" stroke-width="1.2"/>'
    return out

# ------------------------------------------------------------------ guillotine
def guillotine(u, x, y, s=1, blade_down=False, head=None):
    """Frame origin = top-left of crossbar. Width ~ 140*s, height ~ 230*s."""
    g = f'<g transform="translate({x},{y}) scale({s})">'
    g += f'<rect x="10" y="10" width="18" height="220" rx="3" fill="url(#{u}wd)" stroke="{INK}" stroke-width="3.5"/><rect x="112" y="10" width="18" height="220" rx="3" fill="url(#{u}wd)" stroke="{INK}" stroke-width="3.5"/>'
    g += f'<path d="M50,30 V170 M90,30 V170" stroke="{INK}" stroke-width="2" opacity=".25"/>'
    g += f'<rect x="0" y="0" width="140" height="22" rx="5" fill="url(#{u}wd)" stroke="{INK}" stroke-width="3.5"/><rect x="0" y="0" width="140" height="7" rx="3" fill="{RED}" stroke="{INK}" stroke-width="2"/>'
    by = 128 if blade_down else 36
    if not blade_down:
        g += f'<path d="M70,22 V{by}" stroke="#d9b07a" stroke-width="4" stroke-dasharray="3 3"/>'
    g += (f'<rect x="26" y="{by - 8}" width="88" height="12" rx="2" fill="#3a404c" stroke="{INK}" stroke-width="3"/>'
          f'<path d="M28,{by + 4} L112,{by + 4} L112,{by + 30} L28,{by + 64} Z" fill="url(#{u}st)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
          f'<path d="M30,{by + 58} L110,{by + 25}" stroke="{RED}" stroke-width="5"/><path d="M34,{by + 52} L106,{by + 22}" stroke="#fff" stroke-width="2.5" opacity=".9"/>')
    g += (f'<rect x="18" y="176" width="104" height="30" rx="5" fill="url(#{u}wd)" stroke="{INK}" stroke-width="3.5"/>'
          f'<path d="M44,176 A26,26 0 0 0 96,176" fill="#1a0806" stroke="{INK}" stroke-width="3"/>')
    if head:
        g += ball(u, 70, 168, 30, head)
        g += f'<rect x="18" y="176" width="104" height="10" fill="url(#{u}wd)" stroke="{INK}" stroke-width="3"/>'
    g += f'<rect x="-8" y="226" width="156" height="14" rx="4" fill="#5a2a12" stroke="{INK}" stroke-width="3"/>'
    if blade_down:
        g += f'<path d="M20,150 l-14,-6 M120,150 l14,-6 M18,166 l-16,2 M122,166 l16,2" stroke="{GOLD}" stroke-width="4" stroke-linecap="round"/>'
    return g + '</g>'

def outlined(t, x, y, font, size, fill, anchor='start', stroke=INK, sw=6, spacing=0, shadow=None):
    p = T_(t, x, y, font, size, fill, anchor, spacing)
    d = p.split('d="', 1)[1].split('"', 1)[0]
    out = ''
    if shadow:
        out += f'<path d="{d}" fill="{shadow}" transform="translate(5,6)"/>'
    out += f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/><path d="{d}" fill="{fill}"/>'
    return out

SHIELD_O = 'M150,10 L272,46 L262,196 C252,262 206,298 150,318 C94,298 48,262 38,196 L28,46 Z'
SHIELD_I = 'M150,26 L256,57 L247,194 C238,250 200,282 150,300 C100,282 62,250 53,194 L44,57 Z'

# ------------------------------------------------------------------ pieces
def emblem():
    u = 'gye'
    d = defs(u) + rg(f'{u}bg', [(0, '#5c0f12'), (.7, '#210407'), (1, '#0c0204')], '50%', '40%', '75%') + lg(f'{u}rim', [(0, '#ffe08a'), (.5, GOLD2), (1, '#6e4a08')], 0, 1)
    rays = ''.join(f'<path d="M150,150 L{150 + 240 * math.cos(math.radians(a)):.0f},{150 + 240 * math.sin(math.radians(a)):.0f} L{150 + 240 * math.cos(math.radians(a + 7)):.0f},{150 + 240 * math.sin(math.radians(a + 7)):.0f} Z" fill="{RED}" opacity=".09"/>' for a in range(0, 360, 20))
    b = (f'<path d="{SHIELD_O}" fill="url(#{u}rim)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
         f'<path d="{SHIELD_I}" fill="url(#{u}bg)" stroke="{INK}" stroke-width="3"/>'
         f'<clipPath id="{u}cl"><path d="{SHIELD_I}"/></clipPath><g clip-path="url(#{u}cl)">{rays}'
         f'<circle cx="150" cy="300" r="70" fill="none" stroke="{GOLD}" stroke-opacity=".18" stroke-width="4"/><path d="M44,232 H256" stroke="{GOLD}" stroke-opacity=".18" stroke-width="4"/></g>'
         + guillotine(u, 85, 44, .93, head='nervous') +
         f'<path d="M58,268 L242,268 L232,300 L68,300 Z" fill="url(#{u}rd)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
         f'<path d="M58,268 L40,262 L50,284 L40,306 L68,300 Z M242,268 L260,262 L250,284 L260,306 L232,300 Z" fill="{RED2}" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>'
         + outlined('GUILLY', 150, 296, 'bebas', 36, '#fff', 'middle', sw=5, spacing=3))
    return svg(300, 340, b, 'Guilly league emblem', d)

def wordmark():
    u = 'gyw'
    d = defs(u)
    b = (outlined('GUILLY', 300, 160, 'bebas', 170, f'url(#{u}gd)', 'middle', sw=12, spacing=6, shadow=RED2) +
         f'<g transform="translate(492,22) rotate(14) scale(.78)"><path d="M0,0 L120,0 L120,40 L0,90 Z" fill="url(#{u}st)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
         f'<path d="M4,82 L116,36" stroke="{RED}" stroke-width="7"/><rect x="-4" y="-12" width="128" height="14" rx="3" fill="#3a404c" stroke="{INK}" stroke-width="4"/></g>'
         + ball(u, 96, 52, 34, 'nervous', -12) +
         outlined('LAST TEAM STANDING', 300, 196, 'archivo-900', 20, '#fff', 'middle', sw=5, spacing=4))
    return svg(640, 210, b, 'Guilly wordmark', d)

def off_with_head():
    u = 'gyo'
    d = defs(u)
    burst = ' '.join(f'{450 + (300 if i % 2 == 0 else 220) * math.cos(math.radians(i * 15)):.0f},{150 + (150 if i % 2 == 0 else 105) * math.sin(math.radians(i * 15)):.0f}' for i in range(24))
    b = (f'<polygon points="{burst}" fill="url(#{u}rd)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
         + outlined('OFF WITH', 405, 128, 'bebas', 104, '#fff', 'middle', sw=10, spacing=4, shadow=INK) +
         outlined('YOUR HEAD!', 405, 236, 'bebas', 118, f'url(#{u}gd)', 'middle', sw=10, spacing=4, shadow=INK) +
         f'<path d="M110,262 L700,40" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".9"/><path d="M110,262 L700,40" stroke="{INK}" stroke-width="2" stroke-linecap="round" transform="translate(0,6)" opacity=".5"/>'
         + ball(u, 790, 210, 58, 'ko', 24) + stars_ring(790, 140, 70, 4))
    return svg(900, 300, b, 'Off with your head', d)

def chop_scene():
    u = 'gyc'
    d = defs(u) + rg(f'{u}bg', [(0, '#6a1414'), (1, '#120306')], '50%', '45%', '70%')
    rays = ''.join(f'<path d="M300,250 L{300 + 600 * math.cos(math.radians(a)):.0f},{250 + 600 * math.sin(math.radians(a)):.0f} L{300 + 600 * math.cos(math.radians(a + 6)):.0f},{250 + 600 * math.sin(math.radians(a + 6)):.0f} Z" fill="{GOLD}" opacity=".08"/>' for a in range(0, 360, 15))
    floor = (f'<path d="M0,440 L600,440 L600,520 L0,520 Z" fill="url(#{u}wd)"/>' + ''.join(f'<path d="M0,{452 + k * 18} H600" stroke="#8a4c1c" stroke-opacity=".35" stroke-width="2"/>' for k in range(4))
             + f'<path d="M0,440 H600" stroke="{INK}" stroke-width="4"/><ellipse cx="300" cy="484" rx="140" ry="22" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4"/>')
    motion = ''.join(f'<path d="M{330 + k * 40},{396 - k * 26} q30,-40 60,0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 12" opacity="{.8 - k * .2}"/>' for k in range(3))
    b = (f'<rect width="600" height="520" fill="url(#{u}bg)"/>{rays}{floor}'
         + guillotine(u, 120, 150, 1.26, blade_down=True) + motion + ball(u, 482, 392, 46, 'ko', 30) + stars_ring(482, 336, 56, 4) +
         f'<ellipse cx="482" cy="446" rx="40" ry="7" fill="#000" opacity=".35"/>')
    return svg(600, 520, b, 'The chop', d)

def banner():
    u = 'gyb'
    d = (defs(u) + lg(f'{u}sky', [(0, '#06030a'), (.6, '#2a0710'), (1, '#5c1210')]) +
         lg(f'{u}cone', [(0, '#ffe3b0'), (1, '#ffe3b000')]) + lg(f'{u}crt', [(0, '#c27c3c'), (1, '#7a3e14')]))
    crowd = ''
    for row, (yy, col) in enumerate(((300, '#170409'), (318, '#1f060c'), (338, '#280810'))):
        crowd += ''.join(f'<circle cx="{x + (row * 11) % 22}" cy="{yy - (x * 7 % 9)}" r="{11 + (x * 3 + row) % 5}" fill="{col}"/>' for x in range(0, 1620, 24))
    flags = ''.join(f'<path d="M{x},0 V70 L{x + 30},88 L{x + 60},70 V0 Z" fill="{RED if i % 2 else GOLD2}" opacity=".7" stroke="{INK}" stroke-width="2"/>' for i, x in enumerate(range(80, 1600, 190)) if abs(x - 800) > 220)
    cones = ''.join(f'<path d="M{x},0 L{x + dx - 140},500 L{x + dx + 140},500 Z" fill="url(#{u}cone)" opacity=".12"/>' for x, dx in ((300, 380), (1300, -380), (800, 0)))
    court = (f'<path d="M-100,500 L330,360 L1270,360 L1700,500 Z" fill="url(#{u}crt)" stroke="{INK}" stroke-width="3"/>'
             f'<path d="M800,360 L800,500" stroke="#fff" stroke-opacity=".5" stroke-width="3"/><ellipse cx="800" cy="420" rx="170" ry="34" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3"/>'
             + ''.join(f'<path d="M{330 - k * 60},{360 + k * 20} L{1270 + k * 60},{360 + k * 20}" stroke="#5a2a0c" stroke-opacity=".35" stroke-width="2"/>' for k in range(1, 7)))
    jumbo = (f'<path d="M800,0 V30" stroke="#333" stroke-width="5"/><rect x="640" y="30" width="320" height="96" rx="10" fill="#0c0a10" stroke="{INK}" stroke-width="4"/>'
             f'<rect x="652" y="42" width="296" height="72" rx="6" fill="#200608" stroke="{RED}" stroke-width="2"/>' + outlined('CHOP NIGHT', 800, 98, 'bebas', 54, GOLD, 'middle', sw=4, spacing=4))
    b = (f'<rect width="1600" height="500" fill="url(#{u}sky)"/>' + ''.join(f'<path d="M0,{20 + k * 18} H1600" stroke="#2a1018" stroke-width="3"/>' for k in range(3))
         + flags + cones + crowd + court + jumbo + guillotine(u, 712, 170, 1.0, head='nervous'))
    return svg(1600, 500, b, 'Guilly banner', d).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ', 1)

def tombstone():
    u = 'gyt'
    d = defs(u) + lg(f'{u}sn', [(0, '#9aa3b3'), (1, '#4c5463')], 1, 1)
    b = (f'<ellipse cx="100" cy="226" rx="88" ry="12" fill="#000" opacity=".35"/>'
         f'<path d="M30,222 V90 C30,40 170,40 170,90 V222 Z" fill="url(#{u}sn)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
         f'<path d="M42,214 V94 C42,56 158,56 158,94 V214" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="3"/>'
         f'<path d="M140,70 l-12,22 l10,8 l-14,20" fill="none" stroke="{INK}" stroke-width="3" opacity=".6"/>'
         + outlined('R.I.P.', 100, 106, 'bebas', 34, '#2a2f3a', 'middle', stroke='#cfd5df', sw=2, spacing=3)
         + ball(u, 100, 186, 22, 'ko') +
         ''.join(f'<path d="M{x},224 l4,-14 l4,14 M{x + 6},224 l5,-10 l3,10" fill="#2e7a3a" stroke="{INK}" stroke-width="1.5"/>' for x in (22, 60, 128, 162)))
    return svg(200, 240, b, 'Tombstone', d)

def head(face):
    u = 'gyh' + face
    return svg(128, 140 if face == 'crown' else 128, ball(u, 64, 76 if face == 'crown' else 64, 54, face), f'{face} ball head', defs(u))

def icons():
    out = {}
    def I(name, body, label, u):
        out[f'icon-{name}.svg'] = svg(64, 64, body, label, defs(u))
    u = 'gi1'; I('chop', guillotine(u, 9, 4, .33, blade_down=True), 'Chop', u)
    u = 'gi2'; I('danger', f'<circle cx="32" cy="32" r="29" fill="#3a0a0a" stroke="{RED}" stroke-width="3" stroke-dasharray="6 4"/>' + ball(u, 32, 34, 20, 'nervous'), 'Chopping block', u)
    u = 'gi3'; I('safe', f'<path d="M32,3 L58,12 L55,36 C53,50 43,58 32,62 C21,58 11,50 9,36 L6,12 Z" fill="#1e6a40" stroke="{INK}" stroke-width="3"/>' + ball(u, 32, 30, 14, 'calm')
                  + f'<path d="M22,50 l6,5 l14,-12" stroke="#c4ffd8" stroke-width="4" fill="none" stroke-linecap="round"/>', 'Safe', u)
    u = 'gi4'; I('crown', ball(u, 32, 38, 21, 'crown'), 'Last standing', u)
    u = 'gi5'; I('faab', ''.join(f'<ellipse cx="32" cy="{50 - k * 8}" rx="20" ry="7" fill="url(#{u}gd)" stroke="{INK}" stroke-width="2.5"/>' for k in range(4))
                  + T_('$', 32, 33, 'archivo-900', 13, INK, 'middle'), 'FAAB', u)
    u = 'gi6'; I('gavel', f'<g transform="rotate(-35 32 32)"><rect x="16" y="12" width="30" height="14" rx="4" fill="url(#{u}wd)" stroke="{INK}" stroke-width="3"/><rect x="29" y="26" width="5" height="30" rx="2" fill="#8a4c1c" stroke="{INK}" stroke-width="2.5"/></g>'
                  f'<rect x="8" y="50" width="30" height="8" rx="3" fill="{RED}" stroke="{INK}" stroke-width="2.5"/>', 'Auction', u)
    u = 'gi7'; I('bestball', ball(u, 28, 34, 20, 'calm') + f'<circle cx="48" cy="48" r="12" fill="{GOLD}" stroke="{INK}" stroke-width="2.5"/>' + T_('A', 48, 53, 'archivo-900', 14, INK, 'middle'), 'Bestball', u)
    u = 'gi8'; I('tomb', f'<path d="M14,58 V26 C14,8 50,8 50,26 V58 Z" fill="#7d8696" stroke="{INK}" stroke-width="3"/>' + ball(u, 32, 42, 9, 'ko') + T_('RIP', 32, 28, 'archivo-900', 9, '#20242c', 'middle'), 'Graveyard', u)
    u = 'gi9'; I('streak', f'<path d="M32,4 C40,18 52,24 50,40 C48,54 40,60 32,60 C22,60 14,52 14,40 C14,30 22,26 24,16 C28,24 30,26 32,26 C34,18 32,12 32,4 Z" fill="url(#{u}rd)" stroke="{INK}" stroke-width="3"/>'
                  f'<path d="M32,30 C36,38 42,42 40,50 C38,56 26,56 25,49 C24,44 28,42 32,30 Z" fill="{GOLD}"/>', 'Survival streak', u)
    u = 'gi10'; I('basket', f'<path d="M8,30 H56 L50,58 H14 Z" fill="url(#{u}wd)" stroke="{INK}" stroke-width="3"/>' + ''.join(f'<path d="M{14 + k * 9},30 L{17 + k * 7},58" stroke="{INK}" stroke-width="1.5" opacity=".5"/>' for k in range(5))
                  + ball(u, 32, 24, 13, 'ko'), 'Basket', u)
    return out

def all_files():
    f = {'emblem.svg': emblem(), 'wordmark.svg': wordmark(), 'off-with-your-head.svg': off_with_head(), 'chop.svg': chop_scene(),
         'banner.svg': banner(), 'tombstone.svg': tombstone()}
    for face in ('calm', 'nervous', 'ko', 'crown'):
        f[f'head-{face}.svg'] = head(face)
    f.update(icons())
    return f

if __name__ == '__main__':
    base = os.path.join(sys.argv[1], 'guilly'); os.makedirs(base, exist_ok=True)
    for p, s in all_files().items():
        open(os.path.join(base, p), 'w').write(s)
    print('wrote', len(all_files()))
