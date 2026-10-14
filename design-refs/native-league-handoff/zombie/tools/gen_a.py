"""Specialty league art, part A: shared helpers + Guillotine, Big Brother, Survivor Guillotine."""
import math
INK = '#0e0a08'

def svg(w, h, body, label, defs=''):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{label}">'
            f'<defs>{defs}</defs>{body}</svg>')

def lg(id_, stops, x2=0, y2=1):
    s = ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return f'<linearGradient id="{id_}" x1="0" y1="0" x2="{x2}" y2="{y2}">{s}</linearGradient>'

def rg(id_, stops, cx='50%', cy='50%', r='50%'):
    s = ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return f'<radialGradient id="{id_}" cx="{cx}" cy="{cy}" r="{r}">{s}</radialGradient>'

def ribbon(u, text, y, fill, dark, txt='#fff', w=230, cx=150):
    x0, x1 = cx - w / 2, cx + w / 2
    return (f'<path d="M{x0-22},{y+6} L{x0+4},{y+6} L{x0+4},{y+40} L{x0-22},{y+40} L{x0-10},{y+23} Z" fill="{dark}" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>'
            f'<path d="M{x1+22},{y+6} L{x1-4},{y+6} L{x1-4},{y+40} L{x1+22},{y+40} L{x1+10},{y+23} Z" fill="{dark}" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>'
            f'<path d="M{x0},{y} L{x1},{y} L{x1},{y+36} L{x0},{y+36} Z" fill="{fill}" stroke="{INK}" stroke-width="3.5"/>'
            f'<path d="M{x0+6},{y+5} L{x1-6},{y+5}" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>'
            f'<text x="{cx}" y="{y+25.5}" text-anchor="middle" font-family="Archivo Black, Archivo, Arial Black, sans-serif" font-weight="900" font-size="17" letter-spacing="2.5" fill="{txt}">{text}</text>')

def football(cx, cy, s=1, rot=-30, uid='fb'):
    return (f'<g transform="translate({cx},{cy}) rotate({rot}) scale({s})">'
            f'<ellipse rx="22" ry="13" fill="#8a4a22" stroke="{INK}" stroke-width="3"/>'
            f'<path d="M-18,-4 C-10,-9 10,-9 18,-4" stroke="#c97a44" stroke-width="2.5" fill="none" opacity=".7"/>'
            f'<path d="M-9,0 H9" stroke="#fff" stroke-width="2.4"/>'
            + ''.join(f'<path d="M{x},-3.5 V3.5" stroke="#fff" stroke-width="2"/>' for x in (-6, -2, 2, 6)) +
            f'<path d="M-15,-6 v12 M15,-6 v12" stroke="#fff" stroke-width="2" opacity=".85"/></g>')

def stars(n, seed, w, h, ymax, color='#fff'):
    out = []
    x = seed
    for i in range(n):
        x = (x * 9301 + 49297) % 233280
        px = x / 233280 * w
        x = (x * 9301 + 49297) % 233280
        py = x / 233280 * ymax
        r = 0.6 + (i % 3) * 0.5
        out.append(f'<circle cx="{px:.0f}" cy="{py:.0f}" r="{r}" fill="{color}" opacity="{0.35 + (i % 4) * 0.15:.2f}"/>')
    return ''.join(out)

