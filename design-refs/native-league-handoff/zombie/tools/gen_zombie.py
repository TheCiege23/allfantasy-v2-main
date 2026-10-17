"""Zombie league art pack: characters, the turn, weapons, serums, bashings, maulings, Whisperer.
python3 gen_zombie.py <out_dir>  ->  <out_dir>/zombie/...
All text is outlined (no font dependency). Cartoon style, never gory: no blood, goo is green.
"""
import os, sys, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_a import svg, lg, rg
from outline import text as T_, width as W_

INK = '#0b0d08'
LIME, LIME2, GOO = '#9ae03a', '#4f8a1a', '#b8f04a'
VIO, VIO2 = '#a78bfa', '#4c2a8a'

def hx(c): c = c.lstrip('#'); return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
def mix(a, b, t):
    A, B = hx(a), hx(b)
    return '#%02x%02x%02x' % tuple(round(A[i] + (B[i] - A[i]) * t) for i in range(3))

def shadow(cx, cy, rx, ry=None, op=.35):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry or rx * .18}" fill="#000" opacity="{op}"/>'

# ------------------------------------------------------------------ the bust (200x200), stage 0 human .. 3 zombie
def bust(u, stage=0, revived=False):
    t = {0: 0, 1: .08, 2: .55, 3: 1}[stage]
    skin, shade = mix('#eab38a', '#a9c76e', t), mix('#c4835c', '#62853a', t)
    hair = mix('#3a2418', '#2a2a1c', t)
    jacket = mix('#2f6aa8', '#3a4a3a', t)
    d = (rg(f'{u}sk', [(0, mix('#f6c9a2', '#c4e08a', t)), (.7, skin), (1, shade)], '45%', '38%', '70%') +
         lg(f'{u}jk', [(0, mix('#4a8ad0', '#56685a', t)), (1, mix('#1c3a66', '#232c22', t))]) +
         rg(f'{u}gl', [(0, '#d8ff7a'), (1, '#d8ff7a00')]))
    b = ''
    if stage >= 2:
        b += f'<circle cx="100" cy="96" r="96" fill="url(#{u}gl)" opacity="{.25 if stage == 2 else .4}"/>'
    # shoulders + collar
    torn = ' l6,-8 l6,9 l7,-10 l6,8' if stage == 3 else ''
    b += (f'<path d="M22,200 C26,162 64,148 100,148 C136,148 174,162 178,200 Z" fill="url(#{u}jk)" stroke="{INK}" stroke-width="4"/>'
          f'<path d="M70,152 L100,182 L130,152" fill="none" stroke="{INK}" stroke-width="3.5"/>'
          f'<path d="M64,170{torn}" fill="none" stroke="{INK}" stroke-width="2.5" opacity=".6"/>')
    # neck
    b += f'<path d="M84,124 L84,160 C92,168 108,168 116,160 L116,124 Z" fill="{shade}" stroke="{INK}" stroke-width="3.5"/>'
    if stage in (1, 2):   # the bite: torn sleeve at the shoulder showing a bite ring
        b += (f'<path d="M122,156 C132,152 146,156 150,166 C146,176 132,180 122,176 C118,170 118,162 122,156 Z" fill="{skin}" stroke="{INK}" stroke-width="3"/>'
              + ''.join(f'<ellipse cx="{126 + k * 6}" cy="{162 + (1 if k in (1, 2) else 0)}" rx="1.8" ry="2.4" fill="#5a2a2a"/>' for k in range(4))
              + ''.join(f'<ellipse cx="{128 + k * 6}" cy="171" rx="1.6" ry="2.2" fill="#5a2a2a"/>' for k in range(3))
              + f'<ellipse cx="136" cy="166" rx="17" ry="13" fill="none" stroke="{LIME}" stroke-width="2.5" opacity=".85"/>')
    if stage == 2:   # green veins creeping up the neck
        b += f'<path d="M124,158 c-6,-6 -10,-10 -12,-18 M118,164 c-8,-2 -14,-6 -18,-12 M130,154 c0,-8 -2,-12 -6,-16" stroke="#4f8a1a" stroke-width="2" fill="none" opacity=".85"/>'
    # ears
    b += ''.join(f'<ellipse cx="{x}" cy="96" rx="9" ry="13" fill="{shade}" stroke="{INK}" stroke-width="3.5"/>' for x in (55, 145))
    if stage == 3:
        b += f'<path d="M143,84 l8,6 l-5,4 l6,6" fill="none" stroke="{INK}" stroke-width="2.5"/>'
    # head
    b += f'<ellipse cx="100" cy="90" rx="46" ry="52" fill="url(#{u}sk)" stroke="{INK}" stroke-width="4"/>'
    # cheek half-turn split
    if stage == 2:
        b += (f'<path d="M100,38 C122,40 146,62 146,92 C146,122 124,142 100,142 Z" fill="#9cc46a" opacity=".55"/>'
              f'<path d="M100,40 l-4,14 l5,10 l-6,12 l4,14 l-3,16 l5,12 l-4,10 l3,14" fill="none" stroke="#4f8a1a" stroke-width="2" opacity=".8"/>')
    # hair
    if stage == 3:
        b += f'<path d="M56,78 C52,46 76,30 102,32 C128,32 150,48 146,80 L138,64 L132,74 L124,56 L114,70 L106,52 L96,68 L86,54 L78,72 L70,58 L64,76 Z" fill="{hair}" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>'
    else:
        b += f'<path d="M54,84 C48,48 74,30 102,32 C132,32 154,52 146,86 C140,70 130,60 112,58 C96,66 74,66 60,64 C58,70 56,76 54,84 Z" fill="{hair}" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>'
    # headband / bandage
    if revived:
        b += (f'<path d="M55,72 C80,60 122,60 145,72 L144,84 C120,74 80,74 56,84 Z" fill="#f2efe6" stroke="{INK}" stroke-width="3"/>'
              f'<path d="M78,66 l2,14 M96,63 l1,14 M114,63 l0,14 M130,66 l-1,13" stroke="#cfc8b8" stroke-width="2"/>'
              f'<path d="M142,74 l14,-6 l-2,10 l10,4 l-14,4 Z" fill="#f2efe6" stroke="{INK}" stroke-width="2.5"/>')
    elif stage < 3:
        b += (f'<path d="M55,70 C80,58 122,58 145,70 L145,80 C120,70 80,70 55,80 Z" fill="#d83a2e" stroke="{INK}" stroke-width="3"/>'
              f'<path d="M145,74 l16,-8 l-4,12 l12,6 l-16,2 Z" fill="#d83a2e" stroke="{INK}" stroke-width="2.5"/>')
    # eyes
    if stage == 3:
        b += (f'<ellipse cx="80" cy="94" rx="14" ry="12" fill="#2a3a18"/><ellipse cx="120" cy="96" rx="14" ry="11" fill="#2a3a18"/>'
              f'<circle cx="80" cy="94" r="9" fill="#f4ffd8" stroke="{INK}" stroke-width="2.5"/><circle cx="82" cy="95" r="2" fill="{INK}"/>'
              f'<path d="M110,96 C112,90 128,90 130,96 C128,102 112,102 110,96 Z" fill="#f4ffd8" stroke="{INK}" stroke-width="2.5"/><circle cx="118" cy="97" r="1.8" fill="{INK}"/>'
              f'<path d="M66,80 l10,4 M134,84 l-10,2" stroke="{INK}" stroke-width="3.5" stroke-linecap="round"/>')
    else:
        pupil_dy = 1 if stage == 0 else 0
        eye_c = '#fff' if stage < 2 else '#f2ffd8'
        b += ''.join(f'<ellipse cx="{x}" cy="94" rx="9" ry="10" fill="{eye_c}" stroke="{INK}" stroke-width="2.5"/><circle cx="{x + 1}" cy="{95 + pupil_dy}" r="{4.5 if stage < 2 else 3}" fill="{INK if stage < 2 else "#5a8a1a"}"/>'
                     f'<circle cx="{x + 2.5}" cy="{93}" r="1.4" fill="#fff"/>' for x in (82, 118))
        brow = (('M70,80 l20,-2', 'M110,78 l20,2') if stage == 0 else ('M70,78 l20,4', 'M110,82 l20,-4'))
        b += ''.join(f'<path d="{p}" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>' for p in brow)
    # nose
    b += f'<path d="M100,98 C98,106 96,110 100,112 C102,112 104,111 105,110" fill="none" stroke="{INK}" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>'
    # mouth
    if stage == 0:
        b += f'<path d="M86,124 C94,128 106,128 114,122" fill="none" stroke="{INK}" stroke-width="3.5" stroke-linecap="round"/>'
    elif stage == 1:
        b += (f'<path d="M86,126 q7,-6 14,0 t14,0" fill="none" stroke="{INK}" stroke-width="3.5" stroke-linecap="round"/>'
              f'<path d="M140,62 c-3,6 -4,10 0,12 c4,-2 3,-6 0,-12 Z" fill="#8fd8ff" stroke="{INK}" stroke-width="2"/>')
    elif stage == 2:
        b += f'<path d="M84,124 L116,122 L114,130 L86,131 Z" fill="#3a1a12" stroke="{INK}" stroke-width="3"/><path d="M90,124 v5 M98,123.5 v6 M106,123 v6" stroke="#f2ead0" stroke-width="2.5"/>'
    else:
        b += (f'<path d="M80,120 C88,116 112,116 122,122 L118,136 C108,140 92,140 84,134 Z" fill="#2a1410" stroke="{INK}" stroke-width="3.5"/>'
              + ''.join(f'<path d="M{86 + k * 7},{120 - (k % 2)} l3,6 l3,-6" fill="#efe6c8" stroke="{INK}" stroke-width="1.5"/>' for k in range(5))
              + f'<path d="M96,138 c0,6 4,10 2,14 c-2,-2 -4,-6 -2,-14" fill="{GOO}" stroke="{INK}" stroke-width="1.5"/>')
    # zombie stitches + revived veins
    if stage == 3:
        b += f'<path d="M66,60 L92,66" stroke="{INK}" stroke-width="2.5"/>' + ''.join(f'<path d="M{70 + k * 6},{58 + k * 1.4} l2,8" stroke="{INK}" stroke-width="2"/>' for k in range(4))
    if revived:
        b += (f'<path d="M126,108 c6,2 8,8 12,8 M128,114 c4,4 4,8 8,10" stroke="{LIME}" stroke-width="2" fill="none" opacity=".75"/>'
              f'<rect x="88" y="138" width="24" height="10" rx="3" fill="#f2efe6" stroke="{INK}" stroke-width="2" transform="rotate(-8 100 143)"/>'
              f'<path d="M96,140 v6 M104,139 v6" stroke="#cfc8b8" stroke-width="1.5" transform="rotate(-8 100 143)"/>')
    return svg(200, 200, b, {0: 'Survivor', 1: 'Bitten Survivor', 2: 'Turning', 3: 'Zombie'}[stage] if not revived else 'Revived Survivor', d)

