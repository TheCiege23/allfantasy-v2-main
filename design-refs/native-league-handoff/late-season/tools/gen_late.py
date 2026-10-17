#!/usr/bin/env python3
"""Mid/late-season Survivor assets: tribe buffs, merge banner, jury bench (+icon),
champion trophy (+icon), Exile boss mask (+icon). All ids are prefixed per file so
several can sit inline on one page."""
import os, math, sys
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'assets'); os.makedirs(OUT, exist_ok=True)
INK = '#1a0f06'

def shade(h, f):
    h = h.lstrip('#'); r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    if f < 0: r, g, b = (int(c * (1 + f)) for c in (r, g, b))
    else: r, g, b = (int(c + (255 - c) * f) for c in (r, g, b))
    return '#%02x%02x%02x' % (r, g, b)

# ---------------------------------------------------------------- buff
def buff(p, s, uid):
    """Tribe buff: a tube of patterned cloth tied as a headband, seen front-on with
    the knot and two tails. p = tribe primary, s = secondary."""
    pd, pl, sd = shade(p, -.45), shade(p, .25), shade(s, -.3)
    # zig-zag + diamond band pattern across the cloth
    zig = ' '.join(f'L{20 + i * 10},{98 + (6 if i % 2 else -6)}' for i in range(1, 22))
    dia = ''.join(f'<path d="M{34 + i * 26},112 l7,-8 l7,8 l-7,8 Z" fill="{s}" stroke="{pd}" stroke-width="1.2"/>' for i in range(7))
    dots = ''.join(f'<circle cx="{40 + i * 26}" cy="88" r="2.4" fill="{s}"/><circle cx="{40 + i * 26}" cy="134" r="2.4" fill="{s}"/>' for i in range(7))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 200" width="260" height="200" role="img" aria-label="Tribe buff">
<defs>
<linearGradient id="{uid}-c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{pl}"/><stop offset=".45" stop-color="{p}"/><stop offset="1" stop-color="{pd}"/></linearGradient>
<linearGradient id="{uid}-sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".18" stop-color="#000" stop-opacity="0"/><stop offset=".82" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
<clipPath id="{uid}-k"><path d="M20,78 C80,66 180,66 240,78 L240,146 C180,134 80,134 20,146 Z"/></clipPath>
</defs>
<ellipse cx="130" cy="186" rx="96" ry="8" fill="#000" opacity=".35"/>
<path d="M196,124 C214,150 222,168 236,182 L214,186 C206,168 196,150 186,132 Z" fill="{pd}" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>
<path d="M200,126 C222,146 238,158 254,166 L240,182 C226,170 210,154 192,136 Z" fill="url(#{uid}-c)" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>
<path d="M246,168 l-6,10 M238,162 l-8,10" stroke="{s}" stroke-width="2"/>
<g clip-path="url(#{uid}-k)">
  <rect x="0" y="60" width="260" height="100" fill="url(#{uid}-c)"/>
  <path d="M20,98 {zig}" fill="none" stroke="{s}" stroke-width="3" stroke-linejoin="round"/>
  {dia}{dots}
  <path d="M20,124 C80,114 180,114 240,124" stroke="{sd}" stroke-width="1.5" fill="none" opacity=".7"/>
  <path d="M30,84 C70,74 120,72 150,74" stroke="#fff" stroke-width="5" fill="none" opacity=".25" stroke-linecap="round"/>
  <rect x="0" y="60" width="260" height="100" fill="url(#{uid}-sh)"/>
  <path d="M70,70 C74,100 72,120 66,140 M130,68 C134,100 132,120 128,134 M190,70 C194,100 190,120 186,140" stroke="#000" stroke-width="2" opacity=".14" fill="none"/>
