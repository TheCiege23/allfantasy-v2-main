"""Specialty league art, part B: Zombie, Salary Cap, Devy."""
from gen_a import svg, lg, rg, ribbon, football, stars, INK

# ------------------------------------------------------------------ ZOMBIE
def zb_emblem():
    u = 'zb'
    d = (rg(f'{u}-bg', [(0, '#3a6a1a'), (.6, '#16300c'), (1, '#060c04')], '50%', '40%', '70%') + lg(f'{u}-rim', [(0, '#c8f06a'), (.5, '#5a9a2a'), (1, '#2a4a12')], 1, 1) +
         lg(f'{u}-skin', [(0, '#b8d88a'), (1, '#6a8a4a')], 1, 1) + lg(f'{u}-vial', [(0, '#e8fff0'), (1, '#9ad8b0')], 1, 0) + rg(f'{u}-goo', [(0, '#e8ff7a'), (1, '#6ad02a')]))
    drips = ''.join(f'<path d="M{x},{y} c-4,10 -4,{14 + k} 0,{18 + k} c4,-4 4,-8 0,-{18 + k} Z" fill="#9ae03a" stroke="{INK}" stroke-width="1.5"/>' for x, y, k in ((78, 56, 6), (112, 44, 12), (196, 46, 4), (226, 58, 10)))
    b = f'''
<path d="M150,10 L280,62 L268,206 C256,262 210,300 150,320 C90,300 44,262 32,206 L20,62 Z" fill="url(#{u}-rim)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M150,26 L264,72 L253,204 C242,252 202,284 150,302 C98,284 58,252 47,204 L36,72 Z" fill="url(#{u}-bg)" stroke="{INK}" stroke-width="3"/>
<path d="M40,74 C80,40 220,40 260,74" fill="none" stroke="#9ae03a" stroke-width="10" opacity=".9"/>
{drips}
<circle cx="150" cy="150" r="80" fill="none" stroke="#9ae03a" stroke-opacity=".15" stroke-width="22"/>
<!-- cracked ground -->
<path d="M52,232 C100,214 200,214 248,232 L240,250 C200,236 100,236 60,250 Z" fill="#2a1a10" stroke="{INK}" stroke-width="3"/>
<path d="M100,230 l10,10 l-6,8 M190,228 l-8,12 l8,6" stroke="{INK}" stroke-width="2.5" fill="none"/>
<!-- rising hand clutching football -->
<path d="M126,240 L122,176 C120,166 128,160 134,164 L136,150 C134,140 144,136 148,144 L150,138 C150,128 162,128 162,138 L164,146 C166,138 176,140 176,150 L176,170 C180,164 190,168 188,180 L178,212 L172,240 Z" fill="url(#{u}-skin)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
<path d="M136,170 l2,10 M150,160 l0,12 M164,164 l-2,10" stroke="#3a5a2a" stroke-width="2" opacity=".7"/>
<path d="M128,200 c6,4 14,2 18,-4 M150,214 c8,4 16,0 18,-6" stroke="#4a2a1a" stroke-width="2.5" fill="none"/>
<path d="M130,236 l6,-14 l8,10 l6,-12 l6,12 l8,-10 l4,14" stroke="#5a2e1a" stroke-width="5" fill="none" stroke-linejoin="round"/>
{football(150, 120, 1.15, -18)}
<!-- serum vial -->
<g transform="translate(222,170) rotate(16)"><rect x="-10" y="-30" width="20" height="56" rx="8" fill="url(#{u}-vial)" stroke="{INK}" stroke-width="3"/>
<rect x="-8" y="-4" width="16" height="28" rx="6" fill="url(#{u}-goo)"/><rect x="-12" y="-38" width="24" height="10" rx="2" fill="#4a525e" stroke="{INK}" stroke-width="2.5"/></g>
<!-- bat -->
<g transform="translate(78,176) rotate(-28)"><path d="M-6,46 L-4,-30 C-4,-40 6,-40 6,-30 L8,46 Z" fill="#8a5a2a" stroke="{INK}" stroke-width="3"/>
<path d="M-6,-16 l-8,-2 M8,-10 l8,-2 M-5,0 l-9,0 M7,10 l9,1" stroke="#c9d0da" stroke-width="3"/></g>
{ribbon(u, 'ZOMBIE', 276, '#4a8a1a', '#24480a', txt='#eaffd0')}'''
    return svg(300, 336, b, 'Zombie league emblem', d)