def whisperer_bust(u='wh'):
    d = (lg(f'{u}hd', [(0, '#5a3aa8'), (1, '#1a0e36')]) + rg(f'{u}ey', [(0, '#ffffff'), (.35, '#d8c8ff'), (1, '#a78bfa00')]) +
         rg(f'{u}au', [(0, '#a78bfa66'), (1, '#a78bfa00')]))
    b = (f'<circle cx="100" cy="100" r="98" fill="url(#{u}au)"/>'
         f'<path d="M18,200 C22,150 50,128 64,118 C56,90 58,46 100,20 C142,46 144,90 136,118 C150,128 178,150 182,200 Z" fill="url(#{u}hd)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
         f'<path d="M100,24 C70,46 66,86 72,118 C84,130 116,130 128,118 C134,86 130,46 100,24 Z" fill="#06040c" stroke="{INK}" stroke-width="3"/>'
         f'<path d="M78,128 C88,150 112,150 122,128" fill="none" stroke="#3a2a6a" stroke-width="4"/>'
         + ''.join(f'<ellipse cx="{x}" cy="86" rx="16" ry="10" fill="url(#{u}ey)"/><path d="M{x - 8},86 C{x - 4},80 {x + 4},80 {x + 8},86 C{x + 4},90 {x - 4},90 {x - 8},86 Z" fill="#efe8ff"/>' for x in (86, 114))
         + f'<path d="M84,106 l4,6 l4,-6 l4,6 l4,-6 l4,6 l4,-6 l4,6" fill="none" stroke="#8a7ab8" stroke-width="2" opacity=".7"/>'
         f'<path d="M100,150 L100,200" stroke="#2a1a4a" stroke-width="3"/>'
         + ''.join(f'<path d="M{x},{y} c-6,-10 6,-16 0,-28" stroke="{VIO}" stroke-width="2.5" fill="none" opacity=".45" stroke-linecap="round"/>' for x, y in ((30, 150), (172, 140), (44, 112), (160, 104))))
    return svg(200, 200, b, 'Whisperer', d)

