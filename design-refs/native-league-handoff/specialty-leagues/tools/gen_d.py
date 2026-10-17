"""Specialty league art, part D: Tournament (multi-league cuts, redrafts, final bracket). Usage: python3 gen_d.py <out_dir>"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_a import svg, lg, rg, ribbon, stars, football, INK

GOLD = [(0, '#fff3c4'), (.45, '#e8b84a'), (1, '#7a5214')]

def trophy(cx, cy, s=1, u='tt'):
    return f'''<g transform="translate({cx},{cy}) scale({s})">
<path d="M-34,-56 C-62,-56 -64,-20 -30,-12" stroke="url(#{u}-gold)" stroke-width="8" fill="none"/><path d="M34,-56 C62,-56 64,-20 30,-12" stroke="url(#{u}-gold)" stroke-width="8" fill="none"/>
<path d="M-34,-56 C-62,-56 -64,-20 -30,-12 M34,-56 C62,-56 64,-20 30,-12" stroke="{INK}" stroke-width="2.5" fill="none"/>
<path d="M-40,-66 L40,-66 L36,-30 C32,-8 14,4 0,6 C-14,4 -32,-8 -36,-30 Z" fill="url(#{u}-gold)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
<path d="M-30,-58 L-28,-32 C-26,-18 -16,-8 -8,-4" stroke="#fff" stroke-opacity=".7" stroke-width="4" fill="none" stroke-linecap="round"/>
<rect x="-8" y="6" width="16" height="18" fill="url(#{u}-gold)" stroke="{INK}" stroke-width="3.5"/>
<path d="M-26,24 L26,24 L30,40 L-30,40 Z" fill="#1a1408" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>
<rect x="-34" y="40" width="68" height="10" rx="2" fill="url(#{u}-gold)" stroke="{INK}" stroke-width="3"/>
<path d="M0,-52 l4,9 10,1 -7,7 2,10 -9,-5 -9,5 2,-10 -7,-7 10,-1 Z" fill="#fff8dc" stroke="{INK}" stroke-width="1.6"/></g>'''

def emblem():
    u = 'tt'
    d = (lg(f'{u}-gold', GOLD, 1, 1) + rg(f'{u}-bg', [(0, '#2a2210'), (1, '#07070a')], '50%', '30%', '75%') +
         lg(f'{u}-rim', [(0, '#fff0b8'), (.5, '#b8862a'), (1, '#4a3008')], 0, 1))
    # bracket lines: 8 leaves -> 4 -> 2 -> trophy
    br = ''
    ys = [104, 128, 152, 176, 200, 224, 248, 272][::1]
    for side, x0, x1, x2 in (('L', 58, 78, 98), ('R', 242, 222, 202)):
        for i in range(0, 4):
            ya, yb = 116 + i * 40 - 10, 116 + i * 40 + 10
            br += f'<path d="M{x0},{ya} H{x1} V{yb} H{x0}" stroke="#e8b84a" stroke-width="3" fill="none" opacity=".85"/>'
            br += f'<path d="M{x1},{(ya+yb)/2} H{x2}" stroke="#e8b84a" stroke-width="3" opacity=".85"/>'
        br += f'<path d="M{x2},126 V166 M{x2},206 V246" stroke="#e8b84a" stroke-width="3" opacity=".85"/>'
        xm = 118 if side == 'L' else 182
        br += f'<path d="M{x2},146 H{xm} V226 H{x2}" stroke="#ffd98a" stroke-width="3.5" fill="none"/>'
    b = f'''
<path d="M150,10 L272,46 L262,196 C252,262 206,298 150,318 C94,298 48,262 38,196 L28,46 Z" fill="url(#{u}-rim)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M150,26 L256,57 L247,194 C238,250 200,282 150,300 C100,282 62,250 53,194 L44,57 Z" fill="url(#{u}-bg)" stroke="{INK}" stroke-width="3"/>
<path d="M150,26 L256,57 L247,194 C238,250 200,282 150,300 Z" fill="#000" opacity=".28"/>
{br}
<path d="M118,186 H134 M166,186 H182" stroke="#ffd98a" stroke-width="3.5"/>
<circle cx="150" cy="150" r="54" fill="#e8b84a" opacity=".12"/>
{trophy(150, 176, 0.92, u)}
{''.join(f'<circle cx="{x}" cy="{y}" r="2.2" fill="#fff3c4"/>' for x, y in ((92, 74), (208, 74), (150, 52), (70, 120), (230, 120)))}
{ribbon(u, 'TOURNAMENT', 270, '#c8902a', '#6e4a0e', '#1a1204', 236)}'''
    return svg(300, 340, b, 'Tournament league emblem', d)

def banner():
    u = 'ttb'
    d = (lg(f'{u}-sky', [(0, '#05060a'), (.6, '#141022'), (1, '#2a1e0c')]) + lg(f'{u}-gold', GOLD, 1, 1) +
         rg(f'{u}-glow', [(0, '#ffd98a'), (.35, '#e8b84a88'), (1, '#e8b84a00')]) + lg(f'{u}-beam', [(0, '#fff3c4aa'), (1, '#fff3c400')]) +
         lg(f'{u}-field', [(0, '#1c3a1e'), (1, '#0a160b')]))
    beams = ''.join(f'<path d="M{x},0 L{x-90+t},500 L{x+90+t},500 Z" fill="url(#{u}-beam)" opacity=".18"/>' for x, t in ((180, 260), (520, 120), (1080, -120), (1420, -260)))
    # bracket of light: 16 leaves each side converge to center
    lines = ''
    for side in (-1, 1):
        cols = [(800 + side * 740, 16), (800 + side * 590, 8), (800 + side * 450, 4), (800 + side * 320, 2), (800 + side * 200, 1)]
        for ci in range(len(cols) - 1):
            x, n = cols[ci]; xn, nn = cols[ci + 1]
            for k in range(n):
                y = 60 + (k + .5) * 380 / n
                yn = 60 + (k // 2 + .5) * 380 / nn
                op = .25 + ci * .17
                lines += f'<path d="M{x},{y:.0f} H{(x+xn)/2:.0f} V{yn:.0f} H{xn}" stroke="#e8b84a" stroke-width="{1.6 + ci * .8:.1f}" fill="none" opacity="{op:.2f}"/>'
                if ci == 0:
                    lines += f'<circle cx="{x}" cy="{y:.0f}" r="3" fill="#ffd98a" opacity=".6"/>'
        lines += f'<path d="M{800 + side * 200},250 H{800 + side * 96}" stroke="#ffd98a" stroke-width="5"/>'
    b = f'''
<rect width="1600" height="500" fill="url(#{u}-sky)"/>
{stars(70, 17, 1600, 500, 220, '#fff3c4')}
{beams}
<ellipse cx="800" cy="520" rx="900" ry="120" fill="url(#{u}-field)"/>
<circle cx="800" cy="240" r="260" fill="url(#{u}-glow)" opacity=".45"/>
{lines}
<ellipse cx="800" cy="372" rx="120" ry="16" fill="#000" opacity=".5"/>
<path d="M730,330 L870,330 L884,372 L716,372 Z" fill="#14100a" stroke="#000" stroke-width="3"/>
<path d="M740,338 H860" stroke="#e8b84a" stroke-width="2" opacity=".6"/>
{trophy(800, 264, 1.25, u)}
{football(680, 410, 1.1, -24)}{football(930, 418, .9, 18)}'''
    return svg(1600, 500, b, 'Tournament league banner', d).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ', 1)

def icons():
    g = lg('tig', GOLD, 1, 1)
    advance = svg(64, 64, f'''<defs>{g}</defs><circle cx="32" cy="32" r="28" fill="#12301e" stroke="{INK}" stroke-width="2.5"/>
<path d="M18,40 L32,26 L46,40" stroke="#7fe0a6" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M18,28 L32,14 L46,28" stroke="url(#tig)" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M14,50 H50" stroke="#7fe0a6" stroke-width="3" stroke-dasharray="4 3"/>''', 'Advanced')
    out = svg(64, 64, f'''<circle cx="32" cy="32" r="28" fill="#3a1212" stroke="{INK}" stroke-width="2.5"/><path d="M12,30 H52" stroke="#ff6a5a" stroke-width="3" stroke-dasharray="4 3"/>
<path d="M22,38 L32,48 L42,38" stroke="#ff9a8a" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M32,16 V46" stroke="#ff9a8a" stroke-width="6" stroke-linecap="round"/>''', 'Eliminated')
    cut = svg(64, 64, f'''<defs>{g}</defs><rect x="6" y="10" width="52" height="44" rx="6" fill="#151926" stroke="{INK}" stroke-width="2.5"/>
{''.join(f'<rect x="12" y="{y}" width="{w}" height="5" rx="2" fill="{c}"/>' for y, w, c in ((16, 40, '#7fe0a6'), (24, 34, '#7fe0a6'), (40, 26, '#5a6078'), (47, 20, '#5a6078')))}
<path d="M4,33 H60" stroke="url(#tig)" stroke-width="4"/><path d="M48,27 L60,33 L48,39 Z" fill="url(#tig)" stroke="{INK}" stroke-width="1.5"/>''', 'Cut line')
    bracket = svg(64, 64, f'''<defs>{g}</defs><path d="M6,10 H18 V22 H6 M6,42 H18 V54 H6 M18,16 H28 V48 H18 M28,32 H40" stroke="url(#tig)" stroke-width="4" fill="none" stroke-linejoin="round"/>
<path d="M58,10 H46 V22 H58 M58,42 H46 V54 H58 M46,16 H40 V48 H46" stroke="#a3a9c2" stroke-width="3" fill="none" opacity=".7"/><circle cx="40" cy="32" r="5" fill="#ffd98a" stroke="{INK}" stroke-width="2"/>''', 'Bracket')
    redraft = svg(64, 64, f'''<defs>{g}</defs><rect x="10" y="12" width="26" height="36" rx="4" fill="#1e2333" stroke="{INK}" stroke-width="2.5" transform="rotate(-14 23 30)"/>
<rect x="22" y="14" width="26" height="36" rx="4" fill="url(#tig)" stroke="{INK}" stroke-width="2.5" transform="rotate(8 35 32)"/><text x="35" y="38" text-anchor="middle" font-family="Archivo, sans-serif" font-weight="900" font-size="14" fill="#1a1204" transform="rotate(8 35 32)">R2</text>
<path d="M10,56 C22,62 42,62 54,54" stroke="#ffd98a" stroke-width="3" fill="none"/><path d="M48,50 L55,54 L49,60" stroke="#ffd98a" stroke-width="3" fill="none"/>''', 'Redraft')
    seed = svg(64, 64, f'''<defs>{g}</defs><path d="M32,4 L56,14 L52,40 C48,52 40,58 32,62 C24,58 16,52 12,40 L8,14 Z" fill="url(#tig)" stroke="{INK}" stroke-width="2.5"/>
<text x="32" y="42" text-anchor="middle" font-family="JetBrains Mono, monospace" font-weight="700" font-size="22" fill="#1a1204">#1</text>''', 'Seed')
    cup = svg(64, 64, f'''<defs>{lg('tt-gold', GOLD, 1, 1)}</defs>{trophy(32, 40, .42, 'tt')}''', 'Champion')
    bye = svg(64, 64, f'''<defs>{g}</defs><circle cx="32" cy="32" r="28" fill="#1e1a10" stroke="{INK}" stroke-width="2.5"/><path d="M14,40 C22,18 42,18 50,36" stroke="url(#tig)" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M42,34 L51,38 L54,28" stroke="url(#tig)" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="44" r="5" fill="#a3a9c2"/><circle cx="32" cy="46" r="3" fill="#5a6078"/>''', 'Bye week')
    return {'icon-advance.svg': advance, 'icon-out.svg': out, 'icon-cut.svg': cut, 'icon-bracket.svg': bracket,
            'icon-redraft.svg': redraft, 'icon-seed.svg': seed, 'icon-cup.svg': cup, 'icon-bye.svg': bye}

if __name__ == '__main__':
    out = os.path.join(sys.argv[1], 'tournament'); os.makedirs(out, exist_ok=True)
    open(f'{out}/emblem.svg', 'w').write(emblem()); open(f'{out}/banner.svg', 'w').write(banner())
    for f, s in icons().items(): open(f'{out}/{f}', 'w').write(s)
    print('wrote', 2 + len(icons()))
