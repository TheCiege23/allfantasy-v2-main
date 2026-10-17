"""Specialty league art, part C: C2C, King of the Hill, Pirate + writer."""
import os, sys
from gen_a import svg, lg, rg, ribbon, football, stars, INK
import gen_a, gen_b

# ------------------------------------------------------------------ C2C
def c2_emblem():
    u = 'c2'
    d = (lg(f'{u}-l', [(0, '#13254a'), (1, '#070e1e')]) + lg(f'{u}-r', [(0, '#3a2a10'), (1, '#120c04')]) + lg(f'{u}-rim', [(0, '#fff3c4'), (.5, '#c9a24a'), (1, '#6a4a12')], 1, 1) +
         lg(f'{u}-bronze', [(0, '#f0c890'), (.5, '#b87a3a'), (1, '#6a3a12')], 1, 1) + lg(f'{u}-brick', [(0, '#b8562e'), (1, '#7a2e14')]))
    b = f'''
<path d="M150,10 L278,40 L270,200 C262,262 212,300 150,320 C88,300 38,262 30,200 L22,40 Z" fill="url(#{u}-rim)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<clipPath id="{u}-cl"><path d="M150,26 L262,52 L255,198 C248,252 204,284 150,302 C96,284 52,252 45,198 L38,52 Z"/></clipPath>
<g clip-path="url(#{u}-cl)">
 <rect x="0" y="0" width="150" height="320" fill="url(#{u}-l)"/><rect x="150" y="0" width="150" height="320" fill="url(#{u}-r)"/>
 <!-- campus side: bell tower -->
 <path d="M70,110 L92,80 L114,110 Z" fill="#e8701e" stroke="{INK}" stroke-width="3"/><rect x="74" y="110" width="36" height="110" fill="url(#{u}-brick)" stroke="{INK}" stroke-width="3"/>
 <path d="M84,140 v-14 a8,8 0 0 1 16,0 v14" fill="#070e1e"/><rect x="80" y="170" width="10" height="16" fill="#ffd27a"/><rect x="94" y="170" width="10" height="16" fill="#ffd27a"/>
 <path d="M48,70 l0,40 M48,72 l30,10 l-30,10" stroke="#e8701e" stroke-width="3" fill="#e8701e"/>
 <!-- pro side: columns + bust -->
 <path d="M164,108 L236,108 L230,96 L170,96 Z" fill="url(#{u}-bronze)" stroke="{INK}" stroke-width="3"/>
 <rect x="170" y="108" width="10" height="100" fill="#d8c8a0" stroke="{INK}" stroke-width="2.5"/><rect x="220" y="108" width="10" height="100" fill="#d8c8a0" stroke="{INK}" stroke-width="2.5"/>
 <ellipse cx="200" cy="146" rx="15" ry="19" fill="url(#{u}-bronze)" stroke="{INK}" stroke-width="3"/>
 <path d="M192,162 h16 v8 h-16 Z" fill="url(#{u}-bronze)" stroke="{INK}" stroke-width="2.5"/>
 <path d="M174,198 c0,-16 10,-28 26,-28 c16,0 26,12 26,28 Z" fill="url(#{u}-bronze)" stroke="{INK}" stroke-width="3"/>
 <path d="M192,176 l8,10 l8,-10" stroke="#6a3a12" stroke-width="2" fill="none"/>
 <rect x="178" y="196" width="44" height="12" fill="#6a4a12" stroke="{INK}" stroke-width="2.5"/>
 <!-- the road between -->
 <path d="M60,300 C90,250 120,236 150,226 C180,216 210,206 240,170" stroke="#f2e6c8" stroke-width="16" fill="none"/>
 <path d="M60,300 C90,250 120,236 150,226 C180,216 210,206 240,170" stroke="#2a2a2a" stroke-width="10" fill="none"/>
 <path d="M60,300 C90,250 120,236 150,226 C180,216 210,206 240,170" stroke="#f2c94c" stroke-width="2" fill="none" stroke-dasharray="8 8"/>
</g>
<path d="M150,26 V302" stroke="{INK}" stroke-width="3"/>
{football(150, 228, 1.05, -24)}
<path d="M138,60 h24 l-12,-14 Z" fill="#f2c94c" stroke="{INK}" stroke-width="2"/>
{ribbon(u, 'C2C', 276, '#c9a24a', '#6a4a12', txt='#1a1204')}'''
    return svg(300, 336, b, 'College to Canton league emblem', d)