# ------------------------------------------------------------------ the turn: split hero
def turn_hero():
    u = 'th'
    parts = []
    for i, st in enumerate((0, 1, 2, 3)):
        s = bust(f'{u}{i}', st)
        inner = s[s.index('<defs>'):s.rindex('</svg>')]
        parts.append(f'<g transform="translate({20 + i * 190},40) scale(.85)">{inner}</g>')
    arrows = ''.join(f'<path d="M{198 + i * 190},140 l14,0 l-6,-7 M{212 + i * 190},140 l-6,7" stroke="{LIME}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' for i in range(3))
    labels = ''.join(T_(t, 105 + i * 190, 236, 'bebas', 22, c, 'middle', 1.5) for i, (t, c) in enumerate((('SURVIVOR', '#9fd0ff'), ('BITTEN', '#ffd28a'), ('TURNING', '#d8f08a'), ('ZOMBIE', LIME))))
    return svg(800, 250, ''.join(parts) + arrows + labels, 'From Survivor to Zombie')

# ------------------------------------------------------------------ weapons (240x300 art, no background)
def weapon(kind):
    u = 'w' + kind[:3]
    d = (lg(f'{u}st', [(0, '#ffffff'), (.45, '#c9d1dc'), (1, '#6c7686')], 1, 1) + lg(f'{u}wd', [(0, '#c48a52'), (.5, '#9a5e2c'), (1, '#5e3416')], 1, 0) +
         rg(f'{u}fx', [(0, '#fff6b0'), (.5, '#ffb43a'), (1, '#ff6a1a00')]))
    b = shadow(120, 272, 70)
    if kind == 'knife':
        b += (f'<g transform="rotate(-38 120 150)"><path d="M110,30 C134,60 138,120 132,170 L106,170 C104,120 102,70 110,30 Z" fill="url(#{u}st)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
              f'<path d="M112,48 C124,80 126,120 124,164" stroke="#fff" stroke-width="3" opacity=".7" fill="none"/>'
              f'<rect x="94" y="168" width="52" height="14" rx="5" fill="#4a525e" stroke="{INK}" stroke-width="4"/>'
              f'<rect x="106" y="182" width="28" height="76" rx="9" fill="url(#{u}wd)" stroke="{INK}" stroke-width="4"/>'
              + ''.join(f'<path d="M106,{194 + k * 14} l28,-6" stroke="#2a2a2a" stroke-width="5" opacity=".65"/>' for k in range(5))
              + f'<path d="M126,120 c4,6 4,12 0,16 c-3,-4 -3,-10 0,-16 Z" fill="{GOO}" stroke="{INK}" stroke-width="2"/></g>')
    elif kind == 'axe':
        b += (f'<g transform="rotate(24 120 150)"><rect x="110" y="40" width="20" height="224" rx="8" fill="url(#{u}wd)" stroke="{INK}" stroke-width="4"/>'
              f'<path d="M126,52 C170,40 196,64 198,104 C176,96 150,98 126,112 Z" fill="url(#{u}st)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
              f'<path d="M186,60 C196,76 198,90 198,104" stroke="#fff" stroke-width="3" fill="none" opacity=".8"/>'
              f'<path d="M112,58 C96,52 86,60 84,74 C94,72 104,76 112,84 Z" fill="#4a525e" stroke="{INK}" stroke-width="3.5"/>'
              f'<rect x="106" y="200" width="28" height="12" rx="3" fill="#2a2a2a" stroke="{INK}" stroke-width="3"/>'
              f'<path d="M160,96 c4,8 2,14 -2,18 c-2,-6 -2,-12 2,-18 Z" fill="{GOO}" stroke="{INK}" stroke-width="2"/></g>')
    elif kind == 'bow':
        b += (f'<path d="M86,30 C150,70 150,230 86,270" fill="none" stroke="{INK}" stroke-width="16" stroke-linecap="round"/>'
              f'<path d="M86,30 C150,70 150,230 86,270" fill="none" stroke="url(#{u}wd)" stroke-width="10" stroke-linecap="round"/>'
              f'<rect x="122" y="130" width="18" height="40" rx="6" fill="#3a2a1a" stroke="{INK}" stroke-width="3"/>'
              f'<path d="M86,30 L104,150 L86,270" fill="none" stroke="#e8e2d0" stroke-width="2.5"/>'
              f'<path d="M104,150 L214,150" stroke="#7a4a22" stroke-width="5"/>'
              f'<path d="M214,140 L234,150 L214,160 Z" fill="url(#{u}st)" stroke="{INK}" stroke-width="3"/>'
              f'<path d="M104,150 l-12,-12 l12,4 Z M104,150 l-12,12 l12,-4 Z" fill="{LIME}" stroke="{INK}" stroke-width="2"/>')
    elif kind == 'gun':
        b += (f'<g transform="rotate(-12 120 150)"><path d="M44,108 L196,108 L196,138 L118,138 L110,150 L78,150 L78,138 L44,138 Z" fill="url(#{u}st)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
              f'<rect x="188" y="100" width="12" height="10" fill="#4a525e" stroke="{INK}" stroke-width="3"/>'
              f'<rect x="96" y="96" width="44" height="54" rx="12" fill="#8a94a4" stroke="{INK}" stroke-width="4"/>'
              + ''.join(f'<circle cx="{108 + k * 10}" cy="123" r="3.5" fill="#4a525e"/>' for k in range(3))
              + f'<path d="M58,138 L48,226 C48,236 58,240 66,240 L98,240 C104,240 106,232 104,224 L96,150 Z" fill="url(#{u}wd)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
              f'<path d="M108,150 C112,170 104,180 92,176" fill="none" stroke="{INK}" stroke-width="4"/>'
              f'<path d="M50,116 L190,116" stroke="#fff" stroke-width="3" opacity=".6"/></g>')
    elif kind == 'bomb':
        b += (f'<circle cx="112" cy="172" r="78" fill="#2a2e36" stroke="{INK}" stroke-width="5"/>'
              f'<ellipse cx="84" cy="140" rx="22" ry="13" fill="#fff" opacity=".22" transform="rotate(-35 84 140)"/>'
              f'<rect x="118" y="80" width="40" height="28" rx="6" fill="#4a525e" stroke="{INK}" stroke-width="4" transform="rotate(30 138 94)"/>'
              f'<path d="M150,82 C162,56 180,56 186,40" fill="none" stroke="#c8a46a" stroke-width="6" stroke-linecap="round"/>'
              f'<circle cx="188" cy="36" r="26" fill="url(#{u}fx)"/>'
              + ''.join(f'<path d="M188,36 l{math.cos(a) * 20:.1f},{math.sin(a) * 20:.1f}" stroke="#fff3a0" stroke-width="3" stroke-linecap="round"/>' for a in [k * math.pi / 4 for k in range(8)])
              + f'<path d="M86,200 l20,-28 l14,22 l18,-14" fill="none" stroke="{LIME}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>')
    return svg(240, 300, b, kind.title(), d)

