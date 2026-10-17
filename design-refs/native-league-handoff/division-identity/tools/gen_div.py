"""Division identity system (created by KB).
20 contrasting division pairs (40 sides), each with an icon + palette.
Outputs (all text-free so commissioners can type their own names):
  medallions/<side>.svg   division medallion in the side's palette (300x300)
  library/<img>.svg       unnamed image library, neutral silver finish (200x200): 38 division emblems + 10 conference mascots + 2 extras (50)
  frames/<side>.svg       blank crest frame in the side's palette, empty tab + ribbon, KB signature (300x340)
Usage: python3 gen_div.py <out_dir>  -> <out_dir>/div/...
"""
import os, sys, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_a import svg, lg, rg, stars, football, INK
import gen_kbi as K

def star(cx, cy, r1, r2, n=5, rot=-90):
    pts = []
    for i in range(n * 2):
        r = r1 if i % 2 == 0 else r2
        t = math.radians(rot + i * 180 / n)
        pts.append(f'{cx + r * math.cos(t):.1f},{cy + r * math.sin(t):.1f}')
    return 'M' + ' L'.join(pts) + ' Z'

M = 'url(#M)'
def P(d, fill=M, sw=5, extra=''):
    return f'<path d="{d}" fill="{fill}" stroke="{INK}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round" {extra}/>'
def L(d, w=10, col=M):
    return f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="{w + 6}" stroke-linecap="round" stroke-linejoin="round"/><path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'
HL = lambda d: f'<path d="{d}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="4" stroke-linecap="round"/>'
MIR = lambda s: f'<g transform="translate(200,0) scale(-1,1)">{s}</g>'

# ---------------------------------------------------------------- icons (200x200, metal = url(#M), accent = a)
def i_sprout(a):
    return (P('M44,182 Q100,148 156,182 Z') + L('M100,170 C100,140 100,120 100,92', 7) +
            P('M100,124 C70,128 44,108 40,78 C70,74 96,94 100,124 Z') + P('M100,100 C126,98 154,76 158,42 C124,42 100,64 100,100 Z') +
            f'<path d="M52,86 C70,96 86,108 98,122 M148,52 C132,66 116,82 102,98" stroke="{a}" stroke-width="3.5" fill="none" stroke-linecap="round"/>')
def i_vet(a):
    ch = ''.join(P(f'M44,{y} L100,{y - 32} L156,{y} L156,{y + 20} L100,{y - 12} L44,{y + 20} Z') for y in (112, 142, 172))
    return ch + P(star(100, 54, 36, 15), fill=a) + HL('M52,108 L100,82')
def i_shieldstar(a):
    return (P('M100,18 L170,42 L164,110 C158,150 132,172 100,186 C68,172 42,150 36,110 L30,42 Z', sw=6) + HL('M44,52 L100,32 L156,52') +
            P(star(100, 100, 50, 20), fill=a, sw=4.5))
def i_angel(a):
    wing = P('M94,112 C70,72 32,64 12,84 C30,86 38,92 40,100 C22,100 14,112 16,124 C32,118 44,122 48,130 C36,136 34,148 40,158 C58,142 82,134 94,128 Z', sw=4.5)
    return (wing + MIR(wing) + P('M100,96 C112,96 120,106 120,120 C120,150 110,170 100,180 C90,170 80,150 80,120 C80,106 88,96 100,96 Z') +
            f'<ellipse cx="100" cy="56" rx="36" ry="12" fill="none" stroke="{INK}" stroke-width="14"/><ellipse cx="100" cy="56" rx="36" ry="12" fill="none" stroke="{a}" stroke-width="8"/>' +
            f'<circle cx="100" cy="124" r="6" fill="{a}"/>')
def i_demon(a):
    horn = P('M70,78 C40,70 26,40 34,10 C46,38 62,50 84,58 Z')
    return (horn + MIR(horn) + P('M58,64 Q100,46 142,64 L140,112 Q128,156 100,184 Q72,156 60,112 Z', sw=6) + HL('M66,70 Q100,56 134,70') +
            f'<path d="M68,94 L94,104 L88,112 L70,106 Z M132,94 L106,104 L112,112 L130,106 Z" fill="{a}" stroke="{INK}" stroke-width="3.5"/>' +
            f'<path d="M78,140 Q100,154 122,140 L116,148 L110,140 L104,150 L100,142 L96,150 L90,140 L84,148 Z" fill="#fff" stroke="{INK}" stroke-width="2.5"/>' +
            f'<path d="M100,184 L100,196" stroke="{INK}" stroke-width="4"/><path d="M92,196 L100,186 L108,196 Z" fill="{a}"/>')
