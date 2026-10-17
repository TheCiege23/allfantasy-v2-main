#!/usr/bin/env python3
"""Survivor league backgrounds: layered tropical island scenes, 5 sport accents x 4 moods.
Writes out/<mood>-<sport>.svg (1600x600). Layered-silhouette poster style (atmospheric perspective)."""
import math, random, os
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
W, H, HZ = 1600, 600, 352  # horizon y

MOODS = {
  'day':   dict(sky=('#1f86c2', '#7cc8e0', '#d9f2ef'), sun='#fff7da', sunr=46, sunxy=(1270, 150), far='#86bccb', far2='#6aa6b6', mid='#3d8a87', near='#0e3434',
                sea=('#3ba7c4', '#17708f', '#0b4560'), sand=('#e8d3a0', '#c9ad78'), glint='#ffffff', rim='#d9f2ef', haze=.0),
  'dusk':  dict(sky=('#231a44', '#a3497a', '#f6a05a'), sun='#ffd88a', sunr=58, sunxy=(1180, 300), far='#a35a76', far2='#86486a', mid='#55304f', near='#1a1022',
                sea=('#e28a63', '#83405a', '#2c1a34'), sand=('#8a5446', '#5c3438'), glint='#ffe2a8', rim='#ffb879', haze=.0),
  'night': dict(sky=('#04071a', '#0f1a3d', '#22345e'), sun='#f4f0da', sunr=30, sunxy=(1290, 110), far='#1f2c4d', far2='#18233f', mid='#10182e', near='#05070f',
                sea=('#1d2c55', '#0e1834', '#05080f'), sand=('#241c26', '#150f17'), glint='#cfd8ff', rim='#ffb547', haze=.0),
  'exile': dict(sky=('#20282c', '#4d5a5e', '#8a9694'), sun=None, sunr=0, sunxy=(1200, 200), far='#5d6b70', far2='#4a575c', mid='#334046', near='#0f1517',
                sea=('#5a6a6d', '#2e3b3f', '#121a1d'), sand=('#4f4c46', '#34322e'), glint='#c9d3d2', rim='#b7c4c4', haze=.0),
}

def ridge(seed, y0, amp, n, x0=-40, x1=W + 40, rough=0.5):
    r = random.Random(seed); pts = []
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        y = y0 - amp * (0.5 + 0.5 * math.sin(i * 0.9 + seed)) * (0.6 + 0.4 * r.random()) - r.uniform(-1, 1) * amp * rough * 0.3
        pts.append((x, y))
    d = f'M{x0},{H} L' + ' '.join(f'{x:.0f},{y:.0f}' for x, y in pts) + f' L{x1},{H} Z'
    return d

def volcano(cx, base, w, h):
    return (f'M{cx - w},{base} C{cx - w*0.62},{base - h*0.35} {cx - w*0.22},{base - h*0.92} {cx - w*0.1},{base - h} '
            f'L{cx - w*0.04},{base - h*0.97} L{cx + w*0.02},{base - h*1.0} L{cx + w*0.09},{base - h*0.98} '
            f'C{cx + w*0.24},{base - h*0.9} {cx + w*0.6},{base - h*0.38} {cx + w},{base} Z')

def leaf(x, y, ang, L, wdt, droop, col, seed):
    """Feathery palm frond: curved spine + many thin leaflets hanging off both sides."""
    r = random.Random(seed); a = math.radians(ang)
    dx, dy = math.cos(a), math.sin(a)
    pt = lambda t: (x + dx * L * t, y + dy * L * t + droop * L * 0.45 * t * t)
    out = []
    n = 16
    for i in range(1, n + 1):
        t = i / (n + 1); px, py = pt(t); qx, qy = pt(t + 0.02)
        sa = math.atan2(qy - py, qx - px)
        lf = (wdt * 2.2) * math.sin(math.pi * min(1, t * 1.1)) * (0.8 + 0.3 * r.random()) + 6
        for side in (1, -1):
            la = sa + side * math.radians(62) + math.radians(28) * (1 if math.cos(sa) >= 0 else -1) * 0.6
            ex, ey = px + math.cos(la) * lf, py + math.sin(la) * lf + lf * 0.35
            bx1, by1 = px + math.cos(sa) * 5, py + math.sin(sa) * 5
            out.append(f'M{px:.1f},{py:.1f} L{bx1:.1f},{by1:.1f} L{ex:.1f},{ey:.1f} Z')
    spine = 'M' + ' L'.join(f'{pt(k/20)[0]:.1f},{pt(k/20)[1]:.1f}' for k in range(21))
    return f'<path d="{" ".join(out)}" fill="{col}"/><path d="{spine}" stroke="{col}" stroke-width="4" fill="none" stroke-linecap="round"/>'