</g>
<path d="M20,78 C80,66 180,66 240,78 L240,146 C180,134 80,134 20,146 Z" fill="none" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
<path d="M176,98 C188,88 206,88 212,104 C218,120 204,134 188,130 C176,126 170,110 176,98 Z" fill="url(#{uid}-c)" stroke="{INK}" stroke-width="3.5"/>
<path d="M184,104 C192,98 202,100 204,110" stroke="{s}" stroke-width="2.5" fill="none"/>
</svg>'''

BUFFS = {  # tribe id: (primary, secondary) from tribes.json
    'kaniva': ('#e2563b', '#f2b33d'),
    'koa': ('#3fa7b5', '#e8eef2'),
    'honoa': ('#3f9e5f', '#d9b45a'),
    'vela': ('#8b7be0', '#f2c94c'),
    'merge': ('#d9b45a', '#1b2a4a'),
}

# ---------------------------------------------------------------- merge banner
def merge_banner():
    u = 'mb'
    weave = ''.join(f'<path d="M{70 + i * 20},64 l10,12 l10,-12" fill="none" stroke="#1b2a4a" stroke-width="3" opacity=".55"/>' for i in range(5))
    fringe = ''.join(f'<path d="M{64 + i * 8},246 l{(i % 3) - 1},18" stroke="#b8862b" stroke-width="3" stroke-linecap="round"/>' for i in range(15))
    shells = ''.join(f'<path d="M{70 + i * 25},236 c-6,0 -8,8 0,12 c8,-4 6,-12 0,-12 Z" fill="#f3ead6" stroke="{INK}" stroke-width="1.4"/>' for i in range(5))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 320" width="260" height="320" role="img" aria-label="Merged tribe banner">
<defs>
<linearGradient id="{u}-cl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1d58a"/><stop offset=".5" stop-color="#d9b45a"/><stop offset="1" stop-color="#8a6420"/></linearGradient>
<linearGradient id="{u}-bb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5a4214"/><stop offset=".4" stop-color="#c9a65a"/><stop offset="1" stop-color="#5a4214"/></linearGradient>
<radialGradient id="{u}-md" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#2c3f6a"/><stop offset="1" stop-color="#0f1a30"/></radialGradient>
<radialGradient id="{u}-fl" cx="50%" cy="70%" r="60%"><stop offset="0" stop-color="#fff3b0"/><stop offset=".45" stop-color="#ffb627"/><stop offset="1" stop-color="#e2531b" stop-opacity="0"/></radialGradient>
</defs>
<ellipse cx="130" cy="306" rx="100" ry="9" fill="#000" opacity=".35"/>
<!-- crossed torches behind -->
<g transform="rotate(-24 130 230)"><rect x="124" y="60" width="12" height="236" rx="4" fill="url(#{u}-bb)" stroke="{INK}" stroke-width="3"/>
 <path d="M118,60 h24 l-4,-14 h-16 Z" fill="#6b4a1a" stroke="{INK}" stroke-width="3"/>
 <path d="M130,6 C146,22 148,36 140,46 C136,38 132,36 130,30 C128,36 124,38 120,46 C112,36 114,22 130,6 Z" fill="url(#{u}-fl)" stroke="#a8401a" stroke-width="2"/></g>
<g transform="rotate(24 130 230)"><rect x="124" y="60" width="12" height="236" rx="4" fill="url(#{u}-bb)" stroke="{INK}" stroke-width="3"/>
 <path d="M118,60 h24 l-4,-14 h-16 Z" fill="#6b4a1a" stroke="{INK}" stroke-width="3"/>
 <path d="M130,6 C146,22 148,36 140,46 C136,38 132,36 130,30 C128,36 124,38 120,46 C112,36 114,22 130,6 Z" fill="url(#{u}-fl)" stroke="#a8401a" stroke-width="2"/></g>
<!-- crossbar -->
<rect x="42" y="50" width="176" height="14" rx="6" fill="url(#{u}-bb)" stroke="{INK}" stroke-width="3"/>
<circle cx="42" cy="57" r="9" fill="#6b4a1a" stroke="{INK}" stroke-width="3"/><circle cx="218" cy="57" r="9" fill="#6b4a1a" stroke="{INK}" stroke-width="3"/>
<path d="M60,50 l0,14 M80,50 l0,14 M180,50 l0,14 M200,50 l0,14" stroke="{INK}" stroke-width="2" opacity=".5"/>
<!-- cloth -->
<path d="M56,64 L204,64 L204,236 L180,250 L156,236 L130,252 L104,236 L80,250 L56,236 Z" fill="url(#{u}-cl)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
{weave}
<path d="M64,88 h132 M64,212 h132" stroke="#1b2a4a" stroke-width="3" stroke-dasharray="10 6" opacity=".7"/>
<path d="M60,70 C60,140 64,200 60,232" stroke="#fff6d0" stroke-width="4" fill="none" opacity=".4"/>
<!-- medallion -->
<circle cx="130" cy="150" r="52" fill="url(#{u}-md)" stroke="{INK}" stroke-width="4"/>
<circle cx="130" cy="150" r="44" fill="none" stroke="#d9b45a" stroke-width="2.5" stroke-dasharray="3 5"/>
<!-- two halves joining: left wave, right flame, meeting in a knot -->
<path d="M96,160 C104,140 116,136 124,148 C118,150 114,156 116,164 C108,170 100,168 96,160 Z" fill="#3fa7b5" stroke="{INK}" stroke-width="2"/>
<path d="M164,160 C158,138 146,128 138,120 C140,134 134,140 136,150 C130,156 136,168 146,170 C156,170 162,166 164,160 Z" fill="#e2563b" stroke="{INK}" stroke-width="2"/>
<path d="M118,170 C124,160 136,160 142,170 C136,180 124,180 118,170 Z" fill="#f2c94c" stroke="{INK}" stroke-width="2.5"/>
<path d="M130,108 l4,10 l10,0 l-8,6 l3,10 l-9,-6 l-9,6 l3,-10 l-8,-6 l10,0 Z" fill="#f2c94c" stroke="{INK}" stroke-width="1.5"/>
{fringe}{shells}
</svg>'''