def i_wave(a):
    return (P('M10,150 C38,150 54,120 70,94 C92,60 132,44 162,62 C186,76 184,112 158,116 C138,118 132,98 146,92 C128,86 112,104 114,128 C116,150 140,162 190,162 L190,190 L10,190 Z', sw=6) +
            HL('M74,98 C94,68 126,56 152,66') +
            f'<path d="M24,176 Q44,166 64,176 T104,176 T144,176 T184,176" stroke="{a}" stroke-width="5" fill="none"/><circle cx="168" cy="52" r="6" fill="{a}"/><circle cx="182" cy="70" r="4" fill="{a}"/>')
def i_turf(a):
    lines = ''.join(f'<path d="M{70 + k * 15:.0f},122 L{48 + k * 26:.0f},184" stroke="#fff" stroke-width="3" opacity=".75"/>' for k in range(5))
    blades = ''.join(f'<path d="M{x},190 L{x + 4},{150 - (k % 3) * 12} L{x + 9},190 Z" fill="{a}" stroke="{INK}" stroke-width="2.5"/>' for k, x in enumerate(range(16, 186, 14)))
    return P('M16,186 L62,118 L138,118 L184,186 Z', sw=6) + lines + football(100, 84, 1.6, -24) + blades
def i_buffalo(a):
    return K.m_buffalo(a)
def i_flame(a):
    return (P('M100,192 C54,188 38,150 50,118 C58,96 76,88 72,58 C96,72 106,94 100,118 C114,102 116,82 108,56 C142,78 164,118 156,150 C150,176 128,192 100,192 Z', sw=6) +
            f'<path d="M100,184 C80,180 72,160 80,144 C86,132 96,128 96,112 C112,126 122,146 118,162 C114,176 106,184 100,184 Z" fill="{a}" stroke="{INK}" stroke-width="4"/>' + HL('M60,124 C66,104 80,96 80,76'))
def i_snow(a):
    arm = 'M100,100 V20 M100,50 L82,34 M100,50 L118,34 M100,76 L86,64 M100,76 L114,64'
    arms = ''.join(f'<g transform="rotate({k * 60} 100 100)"><path d="{arm}" stroke="{INK}" stroke-width="16" stroke-linecap="round" fill="none"/><path d="{arm}" stroke="{M}" stroke-width="9" stroke-linecap="round" fill="none"/></g>' for k in range(6))
    return arms + f'<path d="{star(100, 100, 20, 20, 6, 0)}" fill="{a}" stroke="{INK}" stroke-width="4"/>'
def i_hero(a):
    return (P('M100,22 L180,90 L100,186 L20,90 Z', sw=6) + HL('M34,90 L100,36 L166,90') +
            P('M112,52 L72,108 L98,108 L84,156 L132,94 L106,94 L122,52 Z', fill=a, sw=4.5))
def i_villain(a):
    return (P('M16,96 C26,68 70,62 100,82 C130,62 174,68 184,96 C180,126 152,138 126,128 C114,122 106,114 100,114 C94,114 86,122 74,128 C48,138 20,126 16,96 Z', sw=6) +
            f'<path d="M44,98 L84,92 L80,108 L50,110 Z M156,98 L116,92 L120,108 L150,110 Z" fill="{a}" stroke="{INK}" stroke-width="3.5"/>' + HL('M30,90 C44,72 74,70 96,86') +
            f'<path d="M100,114 L96,150 L104,150 Z" fill="{INK}" opacity=".5"/>')
def i_sun(a):
    rays = ''.join(f'<path d="M100,10 L110,40 L90,40 Z" fill="{M}" stroke="{INK}" stroke-width="4" stroke-linejoin="round" transform="rotate({k * 30} 100 100)"/>' for k in range(12))
    return rays + f'<circle cx="100" cy="100" r="46" fill="{M}" stroke="{INK}" stroke-width="6"/><circle cx="100" cy="100" r="30" fill="{a}" opacity=".55"/>' + HL('M70,86 A34,34 0 0 1 96,62')
def i_moon(a):
    return (P('M128,26 A76,76 0 1 0 172,150 A60,60 0 1 1 128,26 Z', sw=6) + HL('M74,60 A60,60 0 0 0 60,120') +
            ''.join(f'<path d="{star(x, y, r, r * .42)}" fill="{a}" stroke="{INK}" stroke-width="2.5"/>' for x, y, r in ((150, 76, 14), (176, 108, 9), (132, 104, 7))))
def i_mountain(a):
    return (P('M8,176 L70,66 L100,108 L128,52 L192,176 Z', sw=6) +
            '<path d="M70,66 L58,88 L70,82 L80,94 Z M128,52 L114,78 L128,70 L140,82 Z" fill="#fff" opacity=".9"/>' +
            f'<path d="M8,176 Q60,156 100,170 T192,170 L192,186 L8,186 Z" fill="{a}" stroke="{INK}" stroke-width="4"/>')