def c2_banner():
    u = 'c2b'
    d = lg(f'{u}-sky', [(0, '#0a1430'), (.5, '#3a2a5a'), (1, '#e8a04a')], 1, 0) + lg(f'{u}-road', [(0, '#3a3a3a'), (1, '#1a1a1a')])
    b = f'''
<rect width="1600" height="500" fill="url(#{u}-sky)"/>
{stars(50, 31, 700, 500, 240, '#cfe0ff')}
<circle cx="1360" cy="220" r="80" fill="#ffd890" opacity=".7"/>
<!-- campus left -->
<g transform="translate(240,0)"><path d="M-40,190 L0,120 L40,190 Z" fill="#e8701e" stroke="#000" stroke-width="3"/><rect x="-34" y="190" width="68" height="210" fill="#7a2e14" stroke="#000" stroke-width="3"/>
<rect x="-20" y="250" width="14" height="22" fill="#ffd27a"/><rect x="6" y="250" width="14" height="22" fill="#ffd27a"/></g>
<rect x="320" y="260" width="200" height="140" fill="#5a2210" stroke="#000" stroke-width="3"/>{''.join(f'<rect x="{x}" y="{y}" width="18" height="24" fill="#ffd27a" opacity=".8"/>' for x in range(336, 510, 34) for y in (280, 330))}
<!-- pro stadium right -->
<path d="M1000,400 L1020,240 C1120,200 1360,200 1460,240 L1480,400 Z" fill="#1a1408" stroke="#000" stroke-width="3"/>
<path d="M1030,250 C1130,214 1350,214 1450,250" stroke="#c9a24a" stroke-width="6" fill="none"/>
{''.join(f'<path d="M{x},240 V170" stroke="#1a1408" stroke-width="6"/><rect x="{x - 18}" y="156" width="36" height="16" fill="#2a2010"/><path d="M{x - 12},164 h24" stroke="#fff3c4" stroke-width="4" stroke-dasharray="3 3"/>' for x in (1060, 1420))}
<!-- columns hall -->
<g transform="translate(760,0)"><path d="M-110,250 L110,250 L90,226 L-90,226 Z" fill="#b87a3a" stroke="#000" stroke-width="3"/>
{''.join(f'<rect x="{x}" y="250" width="16" height="150" fill="#d8c8a0" stroke="#000" stroke-width="2.5"/>' for x in (-96, -56, -16, 24, 64))}
<rect x="-118" y="398" width="236" height="14" fill="#6a4a12"/></g>
<!-- road -->
<path d="M0,500 C200,440 420,430 760,424 C1100,418 1300,430 1600,400 L1600,500 Z" fill="url(#{u}-road)"/>
<path d="M0,480 C220,444 440,438 760,432 C1080,426 1300,434 1600,410" stroke="#f2c94c" stroke-width="4" fill="none" stroke-dasharray="26 18"/>'''
    return svg(1600, 500, b, 'College to Canton league banner', d).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ', 1)

def c2_icons():
    campus = svg(64, 64, f'''<path d="M18,22 L32,8 L46,22 Z" fill="#e8701e" stroke="{INK}" stroke-width="2.5"/><rect x="20" y="22" width="24" height="34" fill="#b8562e" stroke="{INK}" stroke-width="2.5"/><path d="M28,56 v-10 a4,4 0 0 1 8,0 v10" fill="#3a1408"/>
<rect x="24" y="28" width="6" height="8" fill="#ffd27a"/><rect x="34" y="28" width="6" height="8" fill="#ffd27a"/>''', 'Campus lineup')
    pro = svg(64, 64, f'''<path d="M10,22 L54,22 L48,14 L16,14 Z" fill="#b87a3a" stroke="{INK}" stroke-width="2.5"/>{''.join(f'<rect x="{x}" y="22" width="7" height="30" fill="#d8c8a0" stroke="{INK}" stroke-width="2"/>' for x in (14, 28.5, 43))}
<rect x="8" y="52" width="48" height="6" fill="#6a4a12" stroke="{INK}" stroke-width="2"/>''', 'Pro lineup')
    return {'icon-campus.svg': campus, 'icon-pro.svg': pro}