def palm(x, ground, h, lean, col, seed, rim=None):
    r = random.Random(seed)
    topx, topy = x + lean, ground - h
    c1x, c1y = x + lean * 0.1, ground - h * 0.45
    trunk = f'<path d="M{x-11},{ground} Q{c1x-7},{c1y} {topx-4},{topy} L{topx+4},{topy} Q{c1x+9},{c1y} {x+11},{ground} Z" fill="{col}"/>'
    rings = ''.join(f'<path d="M{(x + (topx - x) * t) - 9 + 3*t:.1f},{ground - h * t:.1f} q9,4 18,0" stroke="{rim or col}" stroke-width="1.6" fill="none" opacity=".35"/>' for t in [i / 14 for i in range(1, 14)])
    fronds = ''.join(leaf(topx, topy, a + r.uniform(-8, 8), h * r.uniform(0.38, 0.5), 12, 0.9 if abs(a + 90) > 30 else 0.35, col, seed * 10 + i)
                     for i, a in enumerate([-175, -150, -125, -100, -78, -52, -25, -2, 20, 160]))
    nuts = ''.join(f'<circle cx="{topx + dx}" cy="{topy + 8 + dy}" r="6" fill="{col}"/>' for dx, dy in [(-6, 2), (5, 4), (0, 9)])
    return trunk + (rings if rim else '') + fronds + nuts

def bamboo(x1, y1, x2, y2, w, col, rim):
    L = math.hypot(x2 - x1, y2 - y1); ang = math.degrees(math.atan2(y2 - y1, x2 - x1))
    nodes = ''.join(f'<rect x="{s:.0f}" y="{-w/2 - 1.5}" width="4" height="{w + 3}" rx="1.5" fill="{col}" stroke="{rim}" stroke-opacity=".35" stroke-width="1"/>' for s in [L * k / 6 for k in range(1, 6)])
    return (f'<g transform="translate({x1},{y1}) rotate({ang:.2f})"><rect x="0" y="{-w/2}" width="{L:.0f}" height="{w}" rx="{w/2}" fill="{col}"/>'
            f'<rect x="0" y="{-w/2}" width="{L:.0f}" height="{w*0.32:.1f}" rx="{w*0.16}" fill="{rim}" opacity=".28"/>{nodes}</g>')

def ball_football(cx, cy, s, col, rim):
    return (f'<g transform="translate({cx},{cy}) rotate(-12) scale({s})"><path d="M-26,0 C-14,-16 14,-16 26,0 C14,16 -14,16 -26,0 Z" fill="{col}"/>'
            f'<path d="M-20,-4 C-8,-12 8,-12 20,-4" stroke="{rim}" stroke-width="2" fill="none" opacity=".55"/>'
            f'<path d="M-8,-1 H8 M-5,-5 V3 M0,-5 V3 M5,-5 V3" stroke="{rim}" stroke-width="2" opacity=".7"/></g>')

def ball_round(cx, cy, r, col, rim, kind):
    seams = {'basketball': f'<path d="M{-r},0 H{r} M0,{-r} V{r} M{-r*.7},{-r*.7} C{-r*.25},{-r*.3} {-r*.25},{r*.3} {-r*.7},{r*.7}" stroke="{rim}" stroke-width="2" fill="none" opacity=".55"/>',
             'soccer': f'<polygon points="0,{-r*.35} {r*.33},{-r*.1} {r*.2},{r*.3} {-r*.2},{r*.3} {-r*.33},{-r*.1}" fill="{rim}" opacity=".45"/>',
             'baseball': f'<path d="M{-r*.5},{-r*.8} C{-r*.15},{-r*.3} {-r*.15},{r*.3} {-r*.5},{r*.8} M{r*.5},{-r*.8} C{r*.15},{-r*.3} {r*.15},{r*.3} {r*.5},{r*.8}" stroke="{rim}" stroke-width="1.6" stroke-dasharray="3 2" fill="none" opacity=".7"/>'}[kind]
    return f'<g transform="translate({cx},{cy})"><circle r="{r}" fill="{col}"/><path d="M{-r*.6},{-r*.55} A{r},{r} 0 0 1 {r*.2},{-r*.95}" stroke="{rim}" stroke-width="2.5" fill="none" opacity=".5"/>{seams}</g>'

