"""Zombie league backgrounds: the 10 themes in lib/zombie/zombieBackgroundThemes.ts, 1600x600.
python3 gen_zbg.py <out_dir> -> <out_dir>/zombie/bg/<theme-id>.svg
The focal art sits right of centre so the league title can sit on the left over a dark gradient.
"""
import os, sys, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_a import svg, lg, rg
from outline import text as T_, width as W_

W, H = 1600, 600

def sky(u, stops):
    return lg(f'{u}sky', stops), f'<rect width="{W}" height="{H}" fill="url(#{u}sky)"/>'

def glow(u, cx, cy, r, col, op=.6):
    return rg(f'{u}g{cx}', [(0, col), (1, col + '00')]), f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#{u}g{cx})" opacity="{op}"/>'

def specks(seed, n, col, y0=0, y1=H, rmax=1.6, op=.7):
    r = random.Random(seed)
    return ''.join(f'<circle cx="{r.uniform(0, W):.0f}" cy="{r.uniform(y0, y1):.0f}" r="{r.uniform(.4, rmax):.1f}" fill="{col}" opacity="{r.uniform(.2, op):.2f}"/>' for _ in range(n))

def hills(y, amp, col, seed, step=80):
    r = random.Random(seed)
    pts = [(x, y - r.uniform(0, amp)) for x in range(-80, W + 160, step)]
    d = f'M-80,{H} ' + ' '.join(f'L{x},{yy:.0f}' for x, yy in pts) + f' L{W + 80},{H} Z'
    return f'<path d="{d}" fill="{col}"/>'

def zfig(x, y, s, col, eye='#c8ff6a', flip=False):
    f = -1 if flip else 1
    return (f'<g transform="translate({x},{y}) scale({s * f},{s})">'
            f'<path d="M-12,0 L-10,-52 C-16,-56 -18,-62 -14,-66 L-30,-62 C-40,-60 -46,-64 -48,-70 L-46,-74 C-34,-70 -24,-74 -14,-78 L-12,-86 C-20,-92 -20,-108 -6,-110 C8,-110 10,-96 4,-88 L8,-80 C20,-78 32,-80 44,-86 L46,-80 C36,-72 24,-68 12,-66 C14,-58 12,-52 10,-48 L14,0 L4,0 L0,-34 L-4,0 Z" fill="{col}"/>'
            f'<circle cx="-4" cy="-100" r="2" fill="{eye}"/><circle cx="3" cy="-100" r="2" fill="{eye}"/></g>')

def horde(seed, y, col, eye, n=9, x0=780, x1=1560, s0=.8, s1=1.2):
    r = random.Random(seed)
    return ''.join(zfig(r.uniform(x0, x1), y + r.uniform(-6, 10), r.uniform(s0, s1), col, eye, r.random() < .4) for _ in range(n))

def tomb(x, y, s, col, edge):
    return (f'<g transform="translate({x},{y}) scale({s})"><path d="M-22,0 L-22,-46 C-22,-70 22,-70 22,-46 L22,0 Z" fill="{col}" stroke="{edge}" stroke-width="2"/>'
            f'<path d="M-10,-44 H10 M-10,-34 H6" stroke="{edge}" stroke-width="2.5" opacity=".7"/></g>')

def cross(x, y, s, col):
    return f'<g transform="translate({x},{y}) scale({s}) rotate(-4)"><rect x="-4" y="-70" width="8" height="70" fill="{col}"/><rect x="-20" y="-56" width="40" height="8" fill="{col}"/></g>'

def dead_tree(x, y, s, col, seed):
    r = random.Random(seed)
    def br(x0, y0, a, l, w, d):
        if d == 0 or l < 6: return ''
        x1, y1 = x0 + math.cos(a) * l, y0 + math.sin(a) * l
        out = f'<path d="M{x0:.0f},{y0:.0f} L{x1:.0f},{y1:.0f}" stroke="{col}" stroke-width="{w:.1f}" stroke-linecap="round"/>'
        for k in range(2):
            out += br(x1, y1, a + r.uniform(-.7, .7), l * r.uniform(.6, .78), w * .65, d - 1)
        return out
    return f'<g transform="translate({x},{y}) scale({s})">' + br(0, 0, -math.pi / 2, 90, 16, 6) + '</g>'