# ------------------------------------------------------------------ KING OF THE HILL
def kh_emblem():
    u = 'kh'
    d = (lg(f'{u}-bg', [(0, '#2a1450'), (.6, '#5a2a7a'), (1, '#e8a04a')]) + lg(f'{u}-rim', [(0, '#fff3c4'), (.5, '#e8c66a'), (1, '#8a6420')], 1, 1) +
         lg(f'{u}-hill', [(0, '#3a6a3a'), (1, '#1a3a1a')]) + lg(f'{u}-crown', [(0, '#fff6c8'), (.4, '#f2c94c'), (1, '#9a6a14')], 1, 1) + rg(f'{u}-gem', [(0, '#ffc0d8'), (1, '#b3164a')]))
    b = f'''
<path d="M150,8 L184,30 L224,22 L240,58 L278,76 L266,114 L282,152 L256,182 L258,222 L220,236 L200,272 L160,268 L150,300 L140,268 L100,272 L80,236 L42,222 L44,182 L18,152 L34,114 L22,76 L60,58 L76,22 L116,30 Z" fill="url(#{u}-rim)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<circle cx="150" cy="152" r="112" fill="url(#{u}-bg)" stroke="{INK}" stroke-width="3"/>
<clipPath id="{u}-cl"><circle cx="150" cy="152" r="110"/></clipPath>
<g clip-path="url(#{u}-cl)">
 {''.join(f'<path d="M150,140 L{150 + 220 * __import__("math").cos(a / 57.3):.0f},{140 + 220 * __import__("math").sin(a / 57.3):.0f}" stroke="#ffe7a3" stroke-width="10" opacity=".12"/>' for a in range(180, 361, 20))}
 <path d="M20,262 C70,232 100,196 150,150 C200,196 230,232 280,262 Z" fill="url(#{u}-hill)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
 <path d="M150,150 L134,176 L150,170 L164,184 Z" fill="#f2f2f2" opacity=".85"/>
 <path d="M66,240 l20,-10 M100,214 l16,-8 M190,214 l18,8 M226,236 l18,8" stroke="#6aa86a" stroke-width="3" opacity=".7"/>
 <!-- challengers climbing (silhouettes) -->
 <path d="M84,236 c0,-10 6,-16 10,-16 c4,0 6,6 4,10 l6,10 Z M214,226 c0,-10 -6,-16 -10,-16 c-4,0 -6,6 -4,10 l-6,10 Z" fill="#0e1a0e"/>
</g>
<!-- flag pole + crown -->
<path d="M150,150 V92" stroke="{INK}" stroke-width="5"/><path d="M152,94 L196,104 L152,116 Z" fill="#b3164a" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>
<g transform="translate(150,72)">
 <path d="M-44,10 L-50,-30 L-24,-8 L0,-40 L24,-8 L50,-30 L44,10 Z" fill="url(#{u}-crown)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
 <rect x="-46" y="8" width="92" height="16" rx="3" fill="url(#{u}-crown)" stroke="{INK}" stroke-width="4"/>
 <circle cx="0" cy="16" r="5" fill="url(#{u}-gem)" stroke="{INK}" stroke-width="2"/><circle cx="-26" cy="16" r="4" fill="#3a7ad8" stroke="{INK}" stroke-width="2"/><circle cx="26" cy="16" r="4" fill="#3a7ad8" stroke="{INK}" stroke-width="2"/>
 <circle cx="-50" cy="-32" r="5" fill="url(#{u}-crown)" stroke="{INK}" stroke-width="2.5"/><circle cx="0" cy="-42" r="5" fill="url(#{u}-crown)" stroke="{INK}" stroke-width="2.5"/><circle cx="50" cy="-32" r="5" fill="url(#{u}-crown)" stroke="{INK}" stroke-width="2.5"/>
</g>
{football(150, 160, .8, 0)}
{ribbon(u, 'KING OF THE HILL', 264, '#7a2ad8', '#3e1478', w=240)}'''
    return svg(300, 310, b, 'King of the Hill league emblem', d).replace('font-size="17" letter-spacing="2.5"', 'font-size="15" letter-spacing="1.5"')