# ---------------------------------------------------------------- jury bench
def jury_bench(icon=False):
    if icon:
        return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Jury">
<defs><linearGradient id="jbi-w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c98a52"/><stop offset="1" stop-color="#6b3f1c"/></linearGradient></defs>
<rect x="6" y="30" width="52" height="9" rx="3" fill="url(#jbi-w)" stroke="#2a1a08" stroke-width="2.5"/>
<path d="M12,39 v12 M52,39 v12" stroke="#2a1a08" stroke-width="5" stroke-linecap="round"/>
<path d="M12,39 v12 M52,39 v12" stroke="#8a5226" stroke-width="2.5" stroke-linecap="round"/>
<path d="M12,47 h40" stroke="#2a1a08" stroke-width="2.5"/>
<circle cx="20" cy="16" r="6" fill="#a3a9c2" stroke="#2a1a08" stroke-width="2"/><path d="M11,30 c0,-8 18,-8 18,0" fill="#a3a9c2" stroke="#2a1a08" stroke-width="2"/>
<circle cx="44" cy="16" r="6" fill="#a3a9c2" stroke="#2a1a08" stroke-width="2"/><path d="M35,30 c0,-8 18,-8 18,0" fill="#a3a9c2" stroke="#2a1a08" stroke-width="2"/>
<circle cx="32" cy="12" r="6" fill="#d9b45a" stroke="#2a1a08" stroke-width="2"/><path d="M23,28 c0,-9 18,-9 18,0" fill="#d9b45a" stroke="#2a1a08" stroke-width="2"/>
</svg>'''
    u = 'jb'
    planks = ''.join(f'<path d="M{40 + i * 52},120 v18" stroke="{INK}" stroke-width="2" opacity=".45"/>' for i in range(7))
    grain = ''.join(f'<path d="M{50 + i * 52},126 c10,-3 20,3 30,0" stroke="#4a2a12" stroke-width="1.5" fill="none" opacity=".6"/>' for i in range(7))
    def post(x):
        return f'''<g transform="translate({x},0)">