def zb_banner():
    u = 'zbb'
    d = (lg(f'{u}-sky', [(0, '#020604'), (.5, '#0e2210'), (1, '#2a4a1a')]) + rg(f'{u}-moon', [(0, '#eaffc0'), (.5, '#9ae03a'), (1, '#9ae03a00')]) +
         lg(f'{u}-fog', [(0, '#9ae03a00'), (1, '#9ae03a55')]))
    figs = ''.join(f'<g transform="translate({x},{420 - (x % 5) * 6}) scale({0.8 + (x % 3) * 0.15})"><path d="M-10,0 L-8,-60 C-20,-58 -34,-62 -46,-70 L-42,-76 C-30,-70 -18,-70 -10,-72 L-10,-82 C-18,-86 -20,-100 -10,-104 C2,-108 10,-98 6,-86 L6,-72 C16,-74 30,-78 44,-90 L48,-84 C36,-70 20,-62 8,-60 L12,0 Z" fill="#050a04"/></g>'
                   for x in range(80, 1600, 130))
    b = f'''
<rect width="1600" height="500" fill="url(#{u}-sky)"/>
{stars(60, 21, 1600, 500, 200, '#d8ffb0')}
<circle cx="420" cy="130" r="180" fill="url(#{u}-moon)" opacity=".5"/><circle cx="420" cy="130" r="58" fill="#e6ffc4"/>
<path d="M392,112 c6,4 10,10 8,18 M440,150 c-6,0 -10,4 -10,10" stroke="#a8c88a" stroke-width="4" fill="none" opacity=".6"/>
<!-- ruined stadium -->
<path d="M700,340 L720,180 L760,200 L780,150 L820,170 L860,130 L900,180 L940,160 L980,210 L1020,190 L1060,240 L1100,340 Z" fill="#0c1a0a" stroke="#000" stroke-width="3"/>
<path d="M740,330 L750,230 M800,330 L810,200 M860,330 L868,180 M920,330 L930,200 M980,330 L990,240 M1040,330 L1048,260" stroke="#1c3214" stroke-width="6"/>
<path d="M1180,340 V170 M1180,170 h60 M1240,170 v-20" stroke="#0c1a0a" stroke-width="10"/><rect x="1218" y="120" width="56" height="30" fill="#0c1a0a"/>
<path d="M0,360 C300,340 600,350 900,344 C1200,338 1400,352 1600,340 L1600,500 L0,500 Z" fill="#081206"/>
{figs}
<rect y="330" width="1600" height="170" fill="url(#{u}-fog)"/>
<path d="M0,460 C200,440 400,470 600,450 C800,430 1000,470 1200,448 C1400,430 1500,460 1600,450" stroke="#9ae03a" stroke-opacity=".25" stroke-width="18" fill="none"/>'''
    return svg(1600, 500, b, 'Zombie league banner', d).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ', 1)