def i_sky(a):
    cloud = 'M40,140 C18,140 12,116 28,104 C26,82 46,70 64,78 C72,56 100,48 120,62 C136,50 162,58 166,80 C186,82 196,104 184,120 C192,134 182,148 166,146 Z'
    return (P(cloud, sw=6) + HL('M56,86 C66,70 92,62 112,72') +
            f'<path d="M20,166 H120 M60,182 H170 M140,166 H184" stroke="{a}" stroke-width="6" stroke-linecap="round"/>' +
            L('M120,34 Q132,24 142,34 Q152,24 164,34', 4, a))
def i_cassette(a):
    return (P('M24,52 H176 Q184,52 184,60 V150 Q184,158 176,158 H24 Q16,158 16,150 V60 Q16,52 24,52 Z', sw=6) +
            f'<rect x="34" y="66" width="132" height="54" rx="6" fill="{a}" stroke="{INK}" stroke-width="4"/>' +
            ''.join(f'<circle cx="{x}" cy="93" r="16" fill="#fff" stroke="{INK}" stroke-width="4"/><circle cx="{x}" cy="93" r="6" fill="{INK}"/>' for x in (70, 130)) +
            P('M52,158 L62,132 H138 L148,158 Z', sw=4.5) + HL('M28,60 H120'))
def i_chip(a):
    pins = ''.join(f'<path d="M{x},26 V48 M{x},152 V174 M26,{x} H48 M152,{x} H174" stroke="{INK}" stroke-width="9" stroke-linecap="round"/><path d="M{x},26 V48 M{x},152 V174 M26,{x} H48 M152,{x} H174" stroke="{M}" stroke-width="4.5" stroke-linecap="round"/>' for x in (68, 100, 132))
    return (pins + P('M58,48 H142 Q152,48 152,58 V142 Q152,152 142,152 H58 Q48,152 48,142 V58 Q48,48 58,48 Z', sw=6) +
            f'<rect x="76" y="76" width="48" height="48" rx="6" fill="{a}" stroke="{INK}" stroke-width="4"/>' +
            f'<path d="M64,64 L76,76 M136,64 L124,76 M64,136 L76,124 M136,136 L124,124" stroke="{a}" stroke-width="3"/>' + HL('M60,58 H120'))
def i_knight(a):
    return (P('M54,40 Q100,16 146,40 L152,150 Q100,180 48,150 Z', sw=6) + HL('M62,48 Q100,28 138,48') +
            f'<path d="M52,92 H148 L148,104 H52 Z" fill="{INK}"/><path d="M100,104 V160" stroke="{INK}" stroke-width="7"/>' +
            ''.join(f'<circle cx="{x}" cy="{y}" r="3.5" fill="{INK}"/>' for x in (80, 120) for y in (122, 136, 150)) +
            f'<path d="M100,30 V82 M84,52 H116" stroke="{a}" stroke-width="7" stroke-linecap="round"/>')
def i_dragon(a):
    return (P('M150,46 L176,16 L170,62 Z', sw=4.5) + P('M118,52 L134,18 L142,58 Z', sw=4.5) +
            P('M24,118 C30,86 70,62 116,66 C146,68 176,84 184,108 C186,122 176,128 164,126 L120,124 L170,142 C160,158 120,162 88,152 C56,144 22,140 24,118 Z', sw=6) +
            HL('M44,100 C64,80 96,72 124,74') +
            f'<path d="M132,92 Q146,84 158,94 Q146,104 132,92 Z" fill="{a}" stroke="{INK}" stroke-width="3"/>' +
            '<path d="M124,124 L130,134 L136,125 L142,135 L148,126 L154,136" stroke="#fff" stroke-width="3" fill="none"/>' +
            f'<path d="M30,120 C14,118 6,128 8,140 M40,132 C26,140 26,152 34,160" stroke="{a}" stroke-width="5" fill="none" stroke-linecap="round"/>')
def i_crosshair(a):
    return (f'<circle cx="100" cy="100" r="66" fill="none" stroke="{INK}" stroke-width="20"/><circle cx="100" cy="100" r="66" fill="none" stroke="{M}" stroke-width="12"/>' +
            f'<circle cx="100" cy="100" r="34" fill="none" stroke="{INK}" stroke-width="12"/><circle cx="100" cy="100" r="34" fill="none" stroke="{M}" stroke-width="6"/>' +
            L('M100,14 V58 M100,142 V186 M14,100 H58 M142,100 H186', 7) + f'<circle cx="100" cy="100" r="9" fill="{a}" stroke="{INK}" stroke-width="3.5"/>')
def i_antler(a):
    ant = L('M84,110 C70,84 58,64 52,30 M64,70 C46,66 32,56 26,40 M58,48 C66,38 72,28 74,16 M74,92 C58,96 42,94 32,86', 8)
    return (ant + MIR(ant) + P('M74,104 Q100,94 126,104 L114,176 Q100,188 86,176 Z', sw=6) +
            f'<path d="M86,128 L96,132 M114,128 L104,132" stroke="{a}" stroke-width="5" stroke-linecap="round"/><ellipse cx="100" cy="170" rx="8" ry="6" fill="{INK}"/>')