<rect x="-14" y="60" width="28" height="150" rx="5" fill="url(#{u}-p)" stroke="{INK}" stroke-width="3.5"/>
<path d="M-14,60 C-14,30 14,30 14,60 Z" fill="#6b3f1c" stroke="{INK}" stroke-width="3.5"/>
<circle cx="-5" cy="48" r="3.2" fill="#f2c94c"/><circle cx="5" cy="48" r="3.2" fill="#f2c94c"/>
<path d="M-6,55 h12" stroke="#f2c94c" stroke-width="2"/>
<path d="M-10,82 l10,-8 l10,8 M-10,96 l10,-8 l10,8 M-10,110 l10,-8 l10,8" stroke="#2a1a08" stroke-width="2.5" fill="none"/>
<rect x="-14" y="150" width="28" height="10" fill="#d9b45a" stroke="{INK}" stroke-width="2"/>
</g>'''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 240" width="440" height="240" role="img" aria-label="Jury bench">
<defs>
<linearGradient id="{u}-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d49a60"/><stop offset=".5" stop-color="#9a5e30"/><stop offset="1" stop-color="#5a3416"/></linearGradient>
<linearGradient id="{u}-p" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4a2a12"/><stop offset=".45" stop-color="#a8683a"/><stop offset="1" stop-color="#3e220c"/></linearGradient>
</defs>
<ellipse cx="220" cy="226" rx="200" ry="10" fill="#000" opacity=".35"/>
<rect x="18" y="92" width="404" height="16" rx="5" fill="url(#{u}-s)" stroke="{INK}" stroke-width="3.5"/>
<rect x="10" y="116" width="420" height="24" rx="6" fill="url(#{u}-s)" stroke="{INK}" stroke-width="4"/>
{planks}{grain}
<path d="M24,122 h390" stroke="#f3c48a" stroke-width="3" opacity=".35"/>
<path d="M60,140 v70 M380,140 v70" stroke="{INK}" stroke-width="12" stroke-linecap="round"/>
<path d="M60,140 v70 M380,140 v70" stroke="#7a4520" stroke-width="7" stroke-linecap="round"/>
<path d="M60,180 L380,180" stroke="{INK}" stroke-width="7"/><path d="M60,180 L380,180" stroke="#7a4520" stroke-width="3.5"/>
<path d="M200,180 l20,-12 l20,12" stroke="{INK}" stroke-width="5" fill="none"/>
{post(20)}{post(420)}
</svg>'''

# ---------------------------------------------------------------- champion trophy
def trophy(icon=False):
    if icon:
        return '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Champion">