def net(x, y, w, h, col, step=14):
    lines = ''.join(f'<path d="M{x + i},{y} L{x + i + 10},{y + h}" />' for i in range(0, w + 1, step))
    lines += ''.join(f'<path d="M{x},{y + j} L{x + w + 10},{y + j}" />' for j in range(0, h + 1, step))
    return f'<g stroke="{col}" stroke-width="1.2" opacity=".55" fill="none">{lines}</g>'

def accent(sport, m, gy):
    c, rim = m['near'], m['rim']; out = ''
    if sport == 'football':
        # bamboo goalpost + raked yard lines in the sand
        out += ''.join(f'<path d="M{760 + i*120},{gy + 8} L{690 + i*150},{H}" stroke="{m["sand"][0]}" stroke-width="3" opacity=".35"/>' for i in range(6))
        out += bamboo(1120, gy + 14, 1120, gy - 150, 13, c, rim)
        out += bamboo(1040, gy - 150, 1200, gy - 150, 12, c, rim)
        out += bamboo(1046, gy - 150, 1040, gy - 330, 10, c, rim) + bamboo(1194, gy - 150, 1200, gy - 330, 10, c, rim)
        out += f'<path d="M1110,{gy - 160} l20,20 M1130,{gy - 160} l-20,20" stroke="{rim}" stroke-width="2" opacity=".5"/>'
        out += ball_football(980, gy + 40, 1.3, c, rim)
    elif sport == 'basketball':
        out += palm(1180, gy + 30, 300, -70, c, 77, rim)
        out += f'<g transform="translate(1090,{gy - 210}) rotate(-6)"><rect x="-58" y="-40" width="116" height="78" rx="4" fill="{c}" stroke="{rim}" stroke-opacity=".35" stroke-width="2"/>' + \
               ''.join(f'<path d="M-58,{-40 + k*19.5} H58" stroke="{rim}" stroke-opacity=".25" stroke-width="1.5"/>' for k in range(1, 4)) + \
               f'<rect x="-22" y="-6" width="44" height="30" fill="none" stroke="{rim}" stroke-opacity=".45" stroke-width="2"/></g>'
        out += f'<ellipse cx="1088" cy="{gy - 166}" rx="30" ry="7" fill="none" stroke="{rim}" stroke-width="4" opacity=".85"/>'
        out += ''.join(f'<path d="M{1060 + k*11},{gy - 164} L{1066 + k*9},{gy - 120}" stroke="{rim}" stroke-width="1.4" opacity=".5"/>' for k in range(6))
        out += ball_round(960, gy + 34, 22, c, rim, 'basketball')
    elif sport == 'baseball':
        bx, by = 960, gy + 70
        pts = [(bx, by + 60), (bx + 170, by + 10), (bx, by - 30), (bx - 170, by + 10)]
        out += f'<path d="M{" L".join(f"{a},{b}" for a, b in pts)} Z" fill="none" stroke="{m["sand"][0]}" stroke-width="3" opacity=".4"/>'
        out += ''.join(f'<rect x="{a - 9}" y="{b - 5}" width="18" height="10" rx="2" fill="{rim}" opacity=".7" transform="rotate(-8 {a} {b})"/>' for a, b in pts)
        out += ''.join(bamboo(1150 + k * 34, gy + 20, 1150 + k * 34, gy - 120 - (k % 2) * 16, 9, c, rim) for k in range(6))
        out += bamboo(1140, gy - 70, 1330, gy - 78, 6, c, rim) + bamboo(1140, gy - 20, 1330, gy - 24, 6, c, rim)
        out += bamboo(1240, gy + 36, 1300, gy - 110, 11, c, rim)
        out += ball_round(1210, gy + 38, 10, c, rim, 'baseball')
    elif sport == 'hockey':
        out += f'<path d="M1020,{gy + 22} L1020,{gy - 70} Q1020,{gy - 92} 1042,{gy - 92} L1178,{gy - 92} Q1200,{gy - 92} 1200,{gy - 70} L1200,{gy + 22}" fill="none" stroke="{c}" stroke-width="12" stroke-linejoin="round"/>'
        out += net(1026, gy - 86, 168, 104, rim, 12)
        out += f'<path d="M1020,{gy - 70} L1050,{gy - 40} M1200,{gy - 70} L1170,{gy - 40}" stroke="{c}" stroke-width="6"/>'
        for sx, flip in ((920, 1), (1300, -1)):
            out += f'<g transform="translate({sx},{gy + 30}) scale({flip},1) rotate(-28)"><rect x="-4" y="-150" width="8" height="150" rx="3" fill="{c}"/><path d="M-4,0 L-4,-6 L40,-6 Q52,-6 52,6 L52,10 L-4,10 Z" fill="{c}"/><rect x="-4" y="-150" width="8" height="26" fill="{rim}" opacity=".4"/></g>'
        out += f'<ellipse cx="1110" cy="{gy + 56}" rx="18" ry="6" fill="{c}" stroke="{rim}" stroke-opacity=".5" stroke-width="1.5"/>'
    elif sport == 'soccer':
        out += f'<path d="M980,{gy + 26} L980,{gy - 110} L1260,{gy - 118} L1262,{gy + 22}" fill="none" stroke="{c}" stroke-width="13" stroke-linejoin="round"/>'
        out += f'<path d="M986,{gy - 104} L1010,{gy - 70} L1236,{gy - 76} L1256,{gy - 112}" fill="none" stroke="{c}" stroke-width="4"/>'
        out += net(988, gy - 108, 266, 126, rim, 13)
        out += f'<path d="M900,{gy + 70} Q1110,{gy + 54} 1330,{gy + 70}" stroke="{m["sand"][0]}" stroke-width="3" fill="none" opacity=".35"/>'
        out += ball_round(1080, gy + 62, 21, c, rim, 'soccer')
    return out