# ------------------------------------------------------------------ GUILLOTINE
def guil_emblem():
    u = 'gu'
    d = (lg(f'{u}-wood', [(0, '#7a4a28'), (.5, '#a8693a'), (1, '#5a3418')], 1, 0) +
         lg(f'{u}-steel', [(0, '#f2f4f8'), (.45, '#aeb6c4'), (1, '#5c6575')], 1, 1) +
         rg(f'{u}-bg', [(0, '#5a1414'), (1, '#1c0606')], '50%', '35%', '70%') +
         lg(f'{u}-rim', [(0, '#d6dbe4'), (.5, '#7d8796'), (1, '#3c4350')], 0, 1))
    b = f'''
<path d="M150,10 L272,46 L262,196 C252,262 206,298 150,318 C94,298 48,262 38,196 L28,46 Z" fill="url(#{u}-rim)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M150,26 L256,57 L247,194 C238,250 200,282 150,300 C100,282 62,250 53,194 L44,57 Z" fill="url(#{u}-bg)" stroke="{INK}" stroke-width="3"/>
<path d="M60,70 L240,70" stroke="#ff4a3a" stroke-opacity=".25" stroke-width="2" stroke-dasharray="6 6"/>
<circle cx="150" cy="150" r="96" fill="none" stroke="#ff4a3a" stroke-opacity=".18" stroke-width="18"/>
<!-- uprights -->
<rect x="92" y="54" width="20" height="214" rx="3" fill="url(#{u}-wood)" stroke="{INK}" stroke-width="3.5"/>
<rect x="188" y="54" width="20" height="214" rx="3" fill="url(#{u}-wood)" stroke="{INK}" stroke-width="3.5"/>
<path d="M98,70 v190 M194,70 v190" stroke="#3e220c" stroke-width="2" opacity=".5" stroke-dasharray="14 8"/>
<rect x="80" y="44" width="140" height="22" rx="4" fill="url(#{u}-wood)" stroke="{INK}" stroke-width="3.5"/>
<circle cx="102" cy="55" r="4" fill="#d9b45a" stroke="{INK}" stroke-width="1.5"/><circle cx="198" cy="55" r="4" fill="#d9b45a" stroke="{INK}" stroke-width="1.5"/>
<!-- rope -->
<path d="M150,66 V92" stroke="#c9a46a" stroke-width="4" stroke-dasharray="3 3"/>
<!-- blade -->
<path d="M114,92 L186,92 L186,118 L114,150 Z" fill="url(#{u}-steel)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
<path d="M118,145 L184,116" stroke="#fff" stroke-width="3" opacity=".9"/>
<rect x="112" y="86" width="76" height="10" rx="2" fill="#4a525e" stroke="{INK}" stroke-width="3"/>
<!-- lunette with football -->
<rect x="106" y="214" width="88" height="28" rx="4" fill="url(#{u}-wood)" stroke="{INK}" stroke-width="3.5"/>
<path d="M126,214 A24,24 0 0 0 174,214" fill="#1c0606" stroke="{INK}" stroke-width="3"/>
{football(150, 208, 1.05, -8)}
<!-- crossed axes behind -->
<path d="M66,150 l-14,-14 M234,150 l14,-14" stroke="{INK}" stroke-width="3"/>
<!-- drops -->
<path d="M130,170 c-4,8 -4,12 0,14 c4,-2 4,-6 0,-14 Z M170,180 c-3,6 -3,9 0,11 c3,-2 3,-5 0,-11 Z" fill="#ff4a3a" opacity=".85"/>
{ribbon(u, 'GUILLOTINE', 278, '#b3261e', '#6e130e')}'''
    return svg(300, 340, b, 'Guillotine league emblem', d)