<defs><radialGradient id="tri-f" cx="50%" cy="70%" r="60%"><stop offset="0" stop-color="#fff3b0"/><stop offset=".5" stop-color="#ffb627"/><stop offset="1" stop-color="#e2531b"/></radialGradient>
<linearGradient id="tri-g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a6420"/><stop offset=".5" stop-color="#f2c94c"/><stop offset="1" stop-color="#8a6420"/></linearGradient></defs>
<path d="M32,2 C42,12 42,20 37,25 C35,20 33,19 32,15 C31,19 29,20 27,25 C22,20 22,12 32,2 Z" fill="url(#tri-f)" stroke="#a8401a" stroke-width="1.5"/>
<path d="M20,26 h24 l-4,8 h-16 Z" fill="url(#tri-g)" stroke="#2a1a08" stroke-width="2"/>
<rect x="27" y="34" width="10" height="16" fill="#6b3f1c" stroke="#2a1a08" stroke-width="2"/>
<path d="M29,38 h6 M29,42 h6 M29,46 h6" stroke="#f2c94c" stroke-width="1.6"/>
<path d="M18,50 h28 l4,10 h-36 Z" fill="url(#tri-g)" stroke="#2a1a08" stroke-width="2"/>
</svg>'''
    u = 'tr'
    rays = ''.join(f'<path d="M130,96 L{130 + 120 * math.cos(math.radians(a)):.1f},{96 + 120 * math.sin(math.radians(a)):.1f}" stroke="#ffd66b" stroke-width="{3 if i % 2 else 6}" opacity="{.25 if i % 2 else .35}" stroke-linecap="round"/>'
                   for i, a in enumerate(range(-170, 10, 15)))
    carve = ''.join(f'<path d="M112,{200 + i * 16} l18,-8 l18,8" stroke="#f2c94c" stroke-width="2.5" fill="none"/>' for i in range(4))
    shells = ''.join(f'<circle cx="{88 + i * 21}" cy="300" r="5" fill="#f3ead6" stroke="{INK}" stroke-width="1.5"/>' for i in range(5))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 340" width="260" height="340" role="img" aria-label="Champion trophy">
<defs>
<radialGradient id="{u}-glow"><stop offset="0" stop-color="#ffd66b" stop-opacity=".6"/><stop offset="1" stop-color="#ffd66b" stop-opacity="0"/></radialGradient>
<radialGradient id="{u}-f" cx="50%" cy="72%" r="62%"><stop offset="0" stop-color="#fffbe0"/><stop offset=".35" stop-color="#ffd23f"/><stop offset=".75" stop-color="#ff8a1f"/><stop offset="1" stop-color="#d9401a"/></radialGradient>
<linearGradient id="{u}-g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6b4a12"/><stop offset=".3" stop-color="#d9b45a"/><stop offset=".5" stop-color="#fff0b8"/><stop offset=".7" stop-color="#d9b45a"/><stop offset="1" stop-color="#6b4a12"/></linearGradient>
<linearGradient id="{u}-w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3e220c"/><stop offset=".45" stop-color="#a8683a"/><stop offset="1" stop-color="#3e220c"/></linearGradient>
<linearGradient id="{u}-j" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fe0c0"/><stop offset="1" stop-color="#175344"/></linearGradient>
</defs>
<circle cx="130" cy="96" r="120" fill="url(#{u}-glow)"/>
<ellipse cx="130" cy="326" rx="96" ry="10" fill="#000" opacity=".4"/>
<!-- flame -->
<path d="M130,10 C162,40 170,66 156,90 C150,74 142,70 138,58 C136,72 128,76 124,88 C118,78 112,74 108,64 C96,84 100,100 104,108 C86,96 88,60 130,10 Z" fill="url(#{u}-f)" stroke="#a8401a" stroke-width="2.5" stroke-linejoin="round"/>
<path d="M130,52 C142,66 144,82 136,96 C132,88 128,86 126,80 C122,88 118,92 116,98 C110,86 116,70 130,52 Z" fill="#fff6c8" opacity=".85"/>
<!-- bowl -->
<path d="M70,104 L190,104 C190,136 166,158 130,160 C94,158 70,136 70,104 Z" fill="url(#{u}-g)" stroke="{INK}" stroke-width="4"/>
<path d="M70,104 L190,104" stroke="{INK}" stroke-width="4"/>
<path d="M78,112 h104" stroke="{INK}" stroke-width="2" opacity=".4"/>
<path d="M88,118 l10,12 l10,-12 l10,12 l10,-12 l10,12 l10,-12 l10,12 l10,-12" stroke="#6b4a12" stroke-width="2.5" fill="none"/>
<path d="M82,108 C84,128 96,144 112,150" stroke="#fff6d0" stroke-width="4" fill="none" opacity=".55" stroke-linecap="round"/>
<!-- handles: carved hooks -->
<path d="M70,110 C44,108 40,138 64,142" fill="none" stroke="{INK}" stroke-width="10" stroke-linecap="round"/>
<path d="M70,110 C44,108 40,138 64,142" fill="none" stroke="#d9b45a" stroke-width="5" stroke-linecap="round"/>
<path d="M190,110 C216,108 220,138 196,142" fill="none" stroke="{INK}" stroke-width="10" stroke-linecap="round"/>
<path d="M190,110 C216,108 220,138 196,142" fill="none" stroke="#d9b45a" stroke-width="5" stroke-linecap="round"/>
<!-- jade gem -->
<path d="M130,124 l10,10 l-10,14 l-10,-14 Z" fill="url(#{u}-j)" stroke="{INK}" stroke-width="2"/>
<!-- carved totem stem -->
<rect x="108" y="160" width="44" height="112" rx="6" fill="url(#{u}-w)" stroke="{INK}" stroke-width="4"/>
<path d="M108,176 h44" stroke="{INK}" stroke-width="2.5"/>
<circle cx="121" cy="186" r="4" fill="#f2c94c"/><circle cx="139" cy="186" r="4" fill="#f2c94c"/>
<path d="M118,194 h24 v6 h-24 Z" fill="#2a1a08"/><path d="M122,195 v4 M127,195 v4 M133,195 v4 M138,195 v4" stroke="#f3ead6" stroke-width="1.6"/>
{carve}
<!-- woven base -->
<path d="M84,272 L176,272 L192,312 L68,312 Z" fill="url(#{u}-g)" stroke="{INK}" stroke-width="4"/>
<path d="M80,284 h100 M76,296 h108" stroke="#6b4a12" stroke-width="2.5" stroke-dasharray="8 4"/>
{shells}
<rect x="62" y="310" width="136" height="12" rx="3" fill="#3e220c" stroke="{INK}" stroke-width="3"/>
</svg>'''