def zb_icons():
    serum = svg(64, 64, f'''<defs>{rg('zs', [(0, '#e8ff7a'), (1, '#4aa01a')])}</defs><g transform="rotate(20 32 32)"><rect x="22" y="12" width="20" height="44" rx="9" fill="#e8fff0" stroke="{INK}" stroke-width="2.5"/>
<rect x="24" y="30" width="16" height="24" rx="7" fill="url(#zs)"/><rect x="19" y="4" width="26" height="10" rx="2" fill="#4a525e" stroke="{INK}" stroke-width="2.5"/><circle cx="30" cy="40" r="2.4" fill="#fff"/></g>''', 'Serum')
    weapon = svg(64, 64, f'''<g transform="rotate(-40 32 32)"><path d="M28,58 L29,10 C29,4 35,4 35,10 L36,58 Z" fill="#8a5a2a" stroke="{INK}" stroke-width="2.5"/>
<path d="M28,20 l-8,-2 M36,26 l8,-2 M28,34 l-8,0 M36,40 l8,1" stroke="#c9d0da" stroke-width="3"/><rect x="27" y="50" width="10" height="10" rx="2" fill="#3a3a3a" stroke="{INK}" stroke-width="2"/></g>''', 'Weapon')
    whisp = svg(64, 64, f'''<path d="M32,4 C48,6 56,22 54,40 L58,60 L6,60 L10,40 C8,22 16,6 32,4 Z" fill="#1a1426" stroke="{INK}" stroke-width="2.5"/><path d="M20,30 C22,18 42,18 44,30 C44,40 38,46 32,46 C26,46 20,40 20,30 Z" fill="#050308"/>
<circle cx="27" cy="32" r="2.6" fill="#9ae03a"/><circle cx="37" cy="32" r="2.6" fill="#9ae03a"/>''', 'Whisperer')
    infect = svg(64, 64, f'''<circle cx="32" cy="32" r="12" fill="#9ae03a" stroke="{INK}" stroke-width="2.5"/>''' + ''.join(
        f'<g transform="rotate({a} 32 32)"><path d="M32,20 V8" stroke="#9ae03a" stroke-width="4"/><circle cx="32" cy="7" r="4.5" fill="#9ae03a" stroke="{INK}" stroke-width="2"/></g>' for a in range(0, 360, 60)) +
        '<circle cx="28" cy="29" r="3" fill="#2a4a12"/><circle cx="36" cy="35" r="2.4" fill="#2a4a12"/>', 'Infection')
    return {'icon-serum.svg': serum, 'icon-weapon.svg': weapon, 'icon-whisperer.svg': whisp, 'icon-infect.svg': infect}