def i_scales(a):
    pan = lambda x: (f'<path d="M{x},64 L{x - 30},126 M{x},64 L{x + 30},126" stroke="{INK}" stroke-width="3" fill="none"/>' +
                     P(f'M{x - 36},124 H{x + 36} Q{x + 30},150 {x},150 Q{x - 30},150 {x - 36},124 Z', sw=5))
    return (L('M100,30 V176', 9) + P('M62,176 H138 L130,190 H70 Z', sw=5) + L('M26,64 H174', 8) + pan(40) + pan(160) +
            f'<circle cx="100" cy="30" r="12" fill="{a}" stroke="{INK}" stroke-width="4"/>')
def i_spiral(a):
    d = 'M100,100 C100,92 112,90 114,100 C118,118 94,124 86,108 C74,84 106,66 126,80 C154,98 140,142 106,146 C64,150 46,106 64,74 C86,36 146,36 168,76'
    shards = ''.join(f'<path d="{star(x, y, r, r * .3, 4, rot)}" fill="{a}" stroke="{INK}" stroke-width="2.5"/>' for x, y, r, rot in ((40, 40, 14, 10), (170, 150, 16, 30), (32, 160, 10, 0), (170, 34, 9, 20)))
    return L(d, 12) + shards
def i_robot(a):
    return (L('M100,44 V22', 6) + f'<circle cx="100" cy="18" r="9" fill="{a}" stroke="{INK}" stroke-width="4"/>' +
            P('M46,52 H154 Q170,52 170,68 V146 Q170,162 154,162 H46 Q30,162 30,146 V68 Q30,52 46,52 Z', sw=6) + HL('M46,62 H140') +
            ''.join(P(f'M{x},92 m-18,0 a18,18 0 1,0 36,0 a18,18 0 1,0 -36,0', fill=a, sw=4.5) for x in (72, 128)) +
            f'<rect x="64" y="126" width="72" height="18" rx="4" fill="{INK}"/>' + ''.join(f'<path d="M{x},126 V144" stroke="{M}" stroke-width="3"/>' for x in (82, 100, 118)) +
            P('M18,90 H30 V124 H18 Z', sw=4) + P('M170,90 H182 V124 H170 Z', sw=4))
def i_alien(a):
    return (P('M100,18 C150,18 178,52 176,92 C174,134 132,178 100,186 C68,178 26,134 24,92 C22,52 50,18 100,18 Z', sw=6) + HL('M48,58 C60,36 84,28 104,28') +
            f'<path d="M48,92 C60,76 86,82 92,104 C80,118 54,114 48,92 Z M152,92 C140,76 114,82 108,104 C120,118 146,114 152,92 Z" fill="{INK}"/>' +
            f'<circle cx="68" cy="94" r="5" fill="{a}"/><circle cx="132" cy="94" r="5" fill="{a}"/><path d="M90,150 Q100,156 110,150" stroke="{INK}" stroke-width="4" fill="none"/>')
def i_skull(a):
    bones = L('M30,150 L170,186 M170,150 L30,186', 10) + ''.join(f'<circle cx="{x}" cy="{y}" r="9" fill="{M}" stroke="{INK}" stroke-width="4"/>' for x, y in ((26, 144), (34, 158), (174, 144), (166, 158), (26, 192), (34, 180), (174, 192), (166, 180)))
    return (bones + P('M100,24 C146,24 166,54 162,92 C160,112 150,122 140,126 L138,150 H62 L60,126 C50,122 40,112 38,92 C34,54 54,24 100,24 Z', sw=6) +
            f'<path d="M38,70 C60,40 140,40 162,70 L160,82 C130,62 70,62 40,82 Z" fill="{a}" stroke="{INK}" stroke-width="4"/><path d="M160,76 L184,66 L178,92 Z" fill="{a}" stroke="{INK}" stroke-width="4"/>' +
            f'<ellipse cx="76" cy="102" rx="15" ry="13" fill="{INK}"/><ellipse cx="124" cy="102" rx="15" ry="13" fill="{INK}"/><path d="M100,112 L92,128 H108 Z" fill="{INK}"/>' +
            ''.join(f'<path d="M{x},138 V150" stroke="{INK}" stroke-width="3"/>' for x in (80, 92, 104, 116)))
def i_shuriken(a):
    return (f'<g transform="rotate(15 100 100)">{P(star(100, 100, 86, 26, 4, -90), sw=6)}</g>' + HL('M100,24 L112,86') +
            f'<circle cx="100" cy="100" r="16" fill="{INK}"/><circle cx="100" cy="100" r="8" fill="{a}"/>')