def guil_banner():
    u = 'gub'
    d = (lg(f'{u}-sky', [(0, '#12060a'), (.55, '#4a0e12'), (1, '#a3341c')]) +
         rg(f'{u}-moon', [(0, '#ffe0c8'), (.6, '#ff8a5a'), (1, '#ff8a5a00')]) +
         lg(f'{u}-ground', [(0, '#1a0a0a'), (1, '#050203')]) +
         lg(f'{u}-steel', [(0, '#e9edf3'), (1, '#6a7383')], 1, 1))
    crowd = ''.join(f'<ellipse cx="{x}" cy="{470 - (x * 37 % 23)}" rx="{14 + x % 9}" ry="{26 + x % 11}" fill="#0a0405"/>' for x in range(0, 1600, 22))
    lights = ''.join(f'<g transform="translate({x},0)"><path d="M0,500 L8,150 L16,500 Z" fill="#160608"/><rect x="-14" y="132" width="44" height="26" rx="3" fill="#2a0e10" stroke="#3c1214"/>'
                     f'<path d="M-6,145 h28" stroke="#ffd9b0" stroke-width="5" stroke-dasharray="4 4"/><path d="M8,158 L-180,500 L200,500 Z" fill="#ffb27a" opacity=".05"/></g>' for x in (140, 1440))
    b = f'''
<rect width="1600" height="500" fill="url(#{u}-sky)"/>
{stars(70, 7, 1600, 500, 220, '#ffd0c0')}
<circle cx="1180" cy="150" r="170" fill="url(#{u}-moon)" opacity=".55"/>
<circle cx="1180" cy="150" r="62" fill="#ffd9c4" opacity=".9"/>
<path d="M0,330 C200,300 380,320 560,300 C760,280 980,310 1160,296 C1340,282 1480,300 1600,292 L1600,500 L0,500 Z" fill="#240a0c"/>
{lights}
<!-- scaffold -->
<g transform="translate(780,0)">
 <rect x="-150" y="360" width="300" height="34" fill="#2a1410" stroke="#000" stroke-width="3"/>
 <path d="M-150,394 L-150,500 M150,394 L150,500 M-60,394 L-60,500 M60,394 L60,500" stroke="#1a0c08" stroke-width="10"/>
 <path d="M-130,394 L-110,500 M130,394 L110,500" stroke="#1a0c08" stroke-width="5"/>
 <rect x="-62" y="90" width="18" height="272" fill="#3a1e12" stroke="#000" stroke-width="3"/>
 <rect x="44" y="90" width="18" height="272" fill="#3a1e12" stroke="#000" stroke-width="3"/>
 <rect x="-76" y="76" width="152" height="22" fill="#3a1e12" stroke="#000" stroke-width="3"/>
 <path d="M-44,120 L44,120 L44,150 L-44,190 Z" fill="url(#{u}-steel)" stroke="#000" stroke-width="3"/>
 <path d="M-40,186 L40,148" stroke="#fff" stroke-width="2.5" opacity=".8"/>
 <rect x="-54" y="312" width="108" height="24" fill="#3a1e12" stroke="#000" stroke-width="3"/>
 <path d="M-22,312 A22,22 0 0 0 22,312" fill="#0a0405"/>
 <ellipse cx="0" cy="300" rx="200" ry="40" fill="#ff5a3a" opacity=".08"/>
</g>
<!-- goalposts left/right as stadium hint -->
<path d="M300,340 V230 M380,340 V230 M300,300 H380 M340,300 V350" stroke="#2a0c0e" stroke-width="7"/>
<path d="M1260,340 V230 M1340,340 V230 M1260,300 H1340 M1300,300 V350" stroke="#2a0c0e" stroke-width="7"/>
{crowd}
<rect y="440" width="1600" height="60" fill="url(#{u}-ground)"/>
<path d="M0,470 H1600" stroke="#ff4a3a" stroke-opacity=".35" stroke-width="2" stroke-dasharray="18 10"/>'''
    return svg(1600, 500, b, 'Guillotine league banner', d).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ', 1)

def guil_icons():
    blade = svg(64, 64, f'''<rect x="12" y="6" width="8" height="52" rx="2" fill="#8a5a34" stroke="{INK}" stroke-width="2"/><rect x="44" y="6" width="8" height="52" rx="2" fill="#8a5a34" stroke="{INK}" stroke-width="2"/>
<rect x="8" y="4" width="48" height="8" rx="2" fill="#a8693a" stroke="{INK}" stroke-width="2"/>
<path d="M20,16 L44,16 L44,26 L20,36 Z" fill="#c9d0da" stroke="{INK}" stroke-width="2.5" stroke-linejoin="round"/><path d="M22,33 L42,24" stroke="#fff" stroke-width="1.6"/>
<path d="M18,48 h28" stroke="#ff4a3a" stroke-width="3" stroke-dasharray="4 3"/>''', 'Chop')
    zone = svg(64, 64, f'''<circle cx="32" cy="32" r="26" fill="#3a0c0c" stroke="#ff4a3a" stroke-width="3"/><path d="M14,32 h36" stroke="#ff4a3a" stroke-width="3" stroke-dasharray="5 4"/>
<path d="M24,22 l16,0 M24,42 l16,0" stroke="#ffb3a8" stroke-width="2.5" stroke-linecap="round"/><circle cx="32" cy="32" r="5" fill="#ff4a3a"/>''', 'Chop Zone')
    safe = svg(64, 64, f'''<path d="M32,4 L56,12 L54,34 C52,48 42,56 32,60 C22,56 12,48 10,34 L8,12 Z" fill="#1e5a3a" stroke="{INK}" stroke-width="2.5"/><path d="M20,32 l8,8 l16,-16" stroke="#bff3d0" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>''', 'Safe')
    return {'icon-chop.svg': blade, 'icon-zone.svg': zone, 'icon-safe.svg': safe}

