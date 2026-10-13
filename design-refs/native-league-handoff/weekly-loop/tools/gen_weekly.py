#!/usr/bin/env python3
"""Weekly Survivor loop assets: voting urn, immunity necklace (+icon), torch lit / snuffed (+icons)."""
import os, math
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'assets'); os.makedirs(OUT, exist_ok=True)
INK = '#1a0f06'

def urn():
    carve = ''.join(f'<path d="M{70 + i*20},150 l8,-10 l8,10 l-8,10 Z" fill="#5a3416" opacity=".55"/>' for i in range(6))
    dots = ''.join(f'<circle cx="{66 + i*12}" cy="196" r="3" fill="#e9c27a" opacity=".7"/>' for i in range(10))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 280" width="240" height="280" role="img" aria-label="Voting urn">
<defs>
<linearGradient id="urn-body" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4a2a12"/><stop offset=".3" stop-color="#a8683a"/><stop offset=".55" stop-color="#c98a52"/><stop offset=".85" stop-color="#7a4520"/><stop offset="1" stop-color="#3e220c"/></linearGradient>
<linearGradient id="urn-neck" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3e220c"/><stop offset=".45" stop-color="#9a5e30"/><stop offset="1" stop-color="#3e220c"/></linearGradient>
<radialGradient id="urn-mouth" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#1a0f06"/></radialGradient>
<linearGradient id="urn-band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6b4a12"/><stop offset=".5" stop-color="#e9c27a"/><stop offset="1" stop-color="#6b4a12"/></linearGradient>
</defs>
<ellipse cx="120" cy="262" rx="78" ry="12" fill="#000" opacity=".4"/>
<path d="M78,252 L162,252 L170,262 L70,262 Z" fill="#3e220c" stroke="{INK}" stroke-width="3"/>
<path d="M120,80 C58,80 36,130 44,176 C52,220 82,252 120,252 C158,252 188,220 196,176 C204,130 182,80 120,80 Z" fill="url(#urn-body)" stroke="{INK}" stroke-width="4"/>
<path d="M44,126 C20,120 18,96 34,88 C40,86 46,92 44,98 C40,104 36,110 52,112" fill="none" stroke="{INK}" stroke-width="10" stroke-linecap="round"/>
<path d="M44,126 C20,120 18,96 34,88 C40,86 46,92 44,98 C40,104 36,110 52,112" fill="none" stroke="#8a5226" stroke-width="5" stroke-linecap="round"/>
<path d="M196,126 C220,120 222,96 206,88 C200,86 194,92 196,98 C200,104 204,110 188,112" fill="none" stroke="{INK}" stroke-width="10" stroke-linecap="round"/>
<path d="M196,126 C220,120 222,96 206,88 C200,86 194,92 196,98 C200,104 204,110 188,112" fill="none" stroke="#8a5226" stroke-width="5" stroke-linecap="round"/>
<rect x="46" y="138" width="148" height="26" fill="url(#urn-band)" stroke="{INK}" stroke-width="2.5"/>
{carve}
<path d="M54,186 C90,192 150,192 186,186" stroke="#5a3416" stroke-width="3" fill="none"/>
{dots}
<path d="M58,214 C90,224 150,224 182,214" stroke="#5a3416" stroke-width="2" fill="none" opacity=".7"/>
<path d="M64,120 C70,104 86,94 104,90" stroke="#f3c48a" stroke-width="5" fill="none" stroke-linecap="round" opacity=".55"/>
<path d="M86,58 L154,58 L160,82 L80,82 Z" fill="url(#urn-neck)" stroke="{INK}" stroke-width="3.5"/>
<ellipse cx="120" cy="58" rx="40" ry="11" fill="#7a4520" stroke="{INK}" stroke-width="3.5"/>
<ellipse cx="120" cy="58" rx="31" ry="7" fill="url(#urn-mouth)"/>
<g transform="translate(120,196)"><circle r="17" fill="#5a3416" stroke="{INK}" stroke-width="2"/>
<path d="M-8,-4 h6 v4 h-6 Z M2,-4 h6 v4 h-6 Z" fill="#e9c27a"/><path d="M-7,7 h14" stroke="#e9c27a" stroke-width="2.5"/></g>
</svg>'''

def necklace(icon=False):
    if icon:
        return '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Immunity necklace">
<defs><radialGradient id="nk-i" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff1b8"/><stop offset=".45" stop-color="#f2c94c"/><stop offset="1" stop-color="#9a6a14"/></radialGradient></defs>
<path d="M8,6 C8,30 20,40 32,40 C44,40 56,30 56,6" fill="none" stroke="#3a2410" stroke-width="5" stroke-linecap="round"/>
<path d="M8,6 C8,30 20,40 32,40 C44,40 56,30 56,6" fill="none" stroke="#c9a15a" stroke-width="2.5" stroke-linecap="round"/>
<circle cx="14" cy="26" r="3.5" fill="#e9dcc0" stroke="#3a2410" stroke-width="1.5"/><circle cx="50" cy="26" r="3.5" fill="#e9dcc0" stroke="#3a2410" stroke-width="1.5"/>
<path d="M32,34 L44,46 L32,62 L20,46 Z" fill="url(#nk-i)" stroke="#3a2410" stroke-width="2.5" stroke-linejoin="round"/>
<path d="M27,45 h4 M33,45 h4 M28,52 h8" stroke="#3a2410" stroke-width="2" stroke-linecap="round"/>
</svg>'''
    beads = []
    for i in range(1, 22):
        t = i / 22.0
        x = 30 + 180 * t
        y = 34 + 150 * math.sin(math.pi * t) ** 1.2
        if 0.4 < t < 0.6: continue
        kind = i % 3
        if kind == 0:
            beads.append(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="7" ry="5.5" fill="url(#nk-bone)" stroke="{INK}" stroke-width="1.6" transform="rotate({(t - .5) * 120:.0f} {x:.1f} {y:.1f})"/>')
        elif kind == 1:
            beads.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="#3b7f6a" stroke="{INK}" stroke-width="1.5"/><circle cx="{x-1.5:.1f}" cy="{y-1.5:.1f}" r="1.4" fill="#bff3e0" opacity=".8"/>')
        else:
            beads.append(f'<path d="M{x:.1f},{y-7:.1f} L{x+4:.1f},{y+5:.1f} L{x-4:.1f},{y+5:.1f} Z" fill="#f3ead6" stroke="{INK}" stroke-width="1.4"/>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 300" width="240" height="300" role="img" aria-label="Immunity necklace">
<defs>
<radialGradient id="nk-glow"><stop offset="0" stop-color="#ffd66b" stop-opacity=".55"/><stop offset="1" stop-color="#ffd66b" stop-opacity="0"/></radialGradient>
<radialGradient id="nk-gold" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#fff3c4"/><stop offset=".35" stop-color="#f2c94c"/><stop offset=".75" stop-color="#b8862b"/><stop offset="1" stop-color="#6b4a12"/></radialGradient>
<linearGradient id="nk-bone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf4e2"/><stop offset="1" stop-color="#c9b48a"/></linearGradient>
<linearGradient id="nk-jade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fe0c0"/><stop offset=".5" stop-color="#2f8f72"/><stop offset="1" stop-color="#175344"/></linearGradient>
</defs>
<circle cx="120" cy="214" r="92" fill="url(#nk-glow)"/>
<path d="M30,30 C30,120 70,184 120,186 C170,184 210,120 210,30" fill="none" stroke="{INK}" stroke-width="8" stroke-linecap="round"/>
<path d="M30,30 C30,120 70,184 120,186 C170,184 210,120 210,30" fill="none" stroke="#b8925a" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="7 3"/>
{''.join(beads)}
<path d="M120,176 L120,192" stroke="{INK}" stroke-width="5"/>
<g transform="translate(120,236)">
  <path d="M0,-46 C30,-46 46,-24 46,4 C46,34 24,54 0,62 C-24,54 -46,34 -46,4 C-46,-24 -30,-46 0,-46 Z" fill="url(#nk-gold)" stroke="{INK}" stroke-width="4"/>
  <path d="M0,-36 C22,-36 35,-18 35,4 C35,27 18,43 0,50 C-18,43 -35,27 -35,4 C-35,-18 -22,-36 0,-36 Z" fill="url(#nk-jade)" stroke="#3a2a0c" stroke-width="2.5"/>
  <path d="M-20,-10 L-6,-6 L-6,2 L-20,-2 Z M20,-10 L6,-6 L6,2 L20,-2 Z" fill="#f2c94c" stroke="{INK}" stroke-width="1.6"/>
  <path d="M-16,18 C-8,26 8,26 16,18 L12,30 C4,34 -4,34 -12,30 Z" fill="#0e3a2e" stroke="#f2c94c" stroke-width="1.6"/>
  <path d="M-8,20 v6 M-2,21 v7 M4,21 v7 M10,20 v6" stroke="#f2c94c" stroke-width="1.4"/>
  <path d="M-3,-2 L0,10 L3,-2" fill="none" stroke="#f2c94c" stroke-width="2" stroke-linejoin="round"/>
  <path d="M-30,-20 C-24,-34 -12,-40 2,-40" stroke="#fff6d0" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".7"/>
  <path transform="translate(30,-34) scale(.8)" d="M0,-10 L2.4,-2.4 L10,0 L2.4,2.4 L0,10 L-2.4,2.4 L-10,0 L-2.4,-2.4 Z" fill="#fff" opacity=".9"/>
</g>
</svg>'''

def torch(lit=True, icon=False):
    if icon:
        flame = ('<path d="M32,4 C42,14 44,24 38,30 C35,33 29,33 26,30 C20,24 22,16 28,10 C29,15 31,16 32,4 Z" fill="#ff9a3c" stroke="#3a1a06" stroke-width="1.5"/>'
                 '<path d="M32,14 C37,20 37,26 33,28 C30,29 27,27 28,23 C28,20 30,18 32,14 Z" fill="#fff1b8"/>') if lit else \
                ('<path d="M33,26 C29,20 36,16 32,10 C29,6 33,3 35,1" fill="none" stroke="#9aa3b5" stroke-width="2.5" stroke-linecap="round" opacity=".8"/>'
                 '<circle cx="32" cy="31" r="2" fill="#ff7a2a" opacity=".8"/>')
        return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Torch {'lit' if lit else 'snuffed'}">
{'<circle cx="32" cy="22" r="20" fill="#ffb547" opacity=".22"/>' if lit else ''}
{flame}
<path d="M20,32 L44,32 L40,40 L24,40 Z" fill="{'#5a3416' if lit else '#2a2420'}" stroke="#1a0f06" stroke-width="2"/>
<rect x="29" y="40" width="6" height="22" rx="2" fill="{'#c98a52' if lit else '#6b5a4a'}" stroke="#1a0f06" stroke-width="2"/>
<path d="M29,46 h6 M29,53 h6" stroke="#1a0f06" stroke-width="1.5"/>
</svg>'''
    bamboo = ''.join(f'<path d="M108,{y} h24" stroke="{INK}" stroke-width="2.5"/>' for y in (176, 212, 248))
    body = '#c98a52' if lit else '#6e5a48'; bowl = '#5a3416' if lit else '#2a2420'
    if lit:
        top = '''<circle cx="120" cy="92" r="80" fill="url(#t-glow)"/>
<path d="M120,10 C150,40 164,70 156,98 C150,118 136,128 120,128 C104,128 90,118 84,98 C78,76 92,56 102,40 C106,58 112,64 116,66 C116,48 112,30 120,10 Z" fill="url(#t-fl1)" stroke="#5a1c06" stroke-width="3"/>
<path d="M120,48 C138,66 144,88 138,104 C134,116 126,122 120,122 C112,122 104,116 102,104 C98,90 106,76 112,66 C114,78 118,80 120,80 C122,70 118,60 120,48 Z" fill="url(#t-fl2)"/>
<path d="M120,80 C128,90 130,102 126,110 C124,116 116,116 114,110 C110,102 114,92 120,80 Z" fill="#fffbe6"/>'''
    else:
        top = '''<path d="M122,126 C108,108 136,98 122,78 C112,64 128,52 120,36 C116,28 122,18 128,12" fill="none" stroke="#aab2c0" stroke-width="7" stroke-linecap="round" opacity=".55"/>
<path d="M114,124 C104,112 118,100 110,88 C104,78 112,70 108,60" fill="none" stroke="#8c94a3" stroke-width="5" stroke-linecap="round" opacity=".45"/>
<circle cx="126" cy="132" r="4" fill="#ff7a2a" opacity=".85"/><circle cx="112" cy="134" r="2.5" fill="#ff7a2a" opacity=".6"/>'''
    pre = 'tl' if lit else 'to'
    return (f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 300" width="240" height="300" role="img" aria-label="Tribal torch {'lit' if lit else 'snuffed'}">
<defs>
<radialGradient id="t-glow"><stop offset="0" stop-color="#ffb547" stop-opacity=".55"/><stop offset=".55" stop-color="#ff7a2a" stop-opacity=".15"/><stop offset="1" stop-color="#ff7a2a" stop-opacity="0"/></radialGradient>
<linearGradient id="t-fl1" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff5a1f"/><stop offset=".6" stop-color="#ff9a3c"/><stop offset="1" stop-color="#ffd27a"/></linearGradient>
<linearGradient id="t-fl2" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffb547"/><stop offset="1" stop-color="#ffe9a8"/></linearGradient>
<linearGradient id="t-wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3e220c"/><stop offset=".45" stop-color="{body}"/><stop offset="1" stop-color="#3e220c"/></linearGradient>
</defs>
<ellipse cx="120" cy="290" rx="40" ry="6" fill="#000" opacity=".4"/>
{top}
<path d="M78,130 L162,130 L150,160 L90,160 Z" fill="{bowl}" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
<path d="M84,138 L156,138" stroke="{'#e9c27a' if lit else '#4a4038'}" stroke-width="3"/>
<path d="M92,150 l8,-6 l8,6 l8,-6 l8,6 l8,-6 l8,6 l8,-6 l8,6" fill="none" stroke="{'#e9c27a' if lit else '#4a4038'}" stroke-width="2"/>
<path d="M96,160 L144,160 L136,172 L104,172 Z" fill="#2e1a0a" stroke="{INK}" stroke-width="3"/>
<rect x="108" y="170" width="24" height="118" rx="6" fill="url(#t-wood)" stroke="{INK}" stroke-width="4"/>
{bamboo}
<path d="M106,190 L134,198 M106,198 L134,190" stroke="{'#b8925a' if lit else '#5a5048'}" stroke-width="3"/>
</svg>''').replace('t-', pre + '-')

if __name__ == '__main__':
    W = lambda n, s: open(os.path.join(OUT, n), 'w').write(s)
    W('urn.svg', urn()); W('immunity-necklace.svg', necklace()); W('immunity-necklace-icon.svg', necklace(True))
    W('torch-lit.svg', torch(True)); W('torch-out.svg', torch(False)); W('torch-lit-icon.svg', torch(True, True)); W('torch-out-icon.svg', torch(False, True))
    print('ok')