# ------------------------------------------------------------------ serums
def vial(u, x, y, s=1, rot=0, level=.7):
    h = 120 * s
    return (f'<g transform="translate({x},{y}) rotate({rot}) scale({s})">'
            f'<rect x="-22" y="-58" width="44" height="118" rx="20" fill="url(#{u}gl)" stroke="{INK}" stroke-width="4.5"/>'
            f'<path d="M-18,{60 - 116 * level} L18,{60 - 116 * level} L18,40 C18,52 10,56 0,56 C-10,56 -18,52 -18,40 Z" fill="url(#{u}go)"/>'
            f'<circle cx="-6" cy="{60 - 116 * level + 18}" r="4" fill="#efffc0" opacity=".8"/><circle cx="6" cy="{60 - 116 * level + 34}" r="3" fill="#efffc0" opacity=".7"/>'
            f'<rect x="-28" y="-74" width="56" height="20" rx="5" fill="#4a525e" stroke="{INK}" stroke-width="4"/>'
            f'<rect x="-12" y="-6" width="24" height="24" rx="4" fill="#fff" stroke="{INK}" stroke-width="2.5"/><path d="M0,-2 V14 M-8,6 H8" stroke="#2a8a3a" stroke-width="4"/>'
            f'<path d="M-12,-46 C-14,-20 -14,10 -12,30" stroke="#fff" stroke-width="4" opacity=".55" fill="none" stroke-linecap="round"/></g>')