def i_viking(a):
    horn = P('M58,96 C30,92 14,66 18,36 C30,58 46,68 66,74 Z', fill='#f2ead6', sw=5)
    return (horn + MIR(horn) + P('M50,112 C50,62 150,62 150,112 L150,128 H50 Z', sw=6) + HL('M60,96 C66,74 100,66 130,78') +
            P('M44,124 H156 V142 H44 Z', fill=a, sw=4.5) + P('M92,140 H108 L106,182 H94 Z', sw=4.5) +
            ''.join(f'<circle cx="{x}" cy="133" r="3" fill="{INK}"/>' for x in (60, 80, 120, 140)))
def i_spartan(a):
    bristles = ''.join(f'<path d="M{100 + 70 * math.cos(math.radians(t)):.0f},{70 + 60 * math.sin(math.radians(t)):.0f} L100,72" stroke="{INK}" stroke-width="2" opacity=".35"/>' for t in range(200, 341, 14))
    return (P('M32,72 C32,4 168,4 168,72 C150,52 124,44 100,44 C76,44 50,52 32,72 Z', fill=a, sw=5) + bristles +
            P('M56,76 Q100,46 144,76 L150,180 L122,180 L116,118 L84,118 L78,180 L50,180 Z', sw=6) + HL('M64,82 Q100,60 136,82') +
            f'<path d="M84,118 V96 H116 V118" stroke="{INK}" stroke-width="5" fill="none"/>')
def i_leaf(a):
    return (P('M100,186 C40,170 18,110 34,62 C50,24 100,12 138,28 C176,46 186,100 168,140 C154,170 128,184 100,186 Z', sw=6) +
            f'<path d="M100,186 C104,140 112,90 130,40" stroke="{INK}" stroke-width="5" fill="none"/>' +
            ''.join(f'<path d="{d}" stroke="#0a0a0a" stroke-width="7" fill="none" stroke-linecap="round"/>' for d in ('M40,90 L84,104', 'M38,130 L90,136', 'M164,76 L120,92', 'M170,118 L114,128', 'M70,40 L98,72')) +
            f'<circle cx="150" cy="40" r="6" fill="{a}"/>')
def i_cactus(a):
    return (f'<circle cx="150" cy="56" r="30" fill="{a}" stroke="{INK}" stroke-width="4"/>' +
            P('M86,190 V60 Q86,40 100,40 Q114,40 114,60 V190 Z', sw=6) + P('M86,130 H64 Q50,130 50,116 V84 Q50,74 58,74 Q66,74 66,84 V112 H86 Z', sw=5) +
            P('M114,110 H136 Q148,110 148,98 V74 Q148,64 140,64 Q132,64 132,74 V94 H114 Z', sw=5) + HL('M96,56 V170') +
            f'<path d="M30,190 Q100,174 170,190" stroke="{INK}" stroke-width="5" fill="none"/>')
def i_football(a):
    return football(100, 100, 3.6, -30) + f'<path d="M30,170 L48,152 M152,48 L170,30" stroke="{a}" stroke-width="6" stroke-linecap="round"/>'
def i_basketball(a):
    return (f'<circle cx="100" cy="100" r="80" fill="{M}" stroke="{INK}" stroke-width="6"/>' +
            f'<path d="M20,100 H180 M100,20 V180 M44,44 C74,74 74,126 44,156 M156,44 C126,74 126,126 156,156" stroke="{INK}" stroke-width="5" fill="none"/>' +
            HL('M50,70 A60,60 0 0 1 90,32') + f'<path d="M168,176 L186,184 M174,166 L192,170" stroke="{a}" stroke-width="5" stroke-linecap="round"/>')
def i_lighthouse(a):
    beam = f'<path d="M100,46 L10,20 L10,60 Z M100,46 L190,20 L190,60 Z" fill="{a}" opacity=".45"/>'
    return (beam + P('M76,62 H124 L134,180 H66 Z', sw=6) + P('M72,98 H128 L130,118 H70 Z', fill=a, sw=4) + P('M68,140 H132 L134,158 H66 Z', fill=a, sw=4) +
            P('M80,34 H120 V62 H80 Z', fill='#fff3c4', sw=5) + P('M74,34 L100,14 L126,34 Z', sw=5) +
            f'<path d="M40,188 Q100,172 160,188" stroke="{INK}" stroke-width="5" fill="none"/>')
def i_palm(a):
    frond = lambda d: P(d, sw=4.5)
    return (f'<path d="M24,150 A76,76 0 0 1 176,150 Z" fill="{a}" opacity=".85" stroke="{INK}" stroke-width="4"/>' +
            L('M108,190 C104,150 106,110 100,70', 10) +
            frond('M100,68 C80,46 50,44 28,60 C52,58 72,64 94,76 Z') + frond('M100,68 C120,42 152,40 174,58 C150,56 128,64 108,78 Z') +
            frond('M100,68 C88,36 92,18 104,6 C106,30 106,50 104,72 Z') + frond('M100,70 C76,72 54,90 48,114 C66,96 82,86 100,78 Z') +
            frond('M104,70 C128,74 148,92 152,116 C136,98 120,88 104,80 Z') +
            f'<path d="M14,190 H186" stroke="{INK}" stroke-width="5"/>')