def kh_banner():
    u = 'khb'
    d = lg(f'{u}-sky', [(0, '#1a0a3a'), (.5, '#7a2a6a'), (1, '#f6a050')]) + rg(f'{u}-sun', [(0, '#fff2c0'), (.5, '#ffc070'), (1, '#ffc07000')]) + lg(f'{u}-hill', [(0, '#2a4a2a'), (1, '#0e1a0e')])
    b = f'''
<rect width="1600" height="500" fill="url(#{u}-sky)"/>
<circle cx="800" cy="200" r="300" fill="url(#{u}-sun)" opacity=".7"/>
{stars(40, 41, 1600, 500, 160, '#ffe7c0')}
<path d="M0,420 C200,360 400,380 560,330 C640,300 720,180 800,110 C880,180 960,300 1040,330 C1200,380 1400,360 1600,420 L1600,500 L0,500 Z" fill="url(#{u}-hill)" stroke="#000" stroke-width="3"/>
<path d="M800,110 L770,170 L800,156 L826,182 Z" fill="#f2f2f2" opacity=".8"/>
<path d="M300,420 C400,400 500,380 600,370 M1000,370 C1100,380 1200,400 1300,420" stroke="#4a7a4a" stroke-width="3" fill="none" opacity=".6"/>
<!-- throne at top -->
<g transform="translate(800,110)"><rect x="-26" y="-60" width="52" height="60" rx="6" fill="#7a2ad8" stroke="#000" stroke-width="3"/><rect x="-34" y="-20" width="68" height="22" rx="4" fill="#5a1aa8" stroke="#000" stroke-width="3"/>
<path d="M-22,-60 L-26,-80 L-12,-68 L0,-86 L12,-68 L26,-80 L22,-60 Z" fill="#f2c94c" stroke="#000" stroke-width="3"/></g>
<!-- banners on the slope -->
{''.join(f'<g transform="translate({x},{y})"><path d="M0,0 V-60" stroke="#1a0a0a" stroke-width="4"/><path d="M2,-58 L36,-48 L2,-38 Z" fill="{c}"/></g>' for x, y, c in ((520, 340, '#b3164a'), (640, 260, '#3a7ad8'), (960, 260, '#e8701e'), (1080, 340, '#2a8a5a')))}
<!-- climbers -->
{''.join(f'<g transform="translate({x},{y}) scale(.9)"><circle cy="-30" r="8" fill="#0a0a0a"/><path d="M-8,-20 L8,-20 L10,4 L-10,4 Z M-8,4 L-12,22 M8,4 L14,20 M-8,-16 L-20,-26 M8,-16 L18,-28" stroke="#0a0a0a" stroke-width="6" fill="#0a0a0a"/></g>' for x, y in ((420, 390), (700, 230), (930, 250), (1200, 390)))}'''
    return svg(1600, 500, b, 'King of the Hill league banner', d).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ', 1)

def kh_icons():
    crown = svg(64, 64, f'''<defs>{lg('khc', [(0, '#fff6c8'), (.4, '#f2c94c'), (1, '#9a6a14')], 1, 1)}</defs><path d="M8,44 L4,16 L20,30 L32,10 L44,30 L60,16 L56,44 Z" fill="url(#khc)" stroke="{INK}" stroke-width="2.5" stroke-linejoin="round"/>
<rect x="8" y="44" width="48" height="10" rx="2" fill="url(#khc)" stroke="{INK}" stroke-width="2.5"/><circle cx="32" cy="49" r="3.4" fill="#b3164a"/>''', 'Crown')
    sword = svg(64, 64, f'''<g transform="rotate(45 32 32)"><path d="M29,4 L35,4 L35,42 L32,48 L29,42 Z" fill="#dfe4ec" stroke="{INK}" stroke-width="2.2"/><rect x="20" y="42" width="24" height="6" rx="2" fill="#f2c94c" stroke="{INK}" stroke-width="2"/>
<rect x="29" y="48" width="6" height="12" fill="#5a2a1a" stroke="{INK}" stroke-width="2"/></g>''', 'Challenge')
    hold = svg(64, 64, f'''<path d="M32,4 L56,12 L54,34 C52,48 42,56 32,60 C22,56 12,48 10,34 L8,12 Z" fill="#5a1aa8" stroke="{INK}" stroke-width="2.5"/><path d="M18,36 L16,22 L24,28 L32,16 L40,28 L48,22 L46,36 Z" fill="#f2c94c" stroke="{INK}" stroke-width="2"/>''', 'Crown defended')
    return {'icon-crown.svg': crown, 'icon-challenge.svg': sword, 'icon-defend.svg': hold}