# ---------------------------------------------------------------- Exile boss
def boss(icon=False):
    if icon:
        return '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Exile boss">
<defs><linearGradient id="bsi-s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7d8794"/><stop offset="1" stop-color="#2e343e"/></linearGradient></defs>
<path d="M10,8 L54,8 L58,22 L54,58 L10,58 L6,22 Z" fill="url(#bsi-s)" stroke="#0e1116" stroke-width="2.5" stroke-linejoin="round"/>
<path d="M6,22 h52" stroke="#0e1116" stroke-width="2"/>
<path d="M14,28 l12,4 l-12,6 Z M50,28 l-12,4 l12,6 Z" fill="#ff3b2f"/>
<path d="M14,28 l12,4 l-12,6 Z M50,28 l-12,4 l12,6 Z" fill="none" stroke="#ffd0c0" stroke-width="1"/>
<rect x="18" y="44" width="28" height="9" rx="2" fill="#0e1116"/>
<path d="M22,44 v9 M28,44 v9 M34,44 v9 M40,44 v9" stroke="#c9ced6" stroke-width="2"/>
<path d="M18,14 l6,-4 l6,4 l6,-4 l6,4 l6,-4" stroke="#c9a15a" stroke-width="2" fill="none"/>
</svg>'''
    u = 'bs'
    moss = ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#3f6b3a" opacity=".75"/>' for x, y, r in
                   [(62, 70, 6), (70, 64, 4), (196, 92, 5), (188, 86, 3), (80, 262, 5), (176, 270, 6), (186, 262, 3)])
    cracks = '<path d="M90,60 l8,18 l-6,10 l10,14" stroke="#14181e" stroke-width="2" fill="none"/><path d="M182,150 l-10,14 l6,12" stroke="#14181e" stroke-width="2" fill="none"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 320" width="260" height="320" role="img" aria-label="Exile boss">
<defs>
<linearGradient id="{u}-s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9aa3ae"/><stop offset=".45" stop-color="#5d6672"/><stop offset="1" stop-color="#262b33"/></linearGradient>
<linearGradient id="{u}-s2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a525e"/><stop offset="1" stop-color="#1c2027"/></linearGradient>
<radialGradient id="{u}-e"><stop offset="0" stop-color="#fff2d0"/><stop offset=".35" stop-color="#ff6a3d"/><stop offset="1" stop-color="#b31d12"/></radialGradient>
<radialGradient id="{u}-glow" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#ff4a2f" stop-opacity=".45"/><stop offset="1" stop-color="#ff4a2f" stop-opacity="0"/></radialGradient>
<linearGradient id="{u}-g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6b4a12"/><stop offset=".5" stop-color="#e3be6a"/><stop offset="1" stop-color="#6b4a12"/></linearGradient>
</defs>
<ellipse cx="130" cy="150" rx="128" ry="140" fill="url(#{u}-glow)"/>
<ellipse cx="130" cy="306" rx="96" ry="10" fill="#000" opacity=".45"/>
<!-- crown of spikes -->
<path d="M52,58 L66,14 L84,48 L102,6 L118,46 L130,0 L142,46 L158,6 L176,48 L194,14 L208,58 Z" fill="url(#{u}-s2)" stroke="#0e1116" stroke-width="4" stroke-linejoin="round"/>
<path d="M66,14 l4,30 M102,6 l2,36 M130,0 v40 M158,6 l-2,36 M194,14 l-4,30" stroke="#8a939e" stroke-width="2" opacity=".6"/>
<!-- head -->
<path d="M46,56 L214,56 L224,104 L214,262 C200,290 170,300 130,300 C90,300 60,290 46,262 L36,104 Z" fill="url(#{u}-s)" stroke="#0e1116" stroke-width="5" stroke-linejoin="round"/>
<path d="M46,56 L214,56 L218,76 L42,76 Z" fill="url(#{u}-g)" stroke="#0e1116" stroke-width="3.5"/>
<path d="M54,66 l8,-6 l8,6 l8,-6 l8,6 l8,-6 l8,6 l8,-6 l8,6 l8,-6 l8,6 l8,-6 l8,6 l8,-6 l8,6 l8,-6 l8,6 l8,-6 l8,6 l8,-6 l8,6" stroke="#3e2a0c" stroke-width="2" fill="none"/>
<!-- brow -->
<path d="M44,112 C70,96 104,98 124,122 L136,122 C156,98 190,96 216,112 L214,128 C190,116 160,118 140,138 L120,138 C100,118 70,116 46,128 Z" fill="url(#{u}-s2)" stroke="#0e1116" stroke-width="4" stroke-linejoin="round"/>
<!-- eyes -->
<path d="M64,138 C80,128 104,132 116,148 C102,160 78,160 64,138 Z" fill="#0e1116"/>
<path d="M196,138 C180,128 156,132 144,148 C158,160 182,160 196,138 Z" fill="#0e1116"/>
<ellipse cx="92" cy="146" rx="13" ry="8" fill="url(#{u}-e)"/><ellipse cx="168" cy="146" rx="13" ry="8" fill="url(#{u}-e)"/>
<circle cx="88" cy="143" r="3" fill="#fff"/><circle cx="164" cy="143" r="3" fill="#fff"/>
<!-- nose -->
<path d="M120,140 L112,196 C120,204 140,204 148,196 L140,140" fill="url(#{u}-s2)" stroke="#0e1116" stroke-width="4" stroke-linejoin="round"/>
<path d="M116,196 c6,-6 10,-6 14,0 c4,-6 8,-6 14,0" stroke="#0e1116" stroke-width="3" fill="none"/>
<!-- cheek marks -->
<path d="M58,180 h30 M60,192 h24 M172,180 h30 M176,192 h24" stroke="#ff4a2f" stroke-width="4" stroke-linecap="round" opacity=".85"/>
<!-- mouth -->
<path d="M70,222 C96,212 164,212 190,222 L184,262 C160,276 100,276 76,262 Z" fill="#0e1116" stroke="#0e1116" stroke-width="4" stroke-linejoin="round"/>
<path d="M84,226 l6,30 M100,222 l4,40 M116,221 l2,44 M130,220 v46 M144,221 l-2,44 M160,222 l-4,40 M176,226 l-6,30" stroke="#d6dbe2" stroke-width="5"/>
<path d="M76,240 C104,248 156,248 184,240" stroke="#0e1116" stroke-width="3" fill="none"/>
<!-- ear plugs -->
<circle cx="34" cy="170" r="14" fill="url(#{u}-g)" stroke="#0e1116" stroke-width="3.5"/><circle cx="34" cy="170" r="6" fill="#0e1116"/>
<circle cx="226" cy="170" r="14" fill="url(#{u}-g)" stroke="#0e1116" stroke-width="3.5"/><circle cx="226" cy="170" r="6" fill="#0e1116"/>
{moss}{cracks}
<path d="M58,84 C56,120 54,180 62,250" stroke="#c9d0d8" stroke-width="4" fill="none" opacity=".25" stroke-linecap="round"/>
</svg>'''

def write(name, svg):
    open(os.path.join(OUT, name), 'w').write(svg)

if __name__ == '__main__':
    for n, (p, s) in BUFFS.items():
        write(f'buff-{n}.svg', buff(p, s, 'bf' + n[:2]))
    write('merge-banner.svg', merge_banner())
    write('jury-bench.svg', jury_bench()); write('jury-icon.svg', jury_bench(True))
    write('champion-trophy.svg', trophy()); write('champion-icon.svg', trophy(True))
    write('exile-boss.svg', boss()); write('exile-boss-icon.svg', boss(True))
    print(sorted(os.listdir(OUT)))