def i_paw(a, crown=False):
    pad = P('M100,106 C126,106 150,130 150,152 C150,172 132,180 118,176 C110,174 106,170 100,170 C94,170 90,174 82,176 C68,180 50,172 50,152 C50,130 74,106 100,106 Z', sw=6)
    toes = ''.join(P(f'M{x},{y} m-{r},0 a{r},{r + 3} 0 1,0 {2 * r},0 a{r},{r + 3} 0 1,0 -{2 * r},0', sw=5) for x, y, r in ((44, 104, 16), (76, 70, 17), (124, 70, 17), (156, 104, 16)))
    c = ''
    if crown:
        c = P('M66,44 L60,10 L82,28 L100,4 L118,28 L140,10 L134,44 Z', fill=a, sw=4.5) + f'<circle cx="100" cy="30" r="5" fill="#fff"/>'
        toes = ''.join(P(f'M{x},{y} m-{r},0 a{r},{r + 3} 0 1,0 {2 * r},0 a{r},{r + 3} 0 1,0 -{2 * r},0', sw=5) for x, y, r in ((44, 112, 15), (74, 80, 16), (126, 80, 16), (156, 112, 15)))
    return toes + pad + c + HL('M70,122 C80,112 96,110 108,112')
def i_topdog(a):
    return i_paw(a, crown=True)

def i_anchor(a):
    return (f'<circle cx="100" cy="34" r="18" fill="none" stroke="{INK}" stroke-width="16"/><circle cx="100" cy="34" r="18" fill="none" stroke="{M}" stroke-width="9"/>' +
            P('M90,50 H110 V160 H90 Z', sw=5) + P('M58,70 H142 Q150,70 150,80 Q150,90 142,90 H58 Q50,90 50,80 Q50,70 58,70 Z', sw=5) +
            P('M24,112 L44,98 L48,120 C58,150 78,166 100,170 C122,166 142,150 152,120 L156,98 L176,112 C172,156 140,188 100,190 C60,188 28,156 24,112 Z', sw=6) +
            HL('M40,128 C52,158 76,176 100,180') + f'<circle cx="100" cy="80" r="6" fill="{a}"/>' +
            f'<path d="M30,104 L44,98 M170,104 L156,98" stroke="{a}" stroke-width="5" stroke-linecap="round"/>')
def i_rocket(a):
    fin = P('M76,118 L46,150 L50,176 L80,156 Z', fill=a, sw=4.5)
    return (f'<path d="M84,160 Q100,200 116,160 Q108,176 100,196 Q92,176 84,160 Z" fill="#ffb347" stroke="{INK}" stroke-width="3.5"/>' +
            fin + MIR(fin) + P('M100,12 C134,40 140,90 128,160 H72 C60,90 66,40 100,12 Z', sw=6) + HL('M88,40 C80,64 78,96 82,140') +
            f'<circle cx="100" cy="82" r="18" fill="{a}" stroke="{INK}" stroke-width="5"/><circle cx="94" cy="76" r="5" fill="#fff" opacity=".8"/>' +
            P('M86,160 H114 L110,172 H90 Z', sw=4))
EXTRA = [(i_anchor, '#4fb3d9'), (i_rocket, '#e8503a')]