# ------------------------------------------------------------------ PIRATE
def pr_emblem():
    u = 'pr'
    d = (lg(f'{u}-bg', [(0, '#0e1e3a'), (1, '#040a16')]) + lg(f'{u}-rim', [(0, '#e8c66a'), (.5, '#8a5a2a'), (1, '#3a220c')], 1, 1) +
         lg(f'{u}-bone', [(0, '#fbf4e2'), (1, '#c9b48a')]) + lg(f'{u}-steel', [(0, '#f2f4f8'), (1, '#7a8494')], 1, 1) + lg(f'{u}-gold', [(0, '#fff3c4'), (.5, '#e8c66a'), (1, '#8a6420')], 1, 1))
    rope = ''.join(f'<path d="M{150 + 128 * __import__("math").cos(a / 57.3):.1f},{158 + 128 * __import__("math").sin(a / 57.3):.1f} l6,6" stroke="#5a3a1a" stroke-width="3"/>' for a in range(0, 360, 12))
    b = f'''
<circle cx="150" cy="158" r="140" fill="url(#{u}-rim)" stroke="{INK}" stroke-width="5"/>
<circle cx="150" cy="158" r="122" fill="url(#{u}-bg)" stroke="{INK}" stroke-width="3"/>
{rope}
<path d="M38,214 C80,200 110,216 150,206 C190,196 220,212 262,200 L250,240 C210,262 90,262 50,240 Z" fill="#1a3a6a" opacity=".8"/>
<path d="M54,226 c20,-6 30,4 50,-2 M150,222 c22,-6 34,4 56,-2" stroke="#7ab8e8" stroke-width="2.5" fill="none" opacity=".6"/>
<!-- crossed cutlasses -->
<g transform="translate(150,150) rotate(38)"><path d="M-4,-110 C14,-80 14,-20 4,40 L-6,40 C0,-20 0,-70 -12,-104 Z" fill="url(#{u}-steel)" stroke="{INK}" stroke-width="3"/><path d="M-16,40 h28 l-2,8 h-24 Z" fill="url(#{u}-gold)" stroke="{INK}" stroke-width="2.5"/><rect x="-5" y="48" width="10" height="22" fill="#3a220c" stroke="{INK}" stroke-width="2.5"/></g>
<g transform="translate(150,150) rotate(-38) scale(-1,1)"><path d="M-4,-110 C14,-80 14,-20 4,40 L-6,40 C0,-20 0,-70 -12,-104 Z" fill="url(#{u}-steel)" stroke="{INK}" stroke-width="3"/><path d="M-16,40 h28 l-2,8 h-24 Z" fill="url(#{u}-gold)" stroke="{INK}" stroke-width="2.5"/><rect x="-5" y="48" width="10" height="22" fill="#3a220c" stroke="{INK}" stroke-width="2.5"/></g>
<!-- skull -->
<path d="M150,92 C186,92 204,112 202,140 C200,158 190,166 184,172 L184,190 L116,190 L116,172 C110,166 100,158 98,138 C96,108 114,84 150,84 Z" fill="url(#{u}-bone)" stroke="{INK}" stroke-width="4"/>
<path d="M124,124 C124,112 144,110 144,126 C144,140 124,140 124,124 Z M156,126 C156,110 176,112 176,124 C176,140 156,140 156,126 Z" fill="{INK}"/>
<path d="M150,140 l-7,14 h14 Z" fill="{INK}"/>
<path d="M124,190 V176 M137,190 V176 M150,190 V176 M163,190 V176 M176,190 V176" stroke="{INK}" stroke-width="3"/>
<!-- tricorn -->
<path d="M78,104 C84,58 122,40 150,40 C178,40 216,58 222,104 C202,92 178,86 150,90 C122,86 98,92 78,104 Z" fill="#1a1426" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
<path d="M90,98 C110,84 130,80 150,82 C170,80 190,84 210,98" stroke="url(#{u}-gold)" stroke-width="4" fill="none"/>
<path d="M150,50 c-10,4 -12,14 -6,22 c4,-6 8,-8 12,-8 c4,0 8,2 12,8 c6,-8 4,-18 -6,-22 c-4,2 -8,2 -12,0 Z" fill="url(#{u}-bone)" stroke="{INK}" stroke-width="2"/>
<!-- doubloons + football -->
<circle cx="96" cy="222" r="14" fill="url(#{u}-gold)" stroke="{INK}" stroke-width="3"/><circle cx="116" cy="230" r="12" fill="url(#{u}-gold)" stroke="{INK}" stroke-width="3"/>
{football(198, 222, .95, 18)}
{ribbon(u, 'PIRATE', 268, '#b3261e', '#6e130e')}'''
    return svg(300, 320, b, 'Pirate league emblem', d)