def torches(m, gy, uid):
    out = ''
    for i, (x, h) in enumerate([(700, 150), (790, 170), (1360, 165), (1460, 150), (560, 130)]):
        y = gy + 30
        out += f'<circle cx="{x}" cy="{y - h - 18}" r="70" fill="url(#{uid}-torchglow)"/>'
        out += bamboo(x, y, x + 3, y - h, 9, m['near'], m['rim'])
        out += f'<path d="M{x - 13},{y - h} L{x + 16},{y - h} L{x + 10},{y - h + 16} L{x - 7},{y - h + 16} Z" fill="{m["near"]}"/>'
        out += f'<path d="M{x + 1},{y - h - 44} C{x + 15},{y - h - 26} {x + 14},{y - h - 6} {x + 1},{y - h - 2} C{x - 12},{y - h - 6} {x - 13},{y - h - 22} {x - 4},{y - h - 32} C{x - 2},{y - h - 26} {x + 1},{y - h - 26} {x + 1},{y - h - 44} Z" fill="#ffb547"/>'
        out += f'<path d="M{x + 1},{y - h - 26} C{x + 7},{y - h - 16} {x + 6},{y - h - 7} {x + 1},{y - h - 5} C{x - 5},{y - h - 7} {x - 5},{y - h - 15} {x + 1},{y - h - 26} Z" fill="#fff1b8"/>'
    # council fire
    fx, fy = 640, gy + 80
    out += f'<circle cx="{fx}" cy="{fy - 30}" r="140" fill="url(#{uid}-torchglow)"/>'
    out += ''.join(f'<path d="M{fx + a},{fy} L{fx + b},{fy - 12}" stroke="{m["near"]}" stroke-width="9" stroke-linecap="round"/>' for a, b in ((-40, 30), (40, -30), (-10, 12)))
    out += f'<path d="M{fx},{fy - 78} C{fx + 30},{fy - 46} {fx + 26},{fy - 10} {fx},{fy - 6} C{fx - 28},{fy - 10} {fx - 30},{fy - 40} {fx - 10},{fy - 58} C{fx - 6},{fy - 44} {fx + 2},{fy - 44} {fx},{fy - 78} Z" fill="#ff9a3c"/>'
    out += f'<path d="M{fx},{fy - 46} C{fx + 13},{fy - 30} {fx + 11},{fy - 12} {fx},{fy - 9} C{fx - 12},{fy - 12} {fx - 12},{fy - 28} {fx},{fy - 46} Z" fill="#fff1b8"/>'
    return out