# ---------------------------------------------------------------- 20 contrasting pairs (side: id, name, icon, light, mid, dark, accent)
PAIRS = [
    (('rookie', 'Rookie', i_sprout, '#e9ffd6', '#7fd44a', '#2e5a14', '#c6ff7a'), ('vet', 'Vet', i_vet, '#fff1d0', '#c9a24a', '#5a4210', '#ffd36b')),
    (('blue', 'Blue', i_shieldstar, '#dcecff', '#3d7dff', '#12306e', '#9fd0ff'), ('red', 'Red', i_shieldstar, '#ffe0dc', '#e0334f', '#5e0f1c', '#ffd0d6')),
    (('angelic', 'Angelic', i_angel, '#ffffff', '#e6e1c6', '#8e8452', '#fff1a0'), ('demonic', 'Demonic', i_demon, '#ffd0c8', '#c81e1e', '#3a0606', '#ff7a3a')),
    (('surf', 'Surf', i_wave, '#dffbff', '#2fc4e0', '#0b4a5e', '#9ff4ff'), ('turf', 'Turf', i_turf, '#e6ffd8', '#3aa84a', '#0f3a14', '#a8ff7a')),
    (('black', 'Black', i_buffalo, '#ffffff', '#b9c0cc', '#4a515e', '#ff5a3a'), ('gold', 'Gold', i_buffalo, '#fff3c4', '#e8b84a', '#7a5214', '#ff5a3a')),
    (('fire', 'Fire', i_flame, '#fff0c8', '#ff7a2f', '#6e1a06', '#ffd23f'), ('ice', 'Ice', i_snow, '#f2fbff', '#8fd8ff', '#1e4a6e', '#ffffff')),
    (('heroes', 'Heroes', i_hero, '#e0ecff', '#2f6bff', '#0e2466', '#ffd23f'), ('villains', 'Villains', i_villain, '#efe0ff', '#7a2ad8', '#24063e', '#7fff6a')),
    (('day', 'Day', i_sun, '#fff8d6', '#ffc23a', '#8a5a06', '#ffffff'), ('night', 'Night', i_moon, '#e8ecff', '#5a6ad8', '#141a4a', '#fff3a0')),
    (('earth', 'Earth', i_mountain, '#f2e6d6', '#a8743a', '#3e2410', '#7fd44a'), ('sky', 'Sky', i_sky, '#eef8ff', '#7fbfff', '#1e3e6e', '#ffffff')),
    (('oldschool', 'Old School', i_cassette, '#fbe8cf', '#c8823a', '#4a2a10', '#ff6a3a'), ('newschool', 'New School', i_chip, '#e0fff8', '#2ae0c0', '#06463e', '#a0fff0')),
    (('knights', 'Knights', i_knight, '#eef1f6', '#9aa6b8', '#2e3644', '#e0334f'), ('dragons', 'Dragons', i_dragon, '#ffe6c8', '#d84a1e', '#3e0e04', '#ffd23f')),
    (('hunters', 'Hunters', i_crosshair, '#f0f0e0', '#8a9a5a', '#2e3418', '#ff6a3a'), ('hunted', 'Hunted', i_antler, '#f6e8d8', '#b8804a', '#4a2a14', '#ffd8a0')),
    (('order', 'Order', i_scales, '#eef4ff', '#8aa8d8', '#1e2e4e', '#ffffff'), ('chaos', 'Chaos', i_spiral, '#ffe0f4', '#e02a8a', '#46062a', '#ff9ad6')),
    (('robots', 'Robots', i_robot, '#eef1f6', '#8a94a6', '#262b36', '#ffb02e'), ('aliens', 'Aliens', i_alien, '#e8ffe0', '#6ae04a', '#14460a', '#c8ff3a')),
    (('pirates', 'Pirates', i_skull, '#f6ecd8', '#c8a46a', '#3a2a14', '#e0334f'), ('ninjas', 'Ninjas', i_shuriken, '#e8e8f0', '#6a6a8a', '#14141e', '#e0334f')),
    (('vikings', 'Vikings', i_viking, '#eef1f6', '#8a9aa8', '#2a323c', '#c8823a'), ('spartans', 'Spartans', i_spartan, '#ffe6d0', '#c84a1e', '#3e1004', '#ffd23f')),
    (('jungle', 'Jungle', i_leaf, '#e6ffd8', '#2fa84a', '#0a3a14', '#ffd23f'), ('desert', 'Desert', i_cactus, '#fff0d6', '#e0a24a', '#5a3410', '#ff7a2f')),
    (('gridiron', 'Gridiron', i_football, '#ffe6d0', '#a8582a', '#3a1a08', '#ffffff'), ('hardwood', 'Hardwood', i_basketball, '#ffe6c8', '#ff8a2a', '#5a2408', '#ffffff')),
    (('eastcoast', 'East Coast', i_lighthouse, '#e0f0ff', '#3a7ad8', '#0e2a4e', '#ffd23f'), ('westcoast', 'West Coast', i_palm, '#fff0e0', '#ff7a5a', '#5a1e2a', '#ffd23f')),
    (('underdogs', 'Underdogs', i_paw, '#f0e8e0', '#a08a7a', '#3a2e26', '#ffb08a'), ('topdogs', 'Top Dogs', i_topdog, '#fff3c4', '#e8b84a', '#7a5214', '#ffffff')),
]
SIDES = {s[0]: s for p in PAIRS for s in p}
SILVER = ('#ffffff', '#b9c0cc', '#4a515e')

def lum(h):
    h = h.lstrip('#'); r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return .2126 * r + .7152 * g + .0722 * b

def pal_defs(light, mid, dark, accent, u):
    return (lg('M', [(0, light), (.45, mid), (1, dark)], 1, 1) + lg(f'{u}r', [(0, light), (.5, mid), (1, dark)], 0, 1) +
            rg(f'{u}f', [(0, dark), (.55, '#0b0c10'), (1, '#050506')], '50%', '30%', '80%') + rg(f'{u}g', [(0, accent + '99'), (1, accent + '00')]))