def pr_banner():
    u = 'prb'
    d = lg(f'{u}-sky', [(0, '#030814'), (.6, '#0e1e3a'), (1, '#1e3a5a')]) + rg(f'{u}-moon', [(0, '#fff8e0'), (.5, '#e8d8a0'), (1, '#e8d8a000')]) + lg(f'{u}-sea', [(0, '#0e2a4a'), (1, '#020814')])
    waves = ''.join(f'<path d="M0,{y} ' + ' '.join(f'Q{x + 40},{y - 14} {x + 80},{y}' for x in range(0, 1600, 80)) + f'" stroke="#3a7ab8" stroke-opacity="{0.15 + i * 0.06:.2f}" stroke-width="3" fill="none"/>' for i, y in enumerate((360, 400, 440, 480)))
    b = f'''
<rect width="1600" height="500" fill="url(#{u}-sky)"/>
{stars(110, 51, 1600, 500, 300, '#fff6e0')}
<circle cx="1240" cy="130" r="160" fill="url(#{u}-moon)" opacity=".5"/><circle cx="1240" cy="130" r="56" fill="#fff4d8"/>
<rect y="330" width="1600" height="170" fill="url(#{u}-sea)"/>
<path d="M1180,340 h120 M1200,360 h80" stroke="#fff4d8" stroke-width="4" opacity=".35"/>
<!-- ship -->
<g transform="translate(700,0)">
 <path d="M-230,330 L230,330 L190,400 L-200,400 Z" fill="#2a1408" stroke="#000" stroke-width="4"/>
 <path d="M-220,346 H216" stroke="#e8c66a" stroke-width="3"/>{''.join(f'<circle cx="{x}" cy="366" r="6" fill="#0a0604" stroke="#e8c66a" stroke-width="2"/>' for x in range(-160, 180, 50))}
 <path d="M-230,330 L-260,300 L-210,316 Z" fill="#2a1408" stroke="#000" stroke-width="3"/>
 <path d="M-60,330 V60 M60,330 V100 M-160,330 V150" stroke="#1a0c04" stroke-width="9"/>
 <path d="M-140,80 C-80,100 -40,100 20,80 L24,200 C-30,214 -90,214 -144,200 Z" fill="#e8dcc0" stroke="#000" stroke-width="3"/>
 <path d="M-20,120 C30,136 70,136 110,120 L112,220 C70,232 30,232 -18,220 Z" fill="#d8ccb0" stroke="#000" stroke-width="3"/>
 <path d="M-210,170 C-180,180 -160,180 -130,170 L-130,250 C-160,260 -180,260 -210,250 Z" fill="#d8ccb0" stroke="#000" stroke-width="3"/>
 <path d="M-60,60 L-10,48 L-10,72 Z" fill="#0a0a0a"/><circle cx="-34" cy="60" r="6" fill="#f2f2f2"/>
 <circle cx="-56" cy="146" r="20" fill="#0a0a0a" opacity=".85"/><path d="M-68,134 l24,24 M-44,134 l-24,24" stroke="#f2f2f2" stroke-width="3.5" opacity=".85"/><circle cx="-56" cy="140" r="6" fill="#f2f2f2" opacity=".85"/>
</g>
<!-- treasure island -->
<path d="M1300,350 C1340,320 1440,320 1480,350 Z" fill="#c9a46a"/><path d="M1400,330 C1404,300 1398,280 1386,264" stroke="#1a0c04" stroke-width="5" fill="none"/>
<path d="M1386,264 c-20,-4 -32,4 -36,12 M1386,264 c14,-16 34,-16 44,-8 M1386,264 c-2,-18 8,-28 18,-30" stroke="#1a3a1a" stroke-width="8" fill="none" stroke-linecap="round"/>
<path d="M1420,340 l10,-10 M1420,330 l10,10" stroke="#b3261e" stroke-width="4"/>
{waves}'''
    return svg(1600, 500, b, 'Pirate league banner', d).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ', 1)