def scene(mood, sport):
    uid = f'{mood}-{sport}'
    m = MOODS[mood]; r = random.Random(hash((mood, sport)) & 0xffff)
    s0, s1, s2 = m['sky']; gy = 470
    defs = f'''<defs>
<linearGradient id="{uid}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{s0}"/><stop offset=".62" stop-color="{s1}"/><stop offset="1" stop-color="{s2}"/></linearGradient>
<linearGradient id="{uid}-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{m['sea'][0]}"/><stop offset=".4" stop-color="{m['sea'][1]}"/><stop offset="1" stop-color="{m['sea'][2]}"/></linearGradient>
<linearGradient id="{uid}-sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{m['sand'][0]}"/><stop offset="1" stop-color="{m['sand'][1]}"/></linearGradient>
<radialGradient id="{uid}-sun"><stop offset="0" stop-color="{m['sun'] or '#fff'}" stop-opacity=".95"/><stop offset=".25" stop-color="{m['sun'] or '#fff'}" stop-opacity=".45"/><stop offset="1" stop-color="{m['sun'] or '#fff'}" stop-opacity="0"/></radialGradient>
<radialGradient id="{uid}-torchglow"><stop offset="0" stop-color="#ffb547" stop-opacity=".55"/><stop offset=".5" stop-color="#ff7a2a" stop-opacity=".16"/><stop offset="1" stop-color="#ff7a2a" stop-opacity="0"/></radialGradient>
<linearGradient id="{uid}-haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{s2}" stop-opacity="0"/><stop offset="1" stop-color="{s2}" stop-opacity=".55"/></linearGradient>
</defs>'''
    sx, sy = m['sunxy']; p = []
    p.append(f'<rect width="{W}" height="{H}" fill="url(#{uid}-sky)"/>')
    if mood == 'night':
        p.append(''.join(f'<circle cx="{r.uniform(0, W):.0f}" cy="{r.uniform(0, HZ - 60):.0f}" r="{r.choice([0.8, 1, 1.2, 1.6]):.1f}" fill="#fff" opacity="{r.uniform(.35, .9):.2f}"/>' for _ in range(160)))
    if m['sun']:
        p.append(f'<circle cx="{sx}" cy="{sy}" r="{m["sunr"] * 5}" fill="url(#{uid}-sun)"/><circle cx="{sx}" cy="{sy}" r="{m["sunr"]}" fill="{m["sun"]}"/>')
        if mood == 'night':
            p.append(f'<circle cx="{sx + 10}" cy="{sy - 6}" r="{m["sunr"] - 2}" fill="{s0}" opacity=".0"/>' + ''.join(f'<circle cx="{sx + a}" cy="{sy + b}" r="{c}" fill="#d9d4bd" opacity=".55"/>' for a, b, c in ((-8, -6, 5), (9, 7, 4), (4, -12, 3))))
    if mood in ('day', 'dusk'):
        cl = '#ffffff' if mood == 'day' else '#ffc49a'
        for k in range(7):
            cx, cy, w = r.uniform(80, W - 80), r.uniform(50, 230), r.uniform(140, 320)
            p.append(f'<g opacity="{".55" if mood == "day" else ".35"}" fill="{cl}"><ellipse cx="{cx:.0f}" cy="{cy:.0f}" rx="{w/2:.0f}" ry="{w*0.07:.0f}"/><ellipse cx="{cx + w*0.12:.0f}" cy="{cy - w*0.05:.0f}" rx="{w*0.24:.0f}" ry="{w*0.07:.0f}"/></g>')
    if mood == 'exile':
        p.append(''.join(f'<ellipse cx="{r.uniform(0, W):.0f}" cy="{r.uniform(20, 220):.0f}" rx="{r.uniform(160, 380):.0f}" ry="{r.uniform(26, 60):.0f}" fill="{c}" opacity="{r.uniform(.35, .7):.2f}"/>' for c in ['#1b2226', '#2a3337', '#3c474b'] * 5))
        p.append('<path d="M1010,40 L986,128 L1010,124 L978,236 L1040,110 L1014,116 L1046,40 Z" fill="#e9f2f2" opacity=".85"/>')
    # far: volcano + ridge
    p.append(f'<path d="{volcano(1130, HZ + 4, 330, 210)}" fill="{m["far"]}"/>')
    if mood != 'exile':
        p.append(f'<path d="M1110,{HZ - 212} C1080,{HZ - 260} 1150,{HZ - 280} 1120,{HZ - 330} C1100,{HZ - 360} 1170,{HZ - 380} 1150,{HZ - 420}" stroke="{m["far"]}" stroke-width="30" stroke-linecap="round" fill="none" opacity=".35"/>')
    p.append(f'<path d="{ridge(3, HZ + 2, 70, 18)}" fill="{m["far2"]}"/>')
    p.append(f'<rect y="{HZ - 120}" width="{W}" height="124" fill="url(#{uid}-haze)"/>')
    # sea
    p.append(f'<rect y="{HZ}" width="{W}" height="{H - HZ}" fill="url(#{uid}-sea)"/>')
    p.append(f'<rect y="{HZ}" width="{W}" height="2" fill="{m["glint"]}" opacity=".35"/>')
    gl = m['glint']
    p.append(''.join(f'<rect x="{sx - r.uniform(10, 120) + r.uniform(-60, 60):.0f}" y="{HZ + 6 + k*6:.0f}" width="{r.uniform(30, 160) * (1 - k/28):.0f}" height="1.6" fill="{gl}" opacity="{(0.6 - k*0.018):.2f}"/>' for k in range(28)) if m['sun'] else '')
    p.append(''.join(f'<path d="M{r.uniform(0, W):.0f},{r.uniform(HZ + 20, H):.0f} q14,-5 28,0" stroke="{gl}" stroke-width="1.4" fill="none" opacity=".22"/>' for _ in range(60)))
    # mid island (left) + near beach
    p.append(f'<path d="M-20,{HZ + 6} C120,{HZ - 70} 300,{HZ - 92} 470,{HZ - 40} C560,{HZ - 14} 620,{HZ + 4} 700,{HZ + 8} L-20,{HZ + 8} Z" fill="{m["mid"]}"/>')
    p.append(''.join(palm(x, HZ - 20 + dy, h, lean, m['mid'], i + 30) for i, (x, h, lean, dy) in enumerate([(160, 110, -20, -30), (240, 130, 18, -46), (380, 96, 26, -24)])))
    p.append(f'<path d="M-20,{gy - 10} C200,{gy - 40} 520,{gy - 30} 780,{gy - 6} C1040,{gy + 16} 1300,{gy - 4} 1620,{gy - 26} L1620,{H} L-20,{H} Z" fill="url(#{uid}-sand)"/>')
    p.append(f'<path d="M-20,{gy - 10} C200,{gy - 40} 520,{gy - 30} 780,{gy - 6} C1040,{gy + 16} 1300,{gy - 4} 1620,{gy - 26}" fill="none" stroke="{gl}" stroke-width="3" opacity=".35"/>')
    if mood == 'night':
        p.append(torches(m, gy, uid))
    p.append(accent(sport, m, gy))
    # near palms (left frame) + foliage
    p.append(palm(90, H + 10, 420, 120, m['near'], 5, m['rim']))
    p.append(palm(250, H + 20, 330, 160, m['near'], 9, m['rim']))
    p.append(palm(1530, H + 20, 380, -150, m['near'], 13, m['rim']))
    p.append(''.join(leaf(x, H + 6, a, L, 22, 0.9, m['near'], 300 + i) for i, (x, a, L) in enumerate([(-10, -50, 220), (60, -80, 200), (380, -120, 160), (1460, -130, 190), (1580, -100, 210), (1600, -160, 180)])))
    if mood == 'exile':
        p.append('<g stroke="#d6e0e0" stroke-width="1.2" opacity=".35">' + ''.join(f'<path d="M{x:.0f},{y:.0f} l-14,40"/>' for x, y in ((r.uniform(0, W + 200), r.uniform(-40, H)) for _ in range(260))) + '</g>')
        p.append(f'<g fill="{m["near"]}"><path d="M640,{gy + 10} L700,{gy - 60} L770,{gy - 52} L800,{gy + 6} Z"/><path d="M700,{gy - 60} L736,{gy - 92} L770,{gy - 52} Z" opacity=".8"/></g>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Tropical island, {mood}, {sport} accent">{defs}{"".join(p)}</svg>'

if __name__ == '__main__':
    for mood in MOODS:
        for sport in ('football', 'basketball', 'baseball', 'hockey', 'soccer'):
            open(os.path.join(OUT, f'{mood}-{sport}.svg'), 'w').write(scene(mood, sport))
    print('ok')