# ------------------------------------------------------------------ BIG BROTHER
def bb_emblem():
    u = 'bb'
    d = (lg(f'{u}-bg', [(0, '#0d1b3a'), (1, '#050a18')]) + lg(f'{u}-rim', [(0, '#7ee8ff'), (.5, '#2a8ad8'), (1, '#173a8a')], 1, 1) +
         lg(f'{u}-roof', [(0, '#ff5ec8'), (1, '#9b2ad8')], 1, 0) + lg(f'{u}-wall', [(0, '#e9f2ff'), (1, '#a8bfe0')]) +
         lg(f'{u}-key', [(0, '#fff1b0'), (.5, '#f2c94c'), (1, '#9a6a14')], 1, 1))
    windows = ''.join(f'<rect x="{x}" y="{y}" width="26" height="22" rx="2" fill="#ffe27a" stroke="{INK}" stroke-width="2.5"/><path d="M{x+13},{y} v22 M{x},{y+11} h26" stroke="{INK}" stroke-width="1.5" opacity=".5"/>'
                      for x, y in ((92, 152), (182, 152), (92, 196), (182, 196)))
    b = f'''
<rect x="26" y="20" width="248" height="248" rx="54" fill="url(#{u}-rim)" stroke="{INK}" stroke-width="5"/>
<rect x="40" y="34" width="220" height="220" rx="44" fill="url(#{u}-bg)" stroke="{INK}" stroke-width="3"/>
<path d="M60,240 L240,60" stroke="#7ee8ff" stroke-opacity=".08" stroke-width="40"/>
<g transform="translate(44,40)">{stars(26, 3, 210, 210, 90, '#bfe9ff')}</g>
<!-- spotlights -->
<path d="M70,250 L118,70 L134,74 Z" fill="#7ee8ff" opacity=".18"/><path d="M230,250 L182,70 L166,74 Z" fill="#ff5ec8" opacity=".18"/>
<!-- house -->
<path d="M72,142 L150,82 L228,142 Z" fill="url(#{u}-roof)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
<path d="M88,130 L150,92 L212,130" stroke="#fff" stroke-opacity=".45" stroke-width="3" fill="none"/>
<rect x="80" y="140" width="140" height="96" fill="url(#{u}-wall)" stroke="{INK}" stroke-width="4"/>
{windows}
<rect x="134" y="186" width="32" height="50" rx="3" fill="#1d3a8a" stroke="{INK}" stroke-width="3"/>
<circle cx="159" cy="212" r="2.6" fill="#f2c94c"/>
<rect x="196" y="98" width="14" height="30" fill="#c0c8d8" stroke="{INK}" stroke-width="3"/>
<!-- camera dome -->
<path d="M126,140 a12,8 0 0 1 24,0" fill="#0d1b3a" stroke="{INK}" stroke-width="2.5"/><circle cx="138" cy="137" r="3" fill="#ff3b6b"/>
<!-- key over house -->
<g transform="translate(150,58) rotate(-18)">
 <circle r="18" fill="url(#{u}-key)" stroke="{INK}" stroke-width="3.5"/><circle r="7" fill="url(#{u}-bg)" stroke="{INK}" stroke-width="2.5"/>
 <path d="M16,-4 H62 V4 H56 V12 H48 V4 H40 V10 H32 V4 H16 Z" fill="url(#{u}-key)" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>
</g>
{football(232, 228, .9, 20)}
{ribbon(u, 'BIG BROTHER', 268, '#1d4ed8', '#132f8a')}'''
    return svg(300, 330, b, 'Big Brother league emblem', d)