def pr_icons():
    coin = svg(64, 64, f'''<defs>{lg('prc', [(0, '#fff3c4'), (.5, '#e8c66a'), (1, '#8a6420')], 1, 1)}</defs><circle cx="32" cy="32" r="26" fill="url(#prc)" stroke="{INK}" stroke-width="3"/><circle cx="32" cy="32" r="19" fill="none" stroke="#8a6420" stroke-width="2"/>
<path d="M24,22 L40,42 M40,22 L24,42" stroke="#6b4a12" stroke-width="3.5"/><circle cx="32" cy="32" r="4" fill="#6b4a12"/>''', 'Doubloon')
    hook = svg(64, 64, f'''<path d="M40,6 V30 C40,44 30,52 20,48 C12,44 12,34 18,30" stroke="#c9d0da" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M40,6 V30 C40,44 30,52 20,48 C12,44 12,34 18,30" stroke="{INK}" stroke-width="2" fill="none"/>
<rect x="30" y="2" width="20" height="10" rx="3" fill="#5a3a1a" stroke="{INK}" stroke-width="2"/><path d="M14,58 L44,58" stroke="#e8c66a" stroke-width="3"/>''', 'Plunder')
    plank = svg(64, 64, f'''<path d="M4,40 L60,30 L60,38 L4,48 Z" fill="#8a5a2a" stroke="{INK}" stroke-width="2.5"/><path d="M14,46 V60 M20,45 V60" stroke="#5a3a1a" stroke-width="3"/>
<path d="M46,26 c0,-8 4,-12 8,-12 c4,0 6,4 4,8 l4,6" stroke="{INK}" stroke-width="3" fill="#1a1426"/><path d="M0,58 Q16,52 32,58 T64,58" stroke="#3a7ab8" stroke-width="3" fill="none"/>''', 'Walk the plank')
    return {'icon-doubloon.svg': coin, 'icon-plunder.svg': hook, 'icon-plank.svg': plank}

ALL = {
    'guillotine': (gen_a.guil_emblem, gen_a.guil_banner, gen_a.guil_icons),
    'bigbrother': (gen_a.bb_emblem, gen_a.bb_banner, gen_a.bb_icons),
    'survguil': (gen_a.sg_emblem, gen_a.sg_banner, lambda: {**gen_a.sg_icons(), **gen_a.guil_icons()}),
    'zombie': (gen_b.zb_emblem, gen_b.zb_banner, gen_b.zb_icons),
    'salary': (gen_b.sc_emblem, gen_b.sc_banner, gen_b.sc_icons),
    'devy': (gen_b.dv_emblem, gen_b.dv_banner, gen_b.dv_icons),
    'c2c': (c2_emblem, c2_banner, lambda: {**c2_icons(), **gen_b.dv_icons()}),
    'koth': (kh_emblem, kh_banner, kh_icons),
    'pirate': (pr_emblem, pr_banner, pr_icons),
}

if __name__ == '__main__':
    out = sys.argv[1]
    n = 0
    for k, (e, bnr, ic) in ALL.items():
        os.makedirs(f'{out}/{k}', exist_ok=True)
        open(f'{out}/{k}/emblem.svg', 'w').write(e()); open(f'{out}/{k}/banner.svg', 'w').write(bnr())
        for f, s in ic().items():
            open(f'{out}/{k}/{f}', 'w').write(s); n += 1
        n += 2
    print('wrote', n)