def serum_defs(u):
    return (lg(f'{u}gl', [(0, '#f0fff6'), (1, '#a8d8bc')], 1, 0) + lg(f'{u}go', [(0, '#e8ff7a'), (1, '#5ec82a')]) +
            rg(f'{u}aura', [(0, '#c8ff6a88'), (1, '#c8ff6a00')]) + lg(f'{u}sh', [(0, '#8ad0ff'), (1, '#1d4f8a')]))

def serum(kind='serum'):
    u = 'sr' + kind[:2]
    d = serum_defs(u)
    b = shadow(120, 274, 66) + f'<circle cx="120" cy="150" r="120" fill="url(#{u}aura)"/>'
    if kind == 'serum':
        b += vial(u, 120, 158, 1.25)
    elif kind == 'shield':
        b += (f'<path d="M120,30 L210,62 L202,150 C196,206 160,244 120,262 C80,244 44,206 38,150 L30,62 Z" fill="url(#{u}sh)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
              f'<path d="M120,48 L194,74 L188,150 C182,196 154,228 120,244 Z" fill="#fff" opacity=".12"/>' + vial(u, 120, 160, .95))
    else:  # revive: three vials + heartbeat
        b += vial(u, 66, 170, .82, -14) + vial(u, 174, 170, .82, 14) + vial(u, 120, 150, .95)
        b += f'<path d="M14,252 L70,252 L84,226 L100,274 L116,236 L128,252 L226,252" fill="none" stroke="{LIME}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>'
    return svg(240, 300, b, {'serum': 'Serum', 'shield': 'Serum shield', 'revive': 'Revive with 3 serums'}[kind], d)