# ------------------------------------------------------------------ SALARY CAP
def sc_emblem():
    u = 'sc'
    d = (lg(f'{u}-bg', [(0, '#0e2a1e'), (1, '#04100a')]) + lg(f'{u}-gold', [(0, '#fff3c4'), (.4, '#e8c66a'), (1, '#8a6420')], 1, 1) +
         lg(f'{u}-coin', [(0, '#f6e08a'), (1, '#b8862b')], 1, 0) + lg(f'{u}-paper', [(0, '#fbf6e8'), (1, '#d8ccb0')]) + lg(f'{u}-green', [(0, '#7ad6a0'), (1, '#1e7a4a')]))
    coins = ''.join(f'<ellipse cx="{x}" cy="{y}" rx="34" ry="10" fill="url(#{u}-coin)" stroke="{INK}" stroke-width="2.5"/><path d="M{x-34},{y} v-8 M{x+34},{y} v-8" stroke="{INK}" stroke-width="2.5"/>'
                    for x, y in [(98, 236 - 12 * i) for i in range(6)] + [(206, 236 - 12 * i) for i in range(4)])
    b = f'''
<path d="M30,30 H270 V210 C270,268 216,306 150,320 C84,306 30,268 30,210 Z" fill="url(#{u}-gold)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M44,44 H256 V208 C256,258 208,290 150,304 C92,290 44,258 44,208 Z" fill="url(#{u}-bg)" stroke="{INK}" stroke-width="3"/>
<path d="M58,180 L100,150 L140,166 L190,110 L240,90" stroke="#7ad6a0" stroke-width="4" fill="none" stroke-linejoin="round" opacity=".55"/>
<path d="M240,90 l-12,-2 l6,10 Z" fill="#7ad6a0" opacity=".55"/>
<!-- cap bar -->
<rect x="62" y="62" width="176" height="16" rx="8" fill="#0a1a12" stroke="#e8c66a" stroke-width="2"/><rect x="64" y="64" width="128" height="12" rx="6" fill="url(#{u}-green)"/><path d="M210,58 v24" stroke="#ff6a4a" stroke-width="3"/>
<!-- coin stacks -->
{coins}
<ellipse cx="98" cy="164" rx="34" ry="10" fill="url(#{u}-coin)" stroke="{INK}" stroke-width="2.5"/><text x="98" y="169" text-anchor="middle" font-family="Archivo Black, Arial Black" font-size="14" fill="#6b4a12">$</text>
<!-- contract -->
<g transform="translate(160,96) rotate(8)"><path d="M0,0 H72 V96 H0 Z" fill="url(#{u}-paper)" stroke="{INK}" stroke-width="3.5"/>
<path d="M10,16 H62 M10,28 H62 M10,40 H50 M10,52 H58" stroke="#8a7a5a" stroke-width="2.5"/><path d="M10,76 C20,66 30,84 40,72 C46,66 52,74 60,70" stroke="#1e3a8a" stroke-width="2.5" fill="none"/>
<circle cx="56" cy="86" r="10" fill="#b3261e" stroke="{INK}" stroke-width="2"/><path d="M50,94 l-4,12 l8,-4 l4,6 l2,-12" fill="#b3261e" stroke="{INK}" stroke-width="1.5"/></g>
<!-- pen -->
<g transform="translate(232,214) rotate(-50)"><rect x="-4" y="-40" width="8" height="54" rx="3" fill="#1a1a2a" stroke="{INK}" stroke-width="2"/><path d="M-4,14 L0,26 L4,14 Z" fill="url(#{u}-gold)" stroke="{INK}" stroke-width="1.5"/></g>
{ribbon(u, 'SALARY CAP', 276, '#1e7a4a', '#0e4a2a')}'''
    return svg(300, 336, b, 'Salary cap league emblem', d)