def bb_banner():
    u = 'bbb'
    d = (lg(f'{u}-sky', [(0, '#050818'), (.6, '#141a4a'), (1, '#2a1650')]) + lg(f'{u}-roof', [(0, '#ff5ec8'), (1, '#7a2ad8')], 1, 0) +
         lg(f'{u}-glass', [(0, '#7ee8ff'), (1, '#1d4ed8')]))
    beams = ''.join(f'<path d="M{x},500 L{x + dx},0 L{x + dx + 60},0 Z" fill="{c}" opacity=".08"/>' for x, dx, c in ((200, 160, '#7ee8ff'), (520, -120, '#ff5ec8'), (1080, 140, '#7ee8ff'), (1400, -160, '#ff5ec8')))
    wins = ''.join(f'<rect x="{x}" y="{y}" width="58" height="44" rx="3" fill="{"#ffe27a" if (x + y) % 3 else "#7ee8ff"}" opacity=".9"/>' for x in range(560, 1040, 80) for y in (250, 320))
    b = f'''
<rect width="1600" height="500" fill="url(#{u}-sky)"/>
{stars(90, 11, 1600, 500, 260, '#cfe6ff')}
{beams}
<path d="M0,380 C300,360 600,372 800,368 C1000,364 1300,372 1600,360 L1600,500 L0,500 Z" fill="#0a0e26"/>
<!-- modern house -->
<path d="M520,220 L800,120 L1080,220 Z" fill="url(#{u}-roof)" stroke="#000" stroke-width="4"/>
<rect x="540" y="220" width="520" height="170" fill="#151c3e" stroke="#000" stroke-width="4"/>
{wins}
<rect x="770" y="300" width="60" height="90" rx="3" fill="url(#{u}-glass)" stroke="#000" stroke-width="3"/>
<rect x="480" y="388" width="640" height="16" fill="#0d1230"/>
<!-- pool -->
<ellipse cx="800" cy="440" rx="260" ry="30" fill="#1d4ed8" opacity=".55"/><ellipse cx="800" cy="440" rx="200" ry="18" fill="#7ee8ff" opacity=".3"/>
<!-- cameras on poles -->
<path d="M300,400 V200 M1300,400 V200" stroke="#0d1230" stroke-width="10"/>
<rect x="282" y="186" width="44" height="26" rx="5" fill="#1a2250" stroke="#000" stroke-width="3"/><circle cx="296" cy="199" r="7" fill="#ff3b6b"/>
<rect x="1274" y="186" width="44" height="26" rx="5" fill="#1a2250" stroke="#000" stroke-width="3"/><circle cx="1304" cy="199" r="7" fill="#ff3b6b"/>
<path d="M0,470 H1600" stroke="#7ee8ff" stroke-opacity=".25" stroke-width="2"/>'''
    return svg(1600, 500, b, 'Big Brother league banner', d).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ', 1)

def bb_icons():
    key = svg(64, 64, f'''<defs>{lg('bk', [(0, '#fff1b0'), (.5, '#f2c94c'), (1, '#9a6a14')], 1, 1)}</defs><g transform="translate(18,32) rotate(-30)"><circle r="12" fill="url(#bk)" stroke="{INK}" stroke-width="2.5"/><circle r="4.5" fill="#0d1b3a"/>
<path d="M11,-3 H44 V3 H40 V9 H34 V3 H28 V8 H22 V3 H11 Z" fill="url(#bk)" stroke="{INK}" stroke-width="2.2" stroke-linejoin="round"/></g>''', 'Head of Household key')
    veto = svg(64, 64, f'''<defs>{lg('bv', [(0, '#e8f6ff'), (.5, '#9fd8f0'), (1, '#3a7aa8')], 1, 1)}</defs><path d="M22,4 L32,22 L42,4" stroke="#1d4ed8" stroke-width="7" fill="none"/><circle cx="32" cy="38" r="22" fill="url(#bv)" stroke="{INK}" stroke-width="3"/>
<circle cx="32" cy="38" r="15" fill="none" stroke="#1d4ed8" stroke-width="3"/><path d="M24,30 L32,48 L40,30" stroke="#0d1b3a" stroke-width="4.5" fill="none" stroke-linejoin="round"/>''', 'Veto medallion')
    door = svg(64, 64, f'''<rect x="14" y="6" width="36" height="54" rx="3" fill="#151c3e" stroke="{INK}" stroke-width="3"/><path d="M20,12 L40,16 V56 L20,58 Z" fill="#ff5ec8" stroke="{INK}" stroke-width="2.5"/><circle cx="35" cy="36" r="2.6" fill="#f2c94c"/>
<path d="M44,34 h14 M52,28 l6,6 -6,6" stroke="#7ee8ff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>''', 'Eviction')
    return {'icon-hoh.svg': key, 'icon-veto.svg': veto, 'icon-evict.svg': door}