def medallion(side, blank=False):
    sid, name, icon, light, mid, dark, acc = SIDES[side]; u = 'm'
    b = f'''<circle cx="150" cy="150" r="142" fill="url(#{u}r)" stroke="{INK}" stroke-width="5"/>
<circle cx="150" cy="150" r="118" fill="url(#{u}f)" stroke="{INK}" stroke-width="4"/>
<circle cx="150" cy="150" r="110" fill="url(#{u}g)" opacity=".45"/>{stars(10, len(sid) * 11, 300, 300, 140)}
{''.join(f'<circle cx="{150 + 130 * math.cos(math.radians(t)):.1f}" cy="{150 + 130 * math.sin(math.radians(t)):.1f}" r="3.2" fill="{dark}"/>' for t in range(0, 360, 30))}
{'' if blank else f'<g transform="translate(58,58) scale(.92)">{icon(acc)}</g>'}'''
    return svg(300, 300, b, f'{name} division medallion', pal_defs(light, mid, dark, acc, u))

def ring(side):
    """Blank medallion ring in the side's palette; the app overlays the chosen emblem (left/top 19.3%, width 61.3%)."""
    return medallion(side, blank=True)

def library_icon(fn, acc, label):
    return svg(200, 200, f'<g transform="translate(4,4) scale(.96)">{fn(acc)}</g>', label, lg('M', [(0, SILVER[0]), (.45, SILVER[1]), (1, SILVER[2])], 1, 1))

def frame(side):
    sid, name, icon, light, mid, dark, acc = SIDES[side]; u = 'f'
    txt = '#1a1204' if lum(mid) > .45 else '#ffffff'
    b = f'''<path d="{K.SHIELD_O}" fill="url(#{u}r)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="{K.SHIELD_I}" fill="url(#{u}f)" stroke="{INK}" stroke-width="3"/>
<path d="M150,26 L256,57 L247,194 C238,250 200,282 150,300 Z" fill="#000" opacity=".22"/>
<circle cx="150" cy="150" r="104" fill="url(#{u}g)" opacity=".6"/>
{''.join(f'<path d="M150,150 L{150 + 200 * math.cos(t / 12 * 6.283):.0f},{150 + 200 * math.sin(t / 12 * 6.283):.0f}" stroke="{acc}" stroke-opacity=".07" stroke-width="10"/>' for t in range(12))}
{stars(10, len(sid) * 7, 300, 300, 110)}
<path d="M80,18 L220,18 L214,44 L86,44 Z" fill="{mid}" stroke="{INK}" stroke-width="3"/>
{K.ribbon(u, '', 268, mid, dark, txt, 220)}
{K.sig(150, 333, 13)}'''
    return svg(300, 340, b, f'{name} crest frame (blank)', pal_defs(light, mid, dark, acc, u))

def manifest():
    pairs = [{'a': p[0][0], 'b': p[1][0]} for p in PAIRS]
    sides = {}
    for sid, name, icon, light, mid, dark, acc in SIDES.values():
        sides[sid] = {'name': name, 'light': light, 'mid': mid, 'dark': dark, 'accent': acc, 'ink': '#1a1204' if lum(mid) > .45 else '#ffffff',
                      'medallion': f'medallions/{sid}.svg', 'ring': f'rings/{sid}.svg', 'frame': f'frames/{sid}.svg', 'icon': f'library/{icon.__name__[2:]}.svg'}
    lib = sorted({f'library/{s[2].__name__[2:]}.svg' for s in SIDES.values()} | {f'library/{c.lower()}.svg' for c in K.CONFS} | {f'library/{f.__name__[2:]}.svg' for f, _ in EXTRA})
    return {'pairs': pairs, 'sides': sides, 'library': lib}

def all_files():
    out = {}
    for sid in SIDES:
        out[f'medallions/{sid}.svg'] = medallion(sid)
        out[f'frames/{sid}.svg'] = frame(sid)
        out[f'rings/{sid}.svg'] = ring(sid)
    seen = set()
    for sid, name, icon, light, mid, dark, acc in SIDES.values():
        key = icon.__name__[2:]
        if key in seen: continue
        seen.add(key); out[f'library/{key}.svg'] = library_icon(icon, acc, f'{key} emblem')
    for c in K.CONFS:
        out[f'library/{c.lower()}.svg'] = library_icon(K.MASCOT[c], K.ACC[c], f'{c.lower()} emblem')
    for f, acc in EXTRA:
        out[f'library/{f.__name__[2:]}.svg'] = library_icon(f, acc, f'{f.__name__[2:]} emblem')
    return {p: K.uniq(v, 'div-' + p.replace('/', '-')[:-4]) for p, v in out.items()}

if __name__ == '__main__':
    base = os.path.join(sys.argv[1], 'div'); n = 0
    for p, s in all_files().items():
        os.makedirs(os.path.dirname(os.path.join(base, p)), exist_ok=True); open(os.path.join(base, p), 'w').write(s); n += 1
    json.dump(manifest(), open(os.path.join(base, 'manifest.json'), 'w'), indent=1)
    print('wrote', n, 'library', len(manifest()['library']))