def sc_banner():
    u = 'scb'
    d = lg(f'{u}-sky', [(0, '#030a08'), (.6, '#0c2a1e'), (1, '#1e4a34')]) + lg(f'{u}-glass', [(0, '#2a5a4a'), (1, '#0a1a14')])
    towers = ''.join(f'<rect x="{x}" y="{y}" width="{w}" height="{500 - y}" fill="url(#{u}-glass)" stroke="#000" stroke-width="2"/>' +
                     ''.join(f'<rect x="{x + 8 + c * 16}" y="{y + 12 + r * 22}" width="8" height="12" fill="#f6e08a" opacity="{0.15 + ((x + r * 7 + c * 3) % 5) * 0.12:.2f}"/>' for r in range((500 - y) // 24) for c in range(max(1, (w - 12) // 16)))
                     for x, y, w in ((60, 160, 120), (200, 220, 90), (310, 120, 140), (470, 200, 100), (1040, 180, 110), (1170, 110, 150), (1340, 210, 100), (1460, 150, 130)))
    ticker = ''.join(f'<text x="{40 + i * 220}" y="476" font-family="JetBrains Mono, monospace" font-size="20" fill="{"#7ad6a0" if i % 3 else "#ff8a6a"}">{t}</text>'
                     for i, t in enumerate(['CAP 250.0', 'SPACE +18.4', 'DEAD -6.0', 'TAG 41.2', 'ROLL +12.0', 'EXT 3Y', 'FA BID 9.5']))
    b = f'''
<rect width="1600" height="500" fill="url(#{u}-sky)"/>
{stars(40, 5, 1600, 500, 140, '#d8ffe8')}
{towers}
<!-- center: big cap gauge -->
<g transform="translate(800,330)">
 <path d="M-230,0 A230,230 0 0 1 230,0" fill="none" stroke="#0a1a14" stroke-width="44"/>
 <path d="M-230,0 A230,230 0 0 1 160,-165" fill="none" stroke="#3aa86a" stroke-width="40"/>
 <path d="M160,-165 A230,230 0 0 1 200,-114" fill="none" stroke="#e8c66a" stroke-width="40"/>
 <path d="M0,0 L150,-120" stroke="#fff3c4" stroke-width="8" stroke-linecap="round"/><circle r="22" fill="#e8c66a" stroke="#000" stroke-width="4"/>
 <text y="70" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="40" font-weight="700" fill="#fff3c4">231.6 / 250</text>
</g>
<rect y="448" width="1600" height="52" fill="#020806" opacity=".9"/><path d="M0,448 H1600" stroke="#e8c66a" stroke-opacity=".4" stroke-width="2"/>
{ticker}'''
    return svg(1600, 500, b, 'Salary cap league banner', d).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ', 1)

def sc_icons():
    contract = svg(64, 64, f'''<path d="M12,4 H44 L54,14 V60 H12 Z" fill="#fbf6e8" stroke="{INK}" stroke-width="2.5"/><path d="M44,4 V14 H54" fill="#d8ccb0" stroke="{INK}" stroke-width="2.5"/>
<path d="M20,22 H46 M20,30 H46 M20,38 H38" stroke="#8a7a5a" stroke-width="2.5"/><path d="M20,50 C26,44 30,54 36,47" stroke="#1e3a8a" stroke-width="2.5" fill="none"/><circle cx="46" cy="50" r="6" fill="#b3261e"/>''', 'Contract')
    gauge = svg(64, 64, f'''<path d="M8,44 A24,24 0 0 1 56,44" fill="none" stroke="#0a1a14" stroke-width="10"/><path d="M8,44 A24,24 0 0 1 48,26" fill="none" stroke="#3aa86a" stroke-width="8"/>
<path d="M32,44 L46,28" stroke="#e8c66a" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="44" r="5" fill="#e8c66a" stroke="{INK}" stroke-width="2"/>''', 'Cap space')
    dead = svg(64, 64, f'''<path d="M6,18 H30 L26,30 L32,40 L28,48 H6 Z" fill="#7ad6a0" stroke="{INK}" stroke-width="2.5" stroke-linejoin="round"/><path d="M58,18 H36 L32,30 L38,40 L34,48 H58 Z" fill="#7ad6a0" stroke="{INK}" stroke-width="2.5" stroke-linejoin="round" transform="rotate(10 46 33)"/>
<circle cx="16" cy="33" r="6" fill="none" stroke="#1e5a3a" stroke-width="2.5"/><path d="M12,54 h40" stroke="#ff6a4a" stroke-width="3"/>''', 'Dead money')
    tag = svg(64, 64, f'''<path d="M30,6 H56 V32 L32,58 L6,32 Z" fill="#e8c66a" stroke="{INK}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="46" cy="16" r="4.5" fill="#04100a"/>
<path d="M18,34 L32,20 M24,40 L38,26" stroke="#6b4a12" stroke-width="3"/>''', 'Franchise tag')
    return {'icon-contract.svg': contract, 'icon-cap.svg': gauge, 'icon-dead.svg': dead, 'icon-tag.svg': tag}

# ------------------------------------------------------------------ DEVY
def dv_emblem():
    u = 'dv'
    d = (lg(f'{u}-bg', [(0, '#13254a'), (1, '#070e1e')]) + lg(f'{u}-rim', [(0, '#ffb36a'), (.5, '#e8701e'), (1, '#8a3a0c')], 1, 1) +
         lg(f'{u}-brick', [(0, '#b8562e'), (1, '#7a2e14')]) + lg(f'{u}-glass', [(0, '#bfe6ff'), (1, '#3a7ab8')], 1, 1))
    bricks = ''.join(f'<path d="M{100 + (r % 2) * 7},{150 + r * 12} h100" stroke="#5a1e0c" stroke-width="1.5" opacity=".6"/>' for r in range(8))
    b = f'''
<circle cx="150" cy="160" r="140" fill="url(#{u}-rim)" stroke="{INK}" stroke-width="5"/>
<circle cx="150" cy="160" r="124" fill="url(#{u}-bg)" stroke="{INK}" stroke-width="3"/>
<circle cx="150" cy="160" r="112" fill="none" stroke="#ffb36a" stroke-width="2" stroke-dasharray="3 7" opacity=".7"/>
{stars(20, 9, 300, 300, 120, '#ffd9b0')}
<!-- bell tower -->
<path d="M120,96 L150,58 L180,96 Z" fill="#e8701e" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>
<rect x="124" y="96" width="52" height="40" fill="url(#{u}-brick)" stroke="{INK}" stroke-width="3.5"/>
<path d="M138,136 v-22 a12,12 0 0 1 24,0 v22" fill="#070e1e" stroke="{INK}" stroke-width="3"/><path d="M150,112 v8" stroke="#ffd27a" stroke-width="5"/>
<rect x="100" y="136" width="100" height="104" fill="url(#{u}-brick)" stroke="{INK}" stroke-width="4"/>
{bricks}
<rect x="114" y="160" width="20" height="28" fill="#ffd27a" stroke="{INK}" stroke-width="2.5"/><rect x="166" y="160" width="20" height="28" fill="#ffd27a" stroke="{INK}" stroke-width="2.5"/>
<path d="M136,240 v-26 a14,14 0 0 1 28,0 v26" fill="#3a1408" stroke="{INK}" stroke-width="3"/>
<!-- pennant -->
<g transform="translate(206,118) rotate(-12)"><path d="M0,0 V90" stroke="#5a3a1a" stroke-width="5"/><path d="M2,4 L70,24 L2,46 Z" fill="#e8701e" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>
<path d="M14,18 l10,8 l-10,8" stroke="#fff3e0" stroke-width="3" fill="none"/></g>
<!-- scouting binoculars -->
<g transform="translate(78,224) rotate(-16)"><rect x="-26" y="-14" width="22" height="34" rx="9" fill="#1a1a2a" stroke="{INK}" stroke-width="3"/><rect x="4" y="-14" width="22" height="34" rx="9" fill="#1a1a2a" stroke="{INK}" stroke-width="3"/>
<rect x="-6" y="-6" width="12" height="12" fill="#3a3a4a" stroke="{INK}" stroke-width="2.5"/><circle cx="-15" cy="16" r="7" fill="url(#{u}-glass)" stroke="{INK}" stroke-width="2"/><circle cx="15" cy="16" r="7" fill="url(#{u}-glass)" stroke="{INK}" stroke-width="2"/></g>
{football(150, 252, .95, 0)}
{ribbon(u, 'DEVY', 270, '#e8701e', '#8a3a0c')}'''
    return svg(300, 320, b, 'Devy league emblem', d)

def dv_banner():
    u = 'dvb'
    d = lg(f'{u}-sky', [(0, '#1a1438'), (.5, '#6a2a4a'), (1, '#e8803a')]) + lg(f'{u}-leaf', [(0, '#e8701e'), (1, '#8a2a0c')])
    trees = ''.join(f'<g transform="translate({x},{y})"><path d="M0,0 V-60" stroke="#2a140a" stroke-width="10"/><circle cy="-80" r="{40 + x % 20}" fill="url(#{u}-leaf)" opacity=".9"/>'
                    f'<circle cx="-26" cy="-60" r="28" fill="#c2501a" opacity=".9"/><circle cx="26" cy="-64" r="30" fill="#d8641e" opacity=".9"/></g>' for x, y in ((80, 430), (220, 450), (1380, 440), (1520, 430)))
    b = f'''
<rect width="1600" height="500" fill="url(#{u}-sky)"/>
<circle cx="1100" cy="300" r="110" fill="#ffc87a" opacity=".55"/>
<!-- college stadium bowl -->
<path d="M420,360 C420,250 1180,250 1180,360 Z" fill="#2a1a2a" stroke="#000" stroke-width="3"/>
<path d="M460,350 C470,280 1130,280 1140,350" stroke="#e8701e" stroke-width="6" fill="none" opacity=".7"/>
<path d="M500,340 C520,300 1080,300 1100,340" stroke="#ffd27a" stroke-width="3" fill="none" stroke-dasharray="10 8" opacity=".6"/>
<!-- bell tower -->
<g transform="translate(300,0)"><path d="M-40,180 L0,110 L40,180 Z" fill="#e8701e" stroke="#000" stroke-width="3"/><rect x="-34" y="180" width="68" height="220" fill="#7a2e14" stroke="#000" stroke-width="3"/>
<path d="M-14,240 v-26 a14,14 0 0 1 28,0 v26" fill="#1a0a04"/><rect x="-20" y="290" width="14" height="22" fill="#ffd27a"/><rect x="6" y="290" width="14" height="22" fill="#ffd27a"/></g>
<path d="M0,380 C300,370 600,380 900,374 C1200,368 1400,380 1600,372 L1600,500 L0,500 Z" fill="#1e2a14"/>
<path d="M560,420 h480" stroke="#fff" stroke-opacity=".25" stroke-width="3" stroke-dasharray="20 14"/>
<!-- pennants string -->
<path d="M560,160 C760,200 840,200 1040,160" stroke="#2a1a2a" stroke-width="2.5" fill="none"/>
{''.join(f'<path d="M{x},{182 + int(18 * (1 - ((x - 800) / 240) ** 2))} l12,26 l12,-26 Z" fill="{c}"/>' for x, c in zip(range(580, 1040, 40), ['#e8701e', '#13254a', '#ffd27a'] * 5))}
{trees}'''
    return svg(1600, 500, b, 'Devy league banner', d).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ', 1)

def dv_icons():
    stash = svg(64, 64, f'''<rect x="8" y="22" width="48" height="34" rx="4" fill="#8a5a2a" stroke="{INK}" stroke-width="2.5"/><path d="M8,30 H56" stroke="{INK}" stroke-width="2.5"/><path d="M14,22 L22,8 H42 L50,22" fill="#a8693a" stroke="{INK}" stroke-width="2.5" stroke-linejoin="round"/>
<rect x="26" y="34" width="12" height="10" rx="2" fill="#e8c66a" stroke="{INK}" stroke-width="2"/>''', 'Devy stash')
    grad = svg(64, 64, f'''<path d="M4,24 L32,12 L60,24 L32,36 Z" fill="#13254a" stroke="{INK}" stroke-width="2.5" stroke-linejoin="round"/><path d="M16,30 V44 C24,52 40,52 48,44 V30" fill="#1e3a6a" stroke="{INK}" stroke-width="2.5"/>
<path d="M56,26 V42" stroke="#e8701e" stroke-width="3"/><circle cx="56" cy="44" r="3.5" fill="#e8701e"/>''', 'Promotion to the pros')
    cls = svg(64, 64, f'''<rect x="6" y="10" width="52" height="44" rx="6" fill="#13254a" stroke="{INK}" stroke-width="2.5"/><text x="32" y="40" text-anchor="middle" font-family="Archivo Black, Arial Black" font-size="18" fill="#ffb36a">'27</text>
<path d="M6,20 H58" stroke="#e8701e" stroke-width="3"/>''', 'Draft class')
    return {'icon-stash.svg': stash, 'icon-promote.svg': grad, 'icon-class.svg': cls}