# ------------------------------------------------------------------ bashing + mauling
def stamp(word, x, y, size, color, rot):
    w = W_(word, 'bebas', size, 2) + 30
    return (f'<g transform="rotate({rot} {x} {y})"><rect x="{x - w / 2}" y="{y - size * .62}" width="{w}" height="{size * 1.04}" rx="6" fill="#0b0d08" fill-opacity=".82" stroke="{color}" stroke-width="5"/>'
            f'<rect x="{x - w / 2 + 6}" y="{y - size * .62 + 6}" width="{w - 12}" height="{size * 1.04 - 12}" rx="3" fill="none" stroke="{color}" stroke-width="2"/>'
            + T_(word, x, y + size * .3, 'bebas', size, color, 'middle', 2) + '</g>')

def bash():
    u = 'bs'
    d = (lg(f'{u}wd', [(0, '#d49a5c'), (.5, '#a8682e'), (1, '#6a3a16')], 1, 0) + rg(f'{u}fx', [(0, '#fff8c0'), (.6, '#ffc531'), (1, '#ff8a1a')]))
    burst = ' '.join(f'{150 + math.cos(a) * (70 if k % 2 == 0 else 38):.1f},{110 + math.sin(a) * (70 if k % 2 == 0 else 38):.1f}' for k, a in enumerate([i * math.pi / 8 for i in range(16)]))
    b = (shadow(120, 274, 70) + f'<polygon points="{burst}" fill="url(#{u}fx)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
         f'<g transform="rotate(-42 110 170)"><path d="M98,262 L94,140 C92,96 100,70 112,62 C124,70 132,96 130,140 L126,262 Z" fill="url(#{u}wd)" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>'
         f'<rect x="96" y="232" width="32" height="30" rx="4" fill="#2a2a2a" stroke="{INK}" stroke-width="3"/>'
         + ''.join(f'<path d="M{100 if k % 2 else 124},{80 + k * 16} l{-16 if k % 2 else 16},{-4}" stroke="#d8dee8" stroke-width="5" stroke-linecap="round"/><path d="M{100 if k % 2 else 124},{80 + k * 16} l{-16 if k % 2 else 16},{-4}" stroke="{INK}" stroke-width="1.5" stroke-linecap="round" opacity=".5"/>' for k in range(5))
         + '</g>' + stamp('BASHED', 160, 238, 44, '#ffd23a', -8))
    return svg(240, 300, b, 'Bashing', d)

def maul():
    u = 'ml'
    d = rg(f'{u}bg', [(0, '#3a5a1a'), (1, '#0e1a06')])
    b = (shadow(120, 274, 70) + f'<path d="M30,40 L210,40 L210,210 C210,240 160,262 120,270 C80,262 30,240 30,210 Z" fill="url(#{u}bg)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
         + ''.join(f'<path d="M{70 + k * 34},{56 - k * 4} C{80 + k * 34},{110} {90 + k * 30},{170} {80 + k * 30},{226}" stroke="{INK}" stroke-width="22" fill="none" stroke-linecap="round"/>'
                   f'<path d="M{70 + k * 34},{56 - k * 4} C{80 + k * 34},{110} {90 + k * 30},{170} {80 + k * 30},{226}" stroke="{GOO}" stroke-width="12" fill="none" stroke-linecap="round"/>'
                   f'<path d="M{86 + k * 30},{226} c2,10 6,14 2,20 c-4,-4 -6,-10 -2,-20 Z" fill="{GOO}" stroke="{INK}" stroke-width="2"/>' for k in range(4))
         + stamp('MAULED', 120, 250, 44, '#e8ff9a', -6))
    return svg(240, 300, b, 'Mauling', d)

