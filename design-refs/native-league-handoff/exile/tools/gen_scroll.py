#!/usr/bin/env python3
"""Tribal Council results scroll — asset pieces: roller, wax seal (+broken), parchment texture, vote slip, full sealed scroll."""
import os, math
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'assets'); os.makedirs(OUT, exist_ok=True)

def roller(w=420):
    """Wooden dowel with carved gold end caps. viewBox width w, height 44. Parchment edge tucks under it."""
    cap = lambda x, flip: f'''<g transform="translate({x},22) scale({flip},1)">
  <rect x="-2" y="-11" width="12" height="22" rx="3" fill="url(#rCap)" stroke="#4a3008" stroke-width="1.5"/>
  <path d="M10,-15 C22,-15 26,-9 26,0 C26,9 22,15 10,15 Z" fill="url(#rCap)" stroke="#4a3008" stroke-width="1.5"/>
  <circle cx="30" cy="0" r="7" fill="url(#rCap)" stroke="#4a3008" stroke-width="1.5"/>
  <path d="M12,-11 C19,-10 22,-6 23,-2" stroke="#fff3c4" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/>
  <circle cx="28" cy="-2.5" r="2" fill="#fff3c4" opacity=".8"/>
  <path d="M3,-11 V11 M6,-11 V11" stroke="#7a5512" stroke-width="1" opacity=".6"/>
</g>'''
    grain = ''.join(f'<path d="M44,{y} C{w*0.3:.0f},{y-1.5} {w*0.6:.0f},{y+1.5} {w-44},{y}" stroke="#3a210c" stroke-width=".8" fill="none" opacity=".35"/>' for y in (12, 17, 27, 32))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 44" width="{w}" height="44" preserveAspectRatio="none" aria-hidden="true">
<defs>
<linearGradient id="rWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3414"/><stop offset=".22" stop-color="#b37a3e"/><stop offset=".42" stop-color="#d9a061"/><stop offset=".7" stop-color="#8a5326"/><stop offset="1" stop-color="#3e220c"/></linearGradient>
<linearGradient id="rCap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset=".35" stop-color="#e2b04a"/><stop offset=".75" stop-color="#a87420"/><stop offset="1" stop-color="#6b4710"/></linearGradient>
</defs>
<rect x="40" y="8" width="{w-80}" height="28" rx="6" fill="url(#rWood)" stroke="#2e1908" stroke-width="2"/>
{grain}
<rect x="40" y="8" width="{w-80}" height="5" rx="2.5" fill="#f2c98f" opacity=".35"/>
{cap(40, -1)}{cap(w-40, 1)}
</svg>'''

def torch(cx, cy, s, col, hi):
    """Original torch emblem (crossed bands, bowl, flame)."""
    return f'''<g transform="translate({cx},{cy}) scale({s})">
  <path d="M-4,4 L4,4 L3,30 L-3,30 Z" fill="{col}"/>
  <path d="M-4,10 H4 M-4,17 H4 M-3.5,24 H3.5" stroke="{hi}" stroke-width="1.2" opacity=".7"/>
  <path d="M-11,-2 L11,-2 L7,6 L-7,6 Z" fill="{col}"/>
  <path d="M0,-30 C7,-22 12,-16 10,-8 C9,-4 6,-2 0,-2 C-6,-2 -9,-4 -10,-8 C-11,-14 -6,-18 -5,-24 C-3,-19 -1,-17 0,-16 C1,-21 0,-25 0,-30 Z" fill="{col}"/>
  <path d="M0,-16 C4,-12 5,-8 3,-5 C1,-3 -2,-3 -3,-5 C-4,-8 -2,-11 0,-16 Z" fill="{hi}" opacity=".55"/>
</g>'''

def seal(broken=False):
    blob = 'M60,8 C74,6 84,14 92,22 C102,26 112,38 110,52 C116,64 112,80 102,88 C96,102 82,112 66,110 C52,116 36,110 28,100 C14,94 6,80 10,66 C4,52 10,36 22,28 C30,14 44,8 60,8 Z'
    crack = '' if not broken else ('<path d="M58,6 L64,34 L54,52 L70,72 L60,112" fill="none" stroke="#3a0608" stroke-width="3.5" stroke-linejoin="round"/>'
                                   '<path d="M60,6 L66,34 L56,52 L72,72 L62,112" fill="none" stroke="#ff9a8a" stroke-width="1" opacity=".5"/>')
    shift = ' transform="translate(4,2) rotate(4 60 60)"' if broken else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150" width="120" height="150" role="img" aria-label="Wax seal{' (broken)' if broken else ''}">
<defs>
<radialGradient id="wax{int(broken)}" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#e2504a"/><stop offset=".45" stop-color="#b3201f"/><stop offset="1" stop-color="#6a0b0e"/></radialGradient>
<radialGradient id="waxIn{int(broken)}" cx="60%" cy="65%" r="70%"><stop offset="0" stop-color="#c22a27"/><stop offset="1" stop-color="#7c1012"/></radialGradient>
</defs>
<path d="M44,96 L32,146 L46,136 L56,148 L60,100 Z" fill="#7c1620" stroke="#3a0608" stroke-width="1.5"/>
<path d="M76,96 L88,146 L74,136 L64,148 L60,100 Z" fill="#94202a" stroke="#3a0608" stroke-width="1.5"/>
<path d="{blob}" transform="translate(1,3)" fill="#000" opacity=".35"/>
<g{shift}>
<path d="{blob}" fill="url(#wax{int(broken)})" stroke="#4a0709" stroke-width="1.5"/>
<circle cx="60" cy="60" r="34" fill="url(#waxIn{int(broken)})" stroke="#5a0a0c" stroke-width="2"/>
<circle cx="60" cy="60" r="29" fill="none" stroke="#e8645c" stroke-width="1" opacity=".55"/>
{''.join(f'<circle cx="{60+31.5*math.cos(math.radians(a)):.1f}" cy="{60+31.5*math.sin(math.radians(a)):.1f}" r="1.1" fill="#ff8f86" opacity=".6"/>' for a in range(0,360,15))}
{torch(60, 62, 0.95, '#5e0a0d', '#ff8f86')}
<path d="M26,40 C30,26 44,16 58,15" fill="none" stroke="#ffb3a8" stroke-width="3" stroke-linecap="round" opacity=".55"/>
</g>
{crack}
</svg>'''