def pine(x, y, s, col):
    return f'<g transform="translate({x},{y}) scale({s})"><path d="M0,-160 L-22,-110 L-12,-112 L-34,-70 L-18,-72 L-46,-24 L-6,-26 L-6,0 L6,0 L6,-26 L46,-24 L18,-72 L34,-70 L12,-112 L22,-110 Z" fill="{col}"/></g>'

def building(x, y, w, h, col, win, seed, lit=.25, broken=.1, rows=None):
    r = random.Random(seed)
    out = f'<rect x="{x}" y="{y - h}" width="{w}" height="{h}" fill="{col}"/>'
    cols = max(1, int(w // 26)); rws = rows or max(1, int(h // 34))
    for i in range(cols):
        for j in range(rws):
            wx, wy = x + 8 + i * (w - 16) / cols, y - h + 12 + j * (h - 24) / rws
            q = r.random()
            c = win if q < lit else ('#000' if q < lit + broken else col)
            op = .9 if q < lit else (.6 if q < lit + broken else 0)
            if op: out += f'<rect x="{wx:.0f}" y="{wy:.0f}" width="12" height="16" fill="{c}" opacity="{op}"/>'
    return out

def fence(x0, x1, y, h, col, gap=18):
    bars = ''.join(f'<rect x="{x}" y="{y - h}" width="3" height="{h}" fill="{col}"/><path d="M{x - 3},{y - h} L{x + 1.5},{y - h - 10} L{x + 6},{y - h} Z" fill="{col}"/>' for x in range(x0, x1, gap))
    return bars + f'<rect x="{x0}" y="{y - h + 10}" width="{x1 - x0}" height="3" fill="{col}"/><rect x="{x0}" y="{y - 14}" width="{x1 - x0}" height="3" fill="{col}"/>'

def fog(u, y, col, op=.55):
    return lg(f'{u}fog', [(0, col + '00'), (1, col)]), f'<rect x="0" y="{y}" width="{W}" height="{H - y}" fill="url(#{u}fog)" opacity="{op}"/>'

def moon(cx, cy, r, col, crater):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{col}"/>'
            f'<circle cx="{cx - r * .3}" cy="{cy - r * .2}" r="{r * .16}" fill="{crater}" opacity=".5"/><circle cx="{cx + r * .25}" cy="{cy + r * .25}" r="{r * .22}" fill="{crater}" opacity=".4"/>')

def scene(tid):
    u = tid[:4]
    D, B = '', ''
    def add(pair):
        nonlocal D, B
        D += pair[0]; B += pair[1]
    if tid == 'graveyard-dawn':
        add(sky(u, [(0, '#120a24'), (.55, '#3a1438'), (.85, '#a83a52'), (1, '#e8806a')]))
        add(glow(u, 1150, 470, 340, '#ffb070', .7)); B += f'<circle cx="1150" cy="470" r="70" fill="#ffd8a0"/>'
        B += specks(1, 70, '#ffe0f0', 0, 260)
        B += hills(470, 40, '#2a0e22', 3) + hills(520, 30, '#1a0814', 4)
        B += dead_tree(1360, 520, 1.6, '#12060e', 7) + dead_tree(820, 530, .9, '#12060e', 9)
        r = random.Random(5)
        for k in range(16):
            x = 640 + k * 62 + r.uniform(-14, 14); y = 545 + r.uniform(-12, 10)
            B += (cross(x, y, r.uniform(.7, 1), '#0e0410') if k % 3 == 0 else tomb(x, y, r.uniform(.8, 1.2), '#1e0c1a', '#3a1a30'))
        B += fence(560, 1600, 590, 70, '#0a0208', 22)
        B += horde(11, 600, '#0a0208', '#c8ff6a', 7, 900, 1500)
        add(fog(u, 420, '#c86a8a', .45))
    elif tid == 'abandoned-hospital':
        add(sky(u, [(0, '#030805'), (.6, '#0c2014'), (1, '#24402a')]))
        add(glow(u, 1380, 120, 200, '#c8ff9a', .45)); B += moon(1380, 120, 46, '#e4f4d0', '#a8b89a')
        B += specks(2, 60, '#d8ffd0', 0, 300)
        B += building(560, 560, 160, 210, '#0e1a12', '#9ae08a', 21, .12) + building(1420, 560, 180, 260, '#0e1a12', '#9ae08a', 22, .1)
        B += building(760, 560, 620, 360, '#132a1c', '#b8f070', 23, .2, .18)
        B += (f'<rect x="1020" y="160" width="120" height="44" rx="6" fill="#0a140c" stroke="#ff3a3a" stroke-width="3" opacity=".9"/>'
              f'<path d="M1080,168 V196 M1066,182 H1094" stroke="#ff4a4a" stroke-width="8"/><path d="M1094,182 l14,6" stroke="#ff4a4a" stroke-width="3" opacity=".4"/>'
              + '<rect x="960" y="212" width="240" height="40" fill="#132a1c"/>' + T_('HOSPITAL', 1080, 243, 'bebas', 30, '#7a9a7a', 'middle', 6, .7))
        B += f'<rect x="1000" y="470" width="160" height="90" fill="#08100a"/><rect x="1010" y="480" width="64" height="80" fill="#1a2e1e"/><rect x="1086" y="480" width="64" height="80" fill="#1a2e1e"/>'
        B += (f'<g transform="translate(640,560)"><rect x="0" y="-70" width="150" height="56" rx="6" fill="#0a120c"/><rect x="110" y="-96" width="40" height="30" rx="4" fill="#0a120c"/>'
              f'<circle cx="30" cy="-12" r="14" fill="#050805"/><circle cx="120" cy="-12" r="14" fill="#050805"/><rect x="40" y="-60" width="22" height="22" fill="#ff3a3a" opacity=".5"/></g>')
        B += f'<rect x="0" y="555" width="{W}" height="45" fill="#050a06"/>' + horde(12, 590, '#040805', '#c8ff6a', 9, 700, 1560)
        add(fog(u, 430, '#7ad08a', .4))
    elif tid == 'infested-city':
        add(sky(u, [(0, '#080402'), (.5, '#2a0e06'), (.85, '#8a2e10'), (1, '#e0601a')]))
        add(glow(u, 1100, 600, 520, '#ff7a1a', .55))
        B += specks(3, 120, '#ffb060', 200, 600, 2.2, .9)
        r = random.Random(30); x = 520
        while x < W:
            w = r.randint(50, 110); h = r.randint(160, 340)
            B += building(x, 560, w, h, '#1a0a06', '#ff9a3a', r.randint(0, 999), .14, .2); x += w + r.randint(4, 18)
        r = random.Random(31); x = 600
        while x < W:
            w = r.randint(70, 140); h = r.randint(90, 220)
            B += building(x, 580, w, h, '#0c0503', '#ffb050', r.randint(0, 999), .08, .25); x += w + r.randint(10, 40)
        B += ''.join(f'<path d="M{x},{y} C{x - 40},{y - 120} {x + 60},{y - 200} {x + 10},{y - 340}" stroke="#3a2a22" stroke-width="{w}" fill="none" opacity=".55" stroke-linecap="round"/>' for x, y, w in ((900, 420, 60), (1300, 400, 80), (1120, 460, 40)))
        B += f'<g transform="translate(1180,590) rotate(-8)"><rect x="-80" y="-40" width="160" height="34" rx="8" fill="#060302"/><rect x="-50" y="-66" width="90" height="30" rx="8" fill="#060302"/><circle cx="-50" cy="-4" r="14" fill="#000"/><circle cx="50" cy="-4" r="14" fill="#000"/></g>'
        B += horde(13, 598, '#050201', '#ffd27a', 10, 760, 1560)
        add(fog(u, 440, '#ff8a3a', .35))
    elif tid == 'dark-forest':
        add(sky(u, [(0, '#010604'), (.6, '#06221a'), (1, '#0c4030')]))
        add(glow(u, 1240, 150, 240, '#a8ffd8', .4)); B += moon(1240, 150, 54, '#dcfff0', '#9ac8b0')
        B += specks(4, 50, '#d8fff0', 0, 250)
        r = random.Random(40)
        for layer, (col, s0, yb) in enumerate((('#0a2a20', .9, 470), ('#061c14', 1.3, 520), ('#020c08', 1.9, 600))):
            x = 480 + layer * 20
            while x < W + 60:
                B += pine(x, yb + r.uniform(-10, 10), s0 * r.uniform(.8, 1.2), col); x += r.uniform(40, 80) * s0
        B += dead_tree(1460, 600, 2.0, '#010604', 41)
        for x, y in ((980, 470), (1110, 500), (1330, 450), (860, 520)):
            B += f'<circle cx="{x}" cy="{y}" r="3" fill="#c8ff6a"/><circle cx="{x + 10}" cy="{y}" r="3" fill="#c8ff6a"/>'
        add(fog(u, 380, '#2ad09a', .45))
        B += horde(14, 600, '#010402', '#c8ff6a', 6, 820, 1500, .9, 1.3)
    elif tid == 'underground-bunker':
        add(sky(u, [(0, '#04070a'), (.6, '#122028'), (1, '#24404c')]))
        for x, a in ((900, -24), (1380, 18)):
            B += f'<path d="M{x},540 L{x + math.tan(math.radians(a)) * 540 - 70:.0f},0 L{x + math.tan(math.radians(a)) * 540 + 70:.0f},0 Z" fill="#9af4ff" opacity=".08"/>'
        B += specks(5, 60, '#d0f6ff', 0, 280)
        B += hills(470, 30, '#0e1a20', 50, 120)
        B += (f'<path d="M760,560 C780,360 1340,360 1360,560 Z" fill="#2a3640" stroke="#0a1014" stroke-width="6"/>'
              f'<path d="M800,560 C820,410 1300,410 1320,560" fill="none" stroke="#3a4852" stroke-width="10"/>'
              f'<rect x="980" y="430" width="160" height="130" rx="10" fill="#0e161c" stroke="#0a1014" stroke-width="5"/>'
              f'<rect x="996" y="446" width="128" height="114" rx="6" fill="#1a262e"/>'
              f'<circle cx="1060" cy="500" r="34" fill="none" stroke="#06b6d4" stroke-width="6" opacity=".9"/><path d="M1060,466 V534 M1026,500 H1094" stroke="#06b6d4" stroke-width="4" opacity=".7"/>'
              f'<rect x="1000" y="556" width="120" height="6" fill="#06b6d4" opacity=".7"/>'
              + ''.join(f'<path d="M{1000 + k * 30},560 l15,-20 l15,20" fill="#ffd23a" opacity=".55"/>' for k in range(4))
              + T_('BUNKER 7', 1060, 418, 'bebas', 26, '#7a9aa8', 'middle', 4, .8))
        B += ''.join(f'<ellipse cx="{x}" cy="{560 - k * 14}" rx="26" ry="10" fill="#3a3a2a" stroke="#1a1a10" stroke-width="2"/>' for x in (760, 812, 1308, 1360) for k in range(3))
        B += ''.join(f'<rect x="{x}" y="470" width="5" height="120" fill="#0a1014"/>' for x in range(560, W, 90)) + ''.join(f'<path d="M560,{y} ' + ' '.join(f'l15,{(-1) ** k * 6}' for k in range(70)) + '" stroke="#5a6a72" stroke-width="2" fill="none"/>' for y in (490, 520, 552))
        B += horde(15, 600, '#030608', '#9af4ff', 8, 600, 1560)
        add(fog(u, 450, '#5ac8e0', .35))
    elif tid == 'decrepit-mansion':
        add(sky(u, [(0, '#0a0214'), (.55, '#280a34'), (1, '#5e1440')]))
        add(glow(u, 1300, 170, 300, '#f0a8ff', .5)); B += moon(1300, 170, 92, '#f6e0ff', '#c8a0d8')
        B += specks(6, 70, '#f6e0ff', 0, 260)
        B += hills(500, 20, '#1a0620', 60)
        m = '#12041a'
        B += (f'<rect x="860" y="300" width="420" height="260" fill="{m}"/><path d="M840,300 L1070,180 L1300,300 Z" fill="{m}"/>'
              f'<rect x="800" y="220" width="80" height="340" fill="{m}"/><path d="M790,220 L840,120 L890,220 Z" fill="{m}"/>'
              f'<rect x="1250" y="250" width="70" height="310" fill="{m}"/><path d="M1240,250 L1285,160 L1330,250 Z" fill="{m}"/>'
              f'<rect x="1040" y="140" width="16" height="50" fill="{m}"/>'
              + ''.join(f'<path d="M{x},{y} v-26 a12,12 0 0 1 24,0 v26 Z" fill="#e070ff" opacity="{o}"/>' for x, y, o in ((900, 360, .8), (960, 360, .2), (1020, 360, .7), (1100, 360, .15), (1160, 360, .85), (1220, 360, .3), (900, 450, .2), (960, 450, .75), (1160, 450, .6), (828, 300, .9), (1274, 320, .5)))
              + f'<rect x="1040" y="460" width="60" height="100" rx="30" fill="#05010a"/>')
        B += dead_tree(720, 590, 1.4, '#08010e', 61) + dead_tree(1480, 590, 1.6, '#08010e', 62)
        B += ''.join(f'<path d="M{x},{y} q8,-8 16,0 q8,-8 16,0 q-8,2 -16,8 q-8,-6 -16,-8 Z" fill="#08010e"/>' for x, y in ((1180, 120), (1240, 90), (1380, 110), (1120, 150)))
        B += fence(600, W, 595, 80, '#06010a', 20) + horde(16, 600, '#06010a', '#f0a8ff', 6, 860, 1500)
        add(fog(u, 440, '#c040a0', .35))
    elif tid == 'wasteland-arena':
        add(sky(u, [(0, '#1a0c02'), (.5, '#5a2c06'), (.85, '#c8781a'), (1, '#f0b040')]))
        add(glow(u, 1120, 330, 300, '#fff0a0', .5)); B += f'<circle cx="1120" cy="330" r="62" fill="#ffe8a0" opacity=".85"/>'
        B += specks(7, 160, '#ffd890', 150, 600, 1.4, .6)
        B += f'<path d="M520,470 L560,380 L640,370 L680,470 Z M1380,470 L1420,360 L1500,350 L1540,410 L1560,470 Z" fill="#3a1e08"/>'
        B += (f'<path d="M760,520 C760,400 1440,400 1440,520 Z" fill="#2a1406"/>'
              + ''.join(f'<path d="M{790 + k * 54},{510 - abs(k - 6) * 3} v-{70 - abs(k - 6) * 6} a14,14 0 0 1 28,0 v{70 - abs(k - 6) * 6} Z" fill="#a8601a" opacity=".35"/>' for k in range(12) if k not in (4, 9))
              + f'<path d="M1180,420 l20,30 l-16,10 l24,40" stroke="#1a0a02" stroke-width="10" fill="none"/>'
              + ''.join(f'<g transform="translate({x},520)"><rect x="-4" y="-180" width="8" height="180" fill="#1a0a02"/><rect x="-26" y="-196" width="52" height="22" fill="#1a0a02"/>'
                        + ''.join(f'<circle cx="{-16 + i * 11}" cy="-185" r="4" fill="#ffe08a" opacity="{.9 if (i + x) % 3 else .15}"/>' for i in range(4)) + '</g>' for x in (800, 1400))
              + f'<path d="M1404,342 l40,40" stroke="#1a0a02" stroke-width="8"/>')
        B += hills(560, 20, '#1a0a02', 70) + horde(17, 600, '#120600', '#ffe08a', 9, 760, 1560)
        add(fog(u, 420, '#f0a040', .4))
    elif tid == 'plague-laboratory':
        add(sky(u, [(0, '#030702'), (.6, '#142406'), (1, '#2e4a0c')]))
        add(glow(u, 1100, 380, 360, '#b8ff3a', .35))
        B += specks(8, 90, '#d8ff8a', 100, 600, 1.8, .7)
        B += building(560, 560, 200, 220, '#0c1606', '#b8ff3a', 81, .15)
        B += (f'<rect x="800" y="250" width="560" height="310" fill="#152408"/><path d="M800,250 L1080,180 L1360,250 Z" fill="#101c06"/>'
              f'<path d="M940,250 C940,150 1220,150 1220,250 Z" fill="#1c3008" stroke="#0a1404" stroke-width="5"/>'
              f'<rect x="1300" y="120" width="40" height="140" fill="#0c1606"/>'
              + ''.join(f'<path d="M{1320 + k * 10},{110 - k * 40} c-30,-20 30,-30 0,-60" stroke="#9ae03a" stroke-width="{26 - k * 6}" fill="none" opacity=".25" stroke-linecap="round"/>' for k in range(3))
              + ''.join(f'<g transform="translate({x},560)"><rect x="-38" y="-170" width="76" height="170" rx="30" fill="#0a1404" stroke="#3a5a12" stroke-width="4"/><rect x="-28" y="-130" width="56" height="120" rx="22" fill="#9ae03a" opacity=".75"/>'
                        f'<circle cx="-8" cy="-90" r="5" fill="#efffb0" opacity=".8"/><circle cx="10" cy="-60" r="4" fill="#efffb0" opacity=".7"/></g>' for x in (900, 1010, 1120, 1230))
              + f'<path d="M860,300 H1300 M900,300 V390 M1240,300 V390" stroke="#3a5a12" stroke-width="10" fill="none"/>')
        hz = ''.join(f'<circle cx="{1080 + math.cos(a) * 14:.1f}" cy="{212 + math.sin(a) * 14:.1f}" r="11" fill="none" stroke="#e8ff7a" stroke-width="4"/>' for a in (-math.pi / 2, math.pi / 6, 5 * math.pi / 6))
        B += f'<circle cx="1080" cy="212" r="32" fill="#0a1404" stroke="#e8ff7a" stroke-width="3"/>' + hz + '<circle cx="1080" cy="212" r="5" fill="#e8ff7a"/>'
        B += f'<rect x="0" y="555" width="{W}" height="45" fill="#050a02"/>' + horde(18, 595, '#030602', '#e8ff7a', 8, 640, 1560)
        add(fog(u, 440, '#9ae03a', .4))
    elif tid == 'tomb-chamber':
        add(sky(u, [(0, '#0a0602'), (.6, '#1e1406'), (1, '#2e1e0a')]))
        st = '#2a1c0c'
        B += ''.join(f'<rect x="{x}" y="{y}" width="{w}" height="40" fill="none" stroke="#3a2a14" stroke-width="2" opacity=".5"/>' for y in range(0, 600, 40) for x, w in [(xx + (40 if (y // 40) % 2 else 0), 80) for xx in range(-40, 1600, 80)])
        for x in (720, 1020, 1320):
            B += (f'<path d="M{x - 120},600 V260 A150,150 0 0 1 {x + 180},260 V600" fill="#0e0802" opacity=".85"/>'
                  f'<rect x="{x - 150}" y="140" width="44" height="460" fill="{st}"/><rect x="{x - 160}" y="140" width="64" height="24" fill="#3a2810"/>')
        add(glow(u, 870, 260, 160, '#ffb43a', .7)); add(glow(u, 1470, 260, 160, '#ffb43a', .7))
        B += ''.join(f'<g transform="translate({x},300)"><rect x="-6" y="0" width="12" height="40" fill="#5a3a14"/><path d="M0,-40 C14,-20 14,-6 0,0 C-14,-6 -14,-20 0,-40 Z" fill="#ffb43a"/><path d="M0,-26 C6,-16 6,-8 0,-4 C-6,-8 -6,-16 0,-26 Z" fill="#fff0a0"/></g>' for x in (870, 1470))
        B += (f'<g transform="translate(1170,560)"><path d="M-170,0 L-150,-110 L150,-110 L170,0 Z" fill="#3a2810" stroke="#1a1006" stroke-width="5"/>'
              f'<path d="M-160,-110 L-140,-150 L170,-138 L156,-104 Z" fill="#4a3418" stroke="#1a1006" stroke-width="5" transform="rotate(-6 0 -120)"/>'
              f'<path d="M-120,-60 H120 M-110,-30 H110" stroke="#1a1006" stroke-width="3" opacity=".6"/>'
              f'<path d="M-40,-130 L-46,-170 C-48,-180 -40,-182 -38,-176 L-36,-186 C-36,-194 -28,-194 -28,-186 L-26,-176 C-24,-184 -16,-182 -18,-172 L-24,-130 Z" fill="#9cc46a" stroke="#0b0d08" stroke-width="3"/></g>')
        B += specks(9, 120, '#ffd890', 0, 600, 1.4, .5) + horde(19, 600, '#060300', '#ffd27a', 5, 700, 1100, .9, 1.1)
        add(fog(u, 470, '#ffb43a', .25))
    elif tid == 'quarantine-zone':
        add(sky(u, [(0, '#0e0208'), (.55, '#34081e'), (.9, '#8a1a4a'), (1, '#c8306a')]))
        add(glow(u, 1100, 520, 420, '#ff4a8a', .45))
        r = random.Random(90); x = 500
        while x < W:
            w = r.randint(50, 120); h = r.randint(100, 230)
            B += building(x, 520, w, h, '#22061a', '#ff8ab8', r.randint(0, 999), .06, .25); x += w + r.randint(4, 20)
        B += (f'<g transform="translate(1260,120) rotate(-6)"><ellipse cx="0" cy="0" rx="60" ry="22" fill="#0a0206"/><rect x="40" y="-6" width="90" height="10" fill="#0a0206"/><path d="M-90,-30 H90" stroke="#0a0206" stroke-width="4"/><rect x="-6" y="-30" width="12" height="10" fill="#0a0206"/></g>'
              f'<path d="M1250,140 L1060,520 L1230,520 Z" fill="#ffd0e8" opacity=".12"/>')
        B += horde(20, 560, '#14020c', '#ff8ab8', 12, 640, 1560, .7, 1.0)
        B += (f'<rect x="0" y="380" width="{W}" height="220" fill="url(#{u}chain)" opacity=".85"/>'
              + ''.join(f'<rect x="{x}" y="370" width="10" height="230" fill="#1a0a12"/>' for x in range(560, W, 200)) + f'<rect x="540" y="372" width="{W - 540}" height="8" fill="#1a0a12"/>')
        D += f'<pattern id="{u}chain" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="22" height="22" fill="none"/><path d="M0,0 H22 M0,0 V22" stroke="#6a5a62" stroke-width="2"/></pattern>'
        B += ''.join(f'<g transform="translate(0,{y}) rotate({a} 1060 0)"><rect x="520" y="-14" width="1100" height="28" fill="#ffd21a"/>' + ''.join(f'<path d="M{520 + k * 44},-14 l22,0 l-22,28 l-22,0 Z" fill="#0e0208"/>' for k in range(26)) + '</g>' for y, a in ((448, -2), (520, 1.5)))
        B += (f'<g transform="translate(1000,410) rotate(-3)"><rect x="-120" y="-40" width="240" height="70" rx="6" fill="#f2efe6" stroke="#0e0208" stroke-width="5"/>'
              + T_('QUARANTINE', 0, 12, 'bebas', 44, '#c8102a', 'middle', 4) + T_('NO ENTRY', 0, 24 + 1, 'bebas', 1, '#c8102a', 'middle') + '</g>')
        add(fog(u, 470, '#ff4a8a', .3))
    return svg(W, H, B, tid.replace('-', ' ').title(), D)

THEMES = ['graveyard-dawn', 'abandoned-hospital', 'infested-city', 'dark-forest', 'underground-bunker', 'decrepit-mansion', 'wasteland-arena', 'plague-laboratory', 'tomb-chamber', 'quarantine-zone']

if __name__ == '__main__':
    base = os.path.join(sys.argv[1], 'zombie', 'bg'); os.makedirs(base, exist_ok=True)
    for t in THEMES:
        open(os.path.join(base, t + '.svg'), 'w').write(scene(t))
    print('wrote', len(THEMES))