# ------------------------------------------------------------------ SURVIVOR GUILLOTINE
def sg_emblem():
    u = 'sg'
    d = (lg(f'{u}-bg', [(0, '#3a1430'), (.6, '#a8402a'), (1, '#f0a050')]) + lg(f'{u}-bam', [(0, '#a8903a'), (.5, '#e0c870'), (1, '#7a6420')], 1, 0) +
         lg(f'{u}-steel', [(0, '#f2f4f8'), (1, '#6a7383')], 1, 1) + rg(f'{u}-fire', [(0, '#fff6c0'), (.5, '#ffb627'), (1, '#e2531b')], '50%', '70%', '60%'))
    def bamboo(x, y, h):
        nodes = ''.join(f'<path d="M{x},{y + k} h18" stroke="{INK}" stroke-width="2.5"/>' for k in range(30, h, 38))
        return f'<rect x="{x}" y="{y}" width="18" height="{h}" rx="5" fill="url(#{u}-bam)" stroke="{INK}" stroke-width="3.5"/>{nodes}'
    b = f'''
<path d="M150,8 C232,8 286,60 286,150 C286,248 220,306 150,322 C80,306 14,248 14,150 C14,60 68,8 150,8 Z" fill="#2a1a10" stroke="{INK}" stroke-width="5"/>
<path d="M150,22 C224,22 272,68 272,150 C272,238 212,290 150,306 C88,290 28,238 28,150 C28,68 76,22 150,22 Z" fill="url(#{u}-bg)" stroke="{INK}" stroke-width="3"/>
<circle cx="150" cy="190" r="56" fill="#ffd27a" opacity=".55"/>
<path d="M28,214 C80,200 120,208 150,204 C190,198 230,206 272,198 L264,240 C230,270 190,292 150,302 C108,292 66,268 36,240 Z" fill="#1a3a4a"/>
<path d="M44,226 c20,-4 40,4 60,0 M170,224 c20,-4 40,4 60,0" stroke="#7fd3de" stroke-width="2.5" opacity=".6" fill="none"/>
<!-- palms -->
<path d="M60,232 C64,190 58,150 46,120" stroke="{INK}" stroke-width="7" fill="none"/>
<path d="M46,120 c-24,-6 -40,6 -44,18 M46,120 c18,-20 40,-20 52,-10 M46,120 c-4,-24 10,-38 24,-40 M46,120 c-24,6 -30,24 -28,36" stroke="#1e3a1a" stroke-width="9" fill="none" stroke-linecap="round"/>
<!-- bamboo guillotine -->
{bamboo(102, 64, 176)}{bamboo(180, 64, 176)}
<rect x="90" y="52" width="120" height="20" rx="6" fill="url(#{u}-bam)" stroke="{INK}" stroke-width="3.5"/>
<path d="M96,62 c-8,-14 2,-24 10,-26 M204,62 c8,-14 -2,-24 -10,-26" stroke="#5a7a2a" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M120,92 L180,92 L180,114 L120,140 Z" fill="url(#{u}-steel)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
<path d="M124,136 L176,112" stroke="#fff" stroke-width="2.5"/>
<path d="M150,72 V92" stroke="#c9a46a" stroke-width="4" stroke-dasharray="3 3"/>
<!-- torches flanking -->
<g transform="translate(76,160)"><rect x="-5" y="0" width="10" height="70" fill="#6b3f1c" stroke="{INK}" stroke-width="2.5"/><path d="M-10,0 h20 l-3,-10 h-14 Z" fill="#3e220c" stroke="{INK}" stroke-width="2.5"/>
<path d="M0,-44 C12,-30 12,-20 6,-12 C4,-18 2,-20 0,-24 C-2,-20 -4,-18 -6,-12 C-12,-20 -12,-30 0,-44 Z" fill="url(#{u}-fire)" stroke="#a8401a" stroke-width="1.8"/></g>
<g transform="translate(224,160)"><rect x="-5" y="0" width="10" height="70" fill="#6b3f1c" stroke="{INK}" stroke-width="2.5"/><path d="M-10,0 h20 l-3,-10 h-14 Z" fill="#3e220c" stroke="{INK}" stroke-width="2.5"/>
<path d="M0,-44 C12,-30 12,-20 6,-12 C4,-18 2,-20 0,-24 C-2,-20 -4,-18 -6,-12 C-12,-20 -12,-30 0,-44 Z" fill="url(#{u}-fire)" stroke="#a8401a" stroke-width="1.8"/></g>
<!-- idol at base -->
<g transform="translate(150,214)"><path d="M-16,-18 h32 v34 h-32 Z" fill="#8a5a2a" stroke="{INK}" stroke-width="3"/><path d="M-12,-8 h8 v5 h-8 Z M4,-8 h8 v5 h-8 Z" fill="#f2c94c"/><path d="M-10,6 h20" stroke="#f2c94c" stroke-width="3"/></g>
{ribbon(u, 'SURVIVOR GUILLOTINE', 280, '#c2571e', '#7a2e0c', w=250)}'''
    return svg(300, 330, b, 'Survivor Guillotine league emblem', d).replace('font-size="17" letter-spacing="2.5"', 'font-size="14.5" letter-spacing="1.5"')