# ------------------------------------------------------------------ Whisperer full figure + ambush + powers
def whisperer_full():
    u = 'wf'
    d = (lg(f'{u}rb', [(0, '#5a3aa8'), (1, '#140a2a')]) + rg(f'{u}ey', [(0, '#fff'), (.4, '#d8c8ff'), (1, '#a78bfa00')]) + rg(f'{u}au', [(0, '#a78bfa55'), (1, '#a78bfa00')]) +
         rg(f'{u}fgr', [(0, '#9ae03a66'), (1, '#9ae03a00')]))
    hands = ''.join(f'<g transform="translate({x},262) scale({s})"><path d="M-8,20 L-8,-14 C-12,-20 -12,-30 -6,-30 L-4,-20 L-4,-36 C-4,-42 4,-42 4,-36 L4,-22 L6,-34 C6,-40 14,-40 13,-32 L10,-14 L10,20 Z" fill="#9cc46a" stroke="{INK}" stroke-width="3"/></g>' for x, s in ((36, .9), (204, .8), (66, .6), (178, .65)))
    b = (f'<circle cx="120" cy="120" r="118" fill="url(#{u}au)"/>' + shadow(120, 280, 80, 14, .5)
         + f'<path d="M120,20 C160,42 170,90 166,120 C196,160 206,230 214,282 L26,282 C34,230 44,160 74,120 C70,90 80,42 120,20 Z" fill="url(#{u}rb)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
         f'<path d="M120,26 C94,46 88,88 94,118 C106,130 134,130 146,118 C152,88 146,46 120,26 Z" fill="#05030a" stroke="{INK}" stroke-width="3"/>'
         + ''.join(f'<ellipse cx="{x}" cy="84" rx="18" ry="11" fill="url(#{u}ey)"/><path d="M{x - 8},84 C{x - 4},78 {x + 4},78 {x + 8},84 C{x + 4},88 {x - 4},88 {x - 8},84 Z" fill="#f2ecff"/>' for x in (106, 134))
         + f'<path d="M120,130 L120,282 M84,180 C100,200 140,200 156,180" stroke="#2a1a4a" stroke-width="4" fill="none"/>'
         f'<path d="M74,150 C56,170 52,196 60,214 C70,208 78,200 82,186" fill="#3a2478" stroke="{INK}" stroke-width="4"/>'
         f'<path d="M166,150 C190,160 206,170 214,152 C206,148 196,146 186,140" fill="#3a2478" stroke="{INK}" stroke-width="4"/>'
         f'<path d="M208,150 c6,-6 10,-12 10,-20 M214,152 c8,-4 14,-8 18,-16 M212,156 c8,0 14,-2 20,-8" stroke="#9cc46a" stroke-width="4" stroke-linecap="round" fill="none"/>'
         + ''.join(f'<path d="M{x},{y} c-8,-12 8,-20 0,-34" stroke="{VIO}" stroke-width="3" fill="none" opacity=".5" stroke-linecap="round"/>' for x, y in ((24, 150), (222, 110), (40, 90), (200, 60)))
         + f'<ellipse cx="120" cy="268" rx="124" ry="34" fill="url(#{u}fgr)"/>' + hands)
    return svg(240, 300, b, 'The Whisperer', d)

def ambush():
    u = 'am'
    d = rg(f'{u}ey', [(0, '#fff'), (.4, '#d8c8ff'), (1, '#a78bfa00')]) + lg(f'{u}bu', [(0, '#1a3a12'), (1, '#071206')])
    bush = ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#{u}bu)" stroke="{INK}" stroke-width="4"/>' for x, y, r in ((50, 200, 56), (120, 180, 70), (192, 204, 54), (90, 236, 50), (160, 240, 50)))
    b = (shadow(120, 280, 96) + bush
         + ''.join(f'<ellipse cx="{x}" cy="{y}" rx="16" ry="9" fill="url(#{u}ey)"/><path d="M{x - 6},{y} C{x - 3},{y - 4} {x + 3},{y - 4} {x + 6},{y} C{x + 3},{y + 3} {x - 3},{y + 3} {x - 6},{y} Z" fill="#f2ecff"/>' for x, y in ((106, 176), (134, 176), (50, 206), (70, 206)))
         + f'<path d="M160,190 C176,150 196,120 214,96 L224,104 C210,128 192,158 178,196 Z" fill="#9cc46a" stroke="{INK}" stroke-width="4"/>'
         f'<path d="M214,96 l-4,-22 M220,98 l4,-22 M224,104 l14,-14 M210,92 l-14,-10" stroke="#9cc46a" stroke-width="7" stroke-linecap="round"/>'
         f'<path d="M214,96 l-4,-22 M220,98 l4,-22 M224,104 l14,-14 M210,92 l-14,-10" stroke="{INK}" stroke-width="2" stroke-linecap="round" opacity=".5"/>'
         + stamp('AMBUSH', 120, 70, 40, '#c4b5fd', -6))
    return svg(240, 300, b, 'Ambush', d)