def texture():
    """Tileable parchment fibre/noise texture, used as a CSS background on the parchment body."""
    return '''<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
<filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch" seed="7"/>
<feColorMatrix values="0 0 0 0 .36  0 0 0 0 .24  0 0 0 0 .10  0 0 0 .55 0"/></filter>
<filter id="f" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".012 .09" numOctaves="2" stitchTiles="stitch" seed="3"/>
<feColorMatrix values="0 0 0 0 .45  0 0 0 0 .30  0 0 0 0 .12  0 0 0 .35 0"/></filter>
<rect width="300" height="300" filter="url(#f)" opacity=".55"/>
<rect width="300" height="300" filter="url(#n)" opacity=".35"/>
</svg>'''

def sealed_scroll():
    """Rolled-up scroll tied with cord and sealed (the 'results are in' state)."""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 200" width="420" height="200" role="img" aria-label="Sealed Tribal Council scroll">
<defs>
<linearGradient id="sp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8925a"/><stop offset=".18" stop-color="#ead6aa"/><stop offset=".45" stop-color="#f6e8c6"/><stop offset=".8" stop-color="#d9bb83"/><stop offset="1" stop-color="#8f6a36"/></linearGradient>
<radialGradient id="se" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#e9d3a2"/><stop offset=".6" stop-color="#c9a468"/><stop offset="1" stop-color="#8a6330"/></radialGradient>
<linearGradient id="cord" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6b4a1e"/><stop offset=".5" stop-color="#c9a15a"/><stop offset="1" stop-color="#6b4a1e"/></linearGradient>
</defs>
<ellipse cx="210" cy="178" rx="190" ry="10" fill="#000" opacity=".35"/>
<rect x="44" y="58" width="332" height="96" rx="10" fill="url(#sp)" stroke="#5e4220" stroke-width="2"/>
<path d="M70,66 C150,62 270,62 350,66" stroke="#fff8e6" stroke-width="3" fill="none" opacity=".5" stroke-linecap="round"/>
<path d="M60,140 C150,146 270,146 360,140" stroke="#6b4a1e" stroke-width="2" fill="none" opacity=".35"/>
<path d="M120,60 C122,90 118,120 121,152 M300,60 C298,90 302,120 299,152" stroke="#8f6a36" stroke-width="1.2" opacity=".35" fill="none"/>
<ellipse cx="44" cy="106" rx="20" ry="48" fill="url(#se)" stroke="#5e4220" stroke-width="2"/>
<path d="M44,70 C34,84 34,128 44,142 M44,82 C38,92 38,120 44,130 M44,94 C41,100 41,112 44,118" stroke="#7a5528" stroke-width="1.6" fill="none"/>
<ellipse cx="376" cy="106" rx="20" ry="48" fill="url(#se)" stroke="#5e4220" stroke-width="2"/>
<path d="M376,70 C366,84 366,128 376,142 M376,82 C370,92 370,120 376,130 M376,94 C373,100 373,112 376,118" stroke="#7a5528" stroke-width="1.6" fill="none"/>
<rect x="196" y="54" width="10" height="104" rx="3" fill="url(#cord)" stroke="#3e2a0e" stroke-width="1.2"/>
<rect x="214" y="54" width="10" height="104" rx="3" fill="url(#cord)" stroke="#3e2a0e" stroke-width="1.2"/>
<g transform="translate(150,52) scale(1)">{seal_inner()}</g>
</svg>'''

def seal_inner():
    s = seal(False)
    return s[s.index('>')+1:s.rindex('</svg>')].replace('id="wax0"', 'id="wax0s"').replace('url(#wax0)', 'url(#wax0s)').replace('id="waxIn0"', 'id="waxIn0s"').replace('url(#waxIn0)', 'url(#waxIn0s)')

if __name__ == '__main__':
    open(os.path.join(OUT, 'scroll-roller.svg'), 'w').write(roller())
    open(os.path.join(OUT, 'wax-seal.svg'), 'w').write(seal(False))
    open(os.path.join(OUT, 'wax-seal-broken.svg'), 'w').write(seal(True))
    open(os.path.join(OUT, 'parchment-texture.svg'), 'w').write(texture())
    open(os.path.join(OUT, 'scroll-sealed.svg'), 'w').write(sealed_scroll())
    print('ok')