def sg_banner():
    u = 'sgb'
    d = (lg(f'{u}-sky', [(0, '#2a1036'), (.5, '#a8402a'), (1, '#f6b060')]) + rg(f'{u}-sun', [(0, '#fff2c0'), (.5, '#ffb050'), (1, '#ffb05000')]) +
         lg(f'{u}-sea', [(0, '#3a4a6a'), (1, '#0e1424')]) + lg(f'{u}-bam', [(0, '#7a6420'), (.5, '#d6be64'), (1, '#6a5418')], 1, 0))
    palms = ''.join(f'<g transform="translate({x},{y}) scale({s})"><path d="M0,0 C6,-60 0,-120 -14,-170" stroke="#1a0c10" stroke-width="10" fill="none"/>'
                    f'<path d="M-14,-170 c-40,-10 -70,10 -76,30 M-14,-170 c30,-34 70,-34 90,-16 M-14,-170 c-6,-40 16,-64 40,-66 M-14,-170 c-40,10 -52,40 -48,60 M-14,-170 c40,0 60,24 62,46" stroke="#1a0c10" stroke-width="14" fill="none" stroke-linecap="round"/></g>'
                    for x, y, s in ((120, 430, 1.2), (260, 440, .9), (1420, 430, 1.25), (1520, 450, .85)))
    b = f'''
<rect width="1600" height="500" fill="url(#{u}-sky)"/>
<circle cx="800" cy="300" r="260" fill="url(#{u}-sun)" opacity=".8"/><circle cx="800" cy="300" r="90" fill="#ffd890"/>
<rect y="300" width="1600" height="200" fill="url(#{u}-sea)"/>
<path d="M500,330 h600 M560,352 h480 M620,374 h360" stroke="#ffcf80" stroke-width="4" opacity=".5"/>
<path d="M0,420 C300,400 500,410 800,404 C1100,398 1300,410 1600,396 L1600,500 L0,500 Z" fill="#2a1a12"/>
<!-- bamboo guillotine center on beach -->
<g transform="translate(800,0)">
 <rect x="-70" y="170" width="20" height="240" rx="6" fill="url(#{u}-bam)" stroke="#000" stroke-width="3"/>
 <rect x="50" y="170" width="20" height="240" rx="6" fill="url(#{u}-bam)" stroke="#000" stroke-width="3"/>
 <rect x="-86" y="156" width="172" height="22" rx="7" fill="url(#{u}-bam)" stroke="#000" stroke-width="3"/>
 <path d="M-50,198 L50,198 L50,224 L-50,262 Z" fill="#cfd5de" stroke="#000" stroke-width="3"/>
 <path d="M-46,258 L46,222" stroke="#fff" stroke-width="2.5"/>
 <rect x="-60" y="360" width="120" height="24" rx="5" fill="#6b4a1c" stroke="#000" stroke-width="3"/>
</g>
<!-- torches -->
{''.join(f'<g transform="translate({x},330)"><rect x="-6" y="0" width="12" height="100" fill="#3a1e10"/><path d="M0,-50 C14,-34 14,-22 7,-12 C5,-20 2,-22 0,-28 C-2,-22 -5,-20 -7,-12 C-14,-22 -14,-34 0,-50 Z" fill="#ffb627"/></g>' for x in (560, 660, 940, 1040))}
{palms}'''
    return svg(1600, 500, b, 'Survivor Guillotine league banner', d).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ', 1)

def sg_icons():
    save = svg(64, 64, f'''<path d="M18,8 h28 v40 h-28 Z" fill="#8a5a2a" stroke="{INK}" stroke-width="3"/><path d="M22,18 h8 v5 h-8 Z M34,18 h8 v5 h-8 Z" fill="#f2c94c"/><path d="M24,32 h16" stroke="#f2c94c" stroke-width="3"/>
<path d="M8,52 L56,52" stroke="#c9d0da" stroke-width="6"/><path d="M8,52 L56,52" stroke="#ff4a3a" stroke-width="2" stroke-dasharray="4 4"/><path d="M12,44 l40,16" stroke="#7fe0c0" stroke-width="4" stroke-linecap="round"/>''', 'Idol blocks the chop')
    return {'icon-idolsave.svg': save}