def power(kind):
    u = 'pw' + kind[:3]
    d = rg(f'{u}g', [(0, '#c4b5fd'), (1, '#4c2a8a')]) + rg(f'{u}f', [(0, '#fff6b0'), (.6, '#ff8a1a'), (1, '#c42a0a')])
    b = f'<circle cx="64" cy="64" r="60" fill="#140a2a" stroke="{VIO}" stroke-width="4"/>'
    if kind == 'horde':
        b += (f'<path d="M24,84 C40,86 70,70 92,40 L104,48 C88,82 62,100 30,100 Z" fill="#e8dcc0" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
              f'<ellipse cx="98" cy="44" rx="10" ry="14" fill="#c8b890" stroke="{INK}" stroke-width="3.5" transform="rotate(30 98 44)"/>'
              + ''.join(f'<path d="M{52 + k * 14},{82 - k * 10} l4,10" stroke="#8a7a5a" stroke-width="3"/>' for k in range(3))
              + f'<path d="M100,72 q8,6 0,14 M108,66 q12,10 0,24" stroke="{LIME}" stroke-width="3.5" fill="none" stroke-linecap="round"/>')
    elif kind == 'whisper':
        b += (f'<path d="M30,66 C40,50 58,50 64,58 C70,50 88,50 98,66 C88,82 40,82 30,66 Z" fill="#7a3aa8" stroke="{INK}" stroke-width="4"/>'
              f'<path d="M36,66 C50,70 78,70 92,66" stroke="{INK}" stroke-width="3"/>'
              + ''.join(f'<path d="M{102 + k * 6},{50 - k * 6} q{8 + k * 4},{16 + k * 6} 0,{32 + k * 12}" stroke="{VIO}" stroke-width="3.5" fill="none" stroke-linecap="round" opacity="{1 - k * .25}"/>' for k in range(3)))
    elif kind == 'override':
        b += (f'<path d="M64,16 L102,30 L98,66 C96,90 82,106 64,114 C46,106 32,90 30,66 L26,30 Z" fill="#2a5a1a" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
              f'<path d="M64,18 L58,48 L70,60 L56,84 L66,112" stroke="{INK}" stroke-width="4" fill="none"/>'
              + ''.join(f'<circle cx="{64 + math.cos(a) * 16:.1f}" cy="{64 + math.sin(a) * 16:.1f}" r="11" fill="none" stroke="{GOO}" stroke-width="4"/>' for a in (-math.pi / 2, math.pi / 6, 5 * math.pi / 6))
              + f'<circle cx="64" cy="64" r="6" fill="{GOO}" stroke="{INK}" stroke-width="2"/>')
    else:  # burn
        for k, x in enumerate((44, 64, 84)):
            b += (f'<rect x="{x - 8}" y="54" width="16" height="44" rx="7" fill="#d8f0e0" stroke="{INK}" stroke-width="3"/><rect x="{x - 6}" y="74" width="12" height="22" rx="5" fill="{LIME}"/>'
                  f'<path d="M{x},28 C{x + 8},40 {x + 10},48 {x + 4},56 C{x + 2},50 {x - 2},50 {x - 4},56 C{x - 10},48 {x - 8},40 {x},28 Z" fill="url(#{u}f)" stroke="{INK}" stroke-width="2.5"/>')
        b += f'<path d="M28,104 H100" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>'
    return svg(128, 128, b, {'horde': 'Horde command', 'whisper': 'Dark whisper', 'override': 'Infection override', 'burn': 'Mass serum burn'}[kind], d)

# ------------------------------------------------------------------ small icons for status chips
def status_icon(kind):
    u = 'si' + kind[:3]
    s = {'survivor': bust(u, 0), 'zombie': bust(u, 3), 'revived': bust(u, 0, revived=True), 'whisperer': whisperer_bust(u)}[kind]
    return s.replace('viewBox="0 0 200 200" width="200" height="200"', 'viewBox="0 0 200 200" width="64" height="64"')

def all_files():
    f = {'char-survivor.svg': bust('cs', 0), 'char-bitten.svg': bust('cb', 1), 'char-turning.svg': bust('ct', 2), 'char-zombie.svg': bust('cz', 3),
         'char-revived.svg': bust('cr', 0, revived=True), 'char-whisperer.svg': whisperer_bust('cw'), 'turn.svg': turn_hero(),
         'whisperer.svg': whisperer_full(), 'ambush.svg': ambush(), 'bash.svg': bash(), 'maul.svg': maul(),
         'serum.svg': serum('serum'), 'serum-shield.svg': serum('shield'), 'serum-revive.svg': serum('revive')}
    for k in ('knife', 'axe', 'bow', 'gun', 'bomb'):
        f[f'weapon-{k}.svg'] = weapon(k)
    for k in ('horde', 'whisper', 'override', 'burn'):
        f[f'power-{k}.svg'] = power(k)
    for k in ('survivor', 'zombie', 'revived', 'whisperer'):
        f[f'status-{k}.svg'] = status_icon(k)
    return f

if __name__ == '__main__':
    base = os.path.join(sys.argv[1], 'zombie'); os.makedirs(base, exist_ok=True)
    fs = all_files()
    for p, s in fs.items():
        open(os.path.join(base, p), 'w').write(s)
    print('wrote', len(fs))
