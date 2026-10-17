"""Black & Gold league art pack (created by KB): 10 conferences x Black/Gold divisions + tournament marks.
Usage: python3 gen_kbi.py <out_dir>   -> writes <out_dir>/kbi/{crests,banners,marks}/*.svg"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_a import svg, lg, rg, ribbon, stars, football, INK

CONFS = ['BEAST', 'GOAT', 'GRIZZ', 'KINGS', 'REBELS', 'SMOKE', 'STEALTH', 'SWAMP', 'THUNDER', 'WARRIOR']
ACC = {'BEAST': '#e5432f', 'GOAT': '#9b6bff', 'GRIZZ': '#e08a3c', 'KINGS': '#3d7dff', 'REBELS': '#e0334f',
       'SMOKE': '#7fd6d0', 'STEALTH': '#b06bff', 'SWAMP': '#4fcf6a', 'THUNDER': '#ffd23f', 'WARRIOR': '#ff7a2f'}
DIV = {
    'BLACK': dict(metal=[(0, '#ffffff'), (.4, '#b9c0cc'), (1, '#4a515e')], rim=[(0, '#e6e9ef'), (.5, '#6c7482'), (1, '#262a33')],
                  field=[(0, '#20232c'), (1, '#050608')], rib=('#1b1e26', '#0a0b0f', '#e8eaf2'), tab='#0f1116', tabtxt='#c9ced8'),
    'GOLD': dict(metal=[(0, '#fff3c4'), (.45, '#e8b84a'), (1, '#7a5214')], rim=[(0, '#fff0b8'), (.5, '#b8862a'), (1, '#4a3008')],
                 field=[(0, '#2c220e'), (1, '#060504')], rib=('#c8902a', '#6e4a0e', '#1a1204'), tab='#e8b84a', tabtxt='#1a1204'),
}
FONT = "Archivo Black, Archivo, Arial Black, sans-serif"

# ---------------------------------------------------------------- mascots (200x200 box, metal fill = url(#M), accent = a)
def m_beast(a):
    return f'''<path d="M62,66 C34,58 20,30 30,6 C40,32 58,42 76,50 Z" fill="url(#M)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M138,66 C166,58 180,30 170,6 C160,32 142,42 124,50 Z" fill="url(#M)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M56,56 Q100,36 144,56 L152,98 Q146,146 100,178 Q54,146 48,98 Z" fill="url(#M)" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
<path d="M64,62 Q100,48 136,62" stroke="#fff" stroke-opacity=".55" stroke-width="4" fill="none"/>
<path d="M62,92 L92,104 L86,112 L64,104 Z M138,92 L108,104 L114,112 L136,104 Z" fill="{a}" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M88,124 L100,118 L112,124 L106,134 L94,134 Z" fill="{INK}"/>
<path d="M70,142 Q100,160 130,142 L124,150 L118,142 L112,154 L106,144 L100,156 L94,144 L88,154 L82,142 L76,150 Z" fill="#fff" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>
<path d="M100,40 V66" stroke="{INK}" stroke-width="3" opacity=".6"/>'''

def m_goat(a):
    return f'''<path d="M84,58 C60,24 14,34 20,76 C24,104 58,104 60,82 C61,70 50,66 44,74" fill="none" stroke="{INK}" stroke-width="22" stroke-linecap="round"/>
<path d="M84,58 C60,24 14,34 20,76 C24,104 58,104 60,82 C61,70 50,66 44,74" fill="none" stroke="url(#M)" stroke-width="14" stroke-linecap="round"/>
<path d="M116,58 C140,24 186,34 180,76 C176,104 142,104 140,82 C139,70 150,66 156,74" fill="none" stroke="{INK}" stroke-width="22" stroke-linecap="round"/>
<path d="M116,58 C140,24 186,34 180,76 C176,104 142,104 140,82 C139,70 150,66 156,74" fill="none" stroke="url(#M)" stroke-width="14" stroke-linecap="round"/>
<path d="M66,92 L44,100 L66,108 Z M134,92 L156,100 L134,108 Z" fill="url(#M)" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
<path d="M72,60 Q100,46 128,60 L126,124 Q118,150 100,154 Q82,150 74,124 Z" fill="url(#M)" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
<path d="M80,64 Q100,54 120,64" stroke="#fff" stroke-opacity=".55" stroke-width="4" fill="none"/>
<path d="M78,94 L94,98 L90,106 L78,102 Z M122,94 L106,98 L110,106 L122,102 Z" fill="{a}" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>
<ellipse cx="100" cy="138" rx="14" ry="9" fill="{INK}" opacity=".85"/>
<path d="M86,150 L100,192 L114,150 Z" fill="url(#M)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'''

def m_grizz(a):
    return f'''<circle cx="52" cy="54" r="24" fill="url(#M)" stroke="{INK}" stroke-width="6"/><circle cx="52" cy="54" r="11" fill="{INK}" opacity=".7"/>
<circle cx="148" cy="54" r="24" fill="url(#M)" stroke="{INK}" stroke-width="6"/><circle cx="148" cy="54" r="11" fill="{INK}" opacity=".7"/>
<path d="M100,40 C150,40 172,74 168,112 C164,150 134,178 100,180 C66,178 36,150 32,112 C28,74 50,40 100,40 Z" fill="url(#M)" stroke="{INK}" stroke-width="6"/>
<path d="M58,66 Q100,46 142,66" stroke="#fff" stroke-opacity=".55" stroke-width="4" fill="none"/>
<path d="M62,88 L88,96 L84,104 L64,98 Z M138,88 L112,96 L116,104 L136,98 Z" fill="{a}" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>
<ellipse cx="100" cy="138" rx="34" ry="28" fill="#000" opacity=".25" stroke="{INK}" stroke-width="4"/>
<path d="M86,124 Q100,116 114,124 Q112,136 100,138 Q88,136 86,124 Z" fill="{INK}"/>
<path d="M100,138 V150 M88,156 Q100,162 112,156" stroke="{INK}" stroke-width="4" fill="none" stroke-linecap="round"/>
<path d="M134,62 L150,96 M142,58 L158,90 M150,56 L164,84" stroke="{a}" stroke-width="4" stroke-linecap="round" opacity=".9"/>'''

def m_kings(a):
    return f'''<path d="M28,150 L18,62 L60,102 L100,40 L140,102 L182,62 L172,150 Z" fill="url(#M)" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
<path d="M34,140 L28,84 L60,114 L100,58" stroke="#fff" stroke-opacity=".55" stroke-width="4" fill="none"/>
<circle cx="18" cy="56" r="11" fill="url(#M)" stroke="{INK}" stroke-width="4.5"/><circle cx="100" cy="32" r="12" fill="url(#M)" stroke="{INK}" stroke-width="4.5"/><circle cx="182" cy="56" r="11" fill="url(#M)" stroke="{INK}" stroke-width="4.5"/>
<rect x="24" y="146" width="152" height="30" rx="5" fill="url(#M)" stroke="{INK}" stroke-width="6"/>
<circle cx="100" cy="161" r="9" fill="{a}" stroke="{INK}" stroke-width="3.5"/><circle cx="58" cy="161" r="6" fill="{a}" stroke="{INK}" stroke-width="3"/><circle cx="142" cy="161" r="6" fill="{a}" stroke="{INK}" stroke-width="3"/>
<path d="M100,96 l12,22 -12,22 -12,-22 Z" fill="{a}" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'''

def m_rebels(a):
    star = 'M100,22 L120,74 L176,76 L132,110 L148,164 L100,132 L52,164 L68,110 L24,76 L80,74 Z'
    return f'''<g stroke="{INK}" stroke-width="5" stroke-linejoin="round">
<path d="M30,176 L150,40 L160,30 L170,40 L160,50 L40,186 Z" fill="url(#M)"/><path d="M170,176 L50,40 L40,30 L30,40 L40,50 L160,186 Z" fill="url(#M)"/>
<rect x="18" y="164" width="34" height="12" rx="3" fill="{a}" transform="rotate(-48 35 170)"/><rect x="148" y="164" width="34" height="12" rx="3" fill="{a}" transform="rotate(48 165 170)"/></g>
<path d="{star}" fill="url(#M)" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
<path d="M100,44 L114,80 L152,82" stroke="#fff" stroke-opacity=".6" stroke-width="4" fill="none"/>
<circle cx="100" cy="98" r="20" fill="{a}" stroke="{INK}" stroke-width="4.5"/><path d="M100,84 L104,94 L114,96 L106,102 L108,112 L100,106 L92,112 L94,102 L86,96 L96,94 Z" fill="#fff"/>'''

def m_smoke(a):
    """Soft rising smoke: three filtered layers (haze, body, fine filaments) from a faint ember."""
    P = 'M100,196 C98,178 104,166 100,152 C95,136 82,130 86,112 C90,96 112,98 114,82 C116,66 98,62 96,48 C94,34 108,26 106,12 C105,4 98,-2 100,-10'
    P2 = 'M101,196 C104,176 96,166 102,150 C108,134 120,128 114,110 C108,94 88,96 88,80 C88,66 104,60 102,46 C100,36 94,30 96,20'
    L1 = 'M90,118 C68,112 60,90 73,80 C86,70 101,83 92,94 C86,100 78,94 82,88'
    L2 = 'M113,80 C134,73 142,54 129,43 C117,34 105,49 114,58'
    L3 = 'M96,48 C78,42 72,26 82,18 C90,12 98,20 92,26'
    F = 'M104,150 C122,140 130,124 123,108 C119,98 128,88 138,82'
    haze = ''.join(f'<path d="{d}" fill="none" stroke="url(#M)" stroke-width="{w}" stroke-opacity="{o}" stroke-linecap="round"/>' for d, w, o in ((P, 30, .16), (L1, 20, .12), (L2, 20, .12)))
    body = ''.join(f'<path d="{d}" fill="none" stroke="url(#M)" stroke-width="{w}" stroke-opacity="{o}" stroke-linecap="round"/>' for d, w, o in ((P, 10, .55), (P2, 6, .4), (L1, 6, .45), (L2, 6, .45), (L3, 4, .35)))
    fine = ''.join(f'<path d="{d}" fill="none" stroke="url(#M)" stroke-width="{w}" stroke-opacity="{o}" stroke-linecap="round"/>' for d, w, o in ((P, 3, .95), (P2, 1.6, .8), (L1, 2, .85), (L2, 2, .85), (L3, 1.5, .7), (F, 1.2, .55)))
    def flt(i, freq, scale, blur):
        return (f'<filter id="{i}" x="-60%" y="-30%" width="220%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="{freq}" numOctaves="2" seed="11" result="n"/>'
                f'<feDisplacementMap in="SourceGraphic" in2="n" scale="{scale}" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="{blur}"/></filter>')
    return f'''{flt('smh', '0.008 0.02', 34, 8)}{flt('smb', '0.01 0.024', 18, 2.4)}{flt('smf', '0.01 0.024', 14, 0.5)}
<filter id="smke" x="-100%" y="-200%" width="300%" height="500%"><feGaussianBlur stdDeviation="5"/></filter>
<ellipse cx="100" cy="196" rx="16" ry="5" fill="{a}" opacity=".5" filter="url(#smke)"/>
<g filter="url(#smh)">{haze}</g><g filter="url(#smb)">{body}</g><g filter="url(#smf)">{fine}</g>
<circle cx="100" cy="196" r="2.4" fill="#fff" opacity=".85"/>'''

def m_stealth(a):
    return f'''<path d="M150,96 C176,92 192,104 196,120 C182,112 168,112 156,116 Z M150,104 C172,118 180,138 176,152 C168,136 156,128 146,124 Z" fill="{a}" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>
<circle cx="100" cy="104" r="66" fill="url(#M)" stroke="{INK}" stroke-width="6"/>
<path d="M54,70 Q100,40 146,70" stroke="#fff" stroke-opacity=".55" stroke-width="4" fill="none"/>
<path d="M36,86 Q100,76 164,86 L164,118 Q100,108 36,118 Z" fill="{INK}"/>
<path d="M58,98 L92,92 L90,106 L60,108 Z M142,98 L108,92 L110,106 L140,108 Z" fill="{a}"/>
<path d="M40,128 Q100,118 160,128 L156,140 Q100,130 44,140 Z" fill="{INK}" opacity=".85"/>
<rect x="146" y="92" width="16" height="20" rx="3" fill="{a}" stroke="{INK}" stroke-width="3.5"/>'''

def m_swamp(a):
    return f'''<path d="M18,118 C24,92 52,78 84,76 C96,62 120,60 132,74 L188,92 C196,96 196,106 188,110 L120,122 L188,130 C196,134 194,144 186,146 L96,152 C60,156 26,146 18,118 Z" fill="url(#M)" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
<path d="M120,118 L184,112" stroke="{INK}" stroke-width="5"/>
<path d="M124,114 L130,104 L136,113 L142,103 L148,112 L154,102 L160,111 L166,101 L172,110 M126,122 L132,132 L138,123 L144,133 L150,124 L156,134 L162,125 L168,135" stroke="#fff" stroke-width="3.5" fill="none" stroke-linejoin="round"/>
<path d="M84,78 Q104,58 128,72" stroke="#fff" stroke-opacity=".6" stroke-width="4" fill="none"/>
<ellipse cx="104" cy="82" rx="16" ry="11" fill="url(#M)" stroke="{INK}" stroke-width="5"/><path d="M96,82 Q104,74 112,82 Q104,90 96,82 Z" fill="{a}" stroke="{INK}" stroke-width="2.5"/><path d="M104,76 V88" stroke="{INK}" stroke-width="2.5"/>
<path d="M30,108 l8,-8 4,8 8,-8 4,8 8,-8 4,8 M40,132 q16,6 32,2" stroke="{INK}" stroke-width="3.5" fill="none" opacity=".55"/>
<circle cx="180" cy="96" r="3.5" fill="{INK}"/><path d="M10,170 Q40,160 70,170 T130,170 T190,170" stroke="{a}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".85"/>'''

def m_thunder(a):
    return f'''<path d="M48,112 C26,112 18,92 30,78 C26,58 44,44 64,50 C70,28 98,18 118,30 C134,18 160,26 164,48 C184,50 192,72 180,86 C192,104 176,122 158,118 Z" fill="url(#M)" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
<path d="M60,58 C66,40 92,30 112,40 M124,36 C138,30 154,38 156,52" stroke="#fff" stroke-opacity=".6" stroke-width="4" fill="none" stroke-linecap="round"/>
<path d="M108,84 L72,140 L100,140 L82,194 L140,118 L110,118 L130,84 Z" fill="{a}" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
<path d="M114,92 L90,132" stroke="#fff" stroke-width="4" opacity=".8"/>
<path d="M40,140 L30,160 M168,136 L178,158 M150,150 L156,166" stroke="{a}" stroke-width="5" stroke-linecap="round" opacity=".7"/>'''

def m_warrior(a):
    return f'''<path d="M70,40 C96,4 158,6 184,42 C170,40 150,44 138,54 C120,44 96,40 70,40 Z" fill="{a}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M78,40 C100,22 150,20 176,40" stroke="{INK}" stroke-width="3" fill="none" opacity=".5"/>
<path d="M52,60 C60,40 96,34 124,40 C154,46 168,72 168,104 L168,170 L132,170 L132,128 L116,110 L116,170 L64,170 C44,150 40,100 52,60 Z" fill="url(#M)" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
<path d="M60,62 C70,48 98,44 120,48" stroke="#fff" stroke-opacity=".6" stroke-width="4" fill="none"/>
<path d="M60,98 L118,96 L118,110 L132,128 L132,170 M60,98 C58,120 60,146 66,166" stroke="{INK}" stroke-width="4.5" fill="none" stroke-linejoin="round"/>
<path d="M66,100 L114,100 L114,108 L66,112 Z" fill="{INK}"/><path d="M78,103 L106,102" stroke="{a}" stroke-width="3"/>
<circle cx="146" cy="78" r="6" fill="{a}" stroke="{INK}" stroke-width="2.5"/>'''

def m_buffalo(a, crown=False):
    c = ''
    if crown:
        c = f'''<path d="M66,34 L60,6 L80,22 L100,0 L120,22 L140,6 L134,34 Z" fill="url(#M)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<circle cx="100" cy="20" r="5" fill="{a}" stroke="{INK}" stroke-width="2.5"/>'''
    return f'''<path d="M58,62 C28,64 8,44 10,18 C22,38 40,44 62,44 Z" fill="url(#M)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M142,62 C172,64 192,44 190,18 C178,38 160,44 138,44 Z" fill="url(#M)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M44,70 L20,80 L42,92 Z M156,70 L180,80 L158,92 Z" fill="url(#M)" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>
<path d="M100,30 C140,30 160,52 158,84 C156,108 146,124 140,140 C134,166 122,186 100,190 C78,186 66,166 60,140 C54,124 44,108 42,84 C40,52 60,30 100,30 Z" fill="url(#M)" stroke="{INK}" stroke-width="6"/>
<path d="M60,48 C72,38 90,34 100,34 C110,34 128,38 140,48 C130,62 116,58 108,66 C104,58 96,58 92,66 C84,58 70,62 60,48 Z" fill="{INK}" opacity=".55"/>
<path d="M66,92 L90,98 L86,106 L68,102 Z M134,92 L110,98 L114,106 L132,102 Z" fill="{a}" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M76,140 Q100,124 124,140 Q122,170 100,174 Q78,170 76,140 Z" fill="#000" opacity=".3" stroke="{INK}" stroke-width="4"/>
<ellipse cx="88" cy="150" rx="6" ry="8" fill="{INK}"/><ellipse cx="112" cy="150" rx="6" ry="8" fill="{INK}"/>
<path d="M92,176 Q100,198 108,176" fill="url(#M)" stroke="{INK}" stroke-width="4"/>{c}'''

def sig(x, y, size, fill='#8d93ad', anchor='middle'):
    from outline import text as _ot  # outlined so it never depends on the Caveat font being installed
    return _ot('created by KB', x, y, 'caveat-700', size * 1.12, fill, anchor, opacity=.9)

MASCOT = {'BEAST': m_beast, 'GOAT': m_goat, 'GRIZZ': m_grizz, 'KINGS': m_kings, 'REBELS': m_rebels, 'SMOKE': m_smoke,
          'STEALTH': m_stealth, 'SWAMP': m_swamp, 'THUNDER': m_thunder, 'WARRIOR': m_warrior}

SHIELD_O = 'M150,10 L272,46 L262,196 C252,262 206,298 150,318 C94,298 48,262 38,196 L28,46 Z'
SHIELD_I = 'M150,26 L256,57 L247,194 C238,250 200,282 150,300 C100,282 62,250 53,194 L44,57 Z'

def defs(div, acc, u):
    D = DIV[div]
    return (lg('M', D['metal'], 1, 1) + lg(f'{u}r', D['rim'], 0, 1) + rg(f'{u}f', D['field'], '50%', '30%', '75%') +
            rg(f'{u}g', [(0, acc + 'aa'), (1, acc + '00')], '50%', '50%', '50%'))

def crest(conf, div):
    u = 'c'; a = ACC[conf]; D = DIV[div]; rb = D['rib']
    b = f'''<path d="{SHIELD_O}" fill="url(#{u}r)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="{SHIELD_I}" fill="url(#{u}f)" stroke="{INK}" stroke-width="3"/>
<path d="M150,26 L256,57 L247,194 C238,250 200,282 150,300 Z" fill="#000" opacity=".22"/>
<circle cx="150" cy="150" r="104" fill="url(#{u}g)" opacity=".55"/>
{''.join(f'<path d="M150,150 L{150 + 200 * __import__("math").cos(t / 12 * 6.283):.0f},{150 + 200 * __import__("math").sin(t / 12 * 6.283):.0f}" stroke="{a}" stroke-opacity=".08" stroke-width="10"/>' for t in range(12))}
{stars(10, len(conf) * 7 + len(div), 300, 300, 110, '#ffffff')}
<path d="M80,18 L220,18 L214,44 L86,44 Z" fill="{D['tab']}" stroke="{INK}" stroke-width="3"/>
<text x="150" y="37.5" text-anchor="middle" font-family="{FONT}" font-weight="900" font-size="11.5" letter-spacing="2" fill="{D['tabtxt']}">{div} DIVISION</text>
<g transform="translate(58,62) scale(.92)">{MASCOT[conf](a)}</g>
{ribbon(u, conf, 268, rb[0], rb[1], rb[2], 220)}
{sig(150, 333, 13)}'''
    return svg(300, 340, b, f'{conf.title()} {div.title()} league crest', defs(div, a, u))

def banner(conf, div):
    u = 'b'; a = ACC[conf]; D = DIV[div]
    gold = div == 'GOLD'
    sky = [(0, '#05060a'), (.6, '#13151c'), (1, '#24262e')] if not gold else [(0, '#060504'), (.6, '#1a140a'), (1, '#33260e')]
    d = defs(div, a, u) + lg(f'{u}s', sky) + lg(f'{u}beam', [(0, (D['metal'][1][1]) + '66'), (1, (D['metal'][1][1]) + '00')])
    lines = ''
    for k in range(8):
        y = 60 + (k + .5) * 380 / 8; yn = 60 + (k // 2 + .5) * 380 / 4
        lines += f'<path d="M60,{y:.0f} H150 V{yn:.0f} H240" stroke="{D["metal"][1][1]}" stroke-width="2" fill="none" opacity=".22"/>'
    for k in range(4):
        y = 60 + (k + .5) * 380 / 4; yn = 60 + (k // 2 + .5) * 380 / 2
        lines += f'<path d="M240,{y:.0f} H330 V{yn:.0f} H420" stroke="{D["metal"][1][1]}" stroke-width="3" fill="none" opacity=".28"/>'
    b = f'''<rect width="1600" height="500" fill="url(#{u}s)"/>
{stars(60, len(conf) * 13 + (5 if gold else 0), 1600, 500, 260, '#ffffff')}
<path d="M760,0 L620,500 L820,500 Z M1500,0 L1300,500 L1460,500 Z" fill="url(#{u}beam)" opacity=".35"/>
<circle cx="1180" cy="250" r="330" fill="url(#{u}g)" opacity=".7"/>
{lines}
<path d="M0,430 C300,400 600,410 900,440 C1150,465 1400,450 1600,420 L1600,500 L0,500 Z" fill="#000" opacity=".45"/>
<g transform="translate(1180,250) scale(2.05) translate(-100,-104)" opacity=".96">{MASCOT[conf](a)}</g>
<path d="M0,496 H1600" stroke="{a}" stroke-width="8"/>{sig(1572, 470, 28, '#c9ced8', 'end')}<path d="M0,488 H1600" stroke="{D['metal'][1][1]}" stroke-width="2" opacity=".6"/>'''
    return svg(1600, 500, b, f'{conf.title()} {div.title()} league banner', d).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ', 1)

# ---------------------------------------------------------------- tournament marks
def division_mark(div):
    u = 'd'; a = '#e8b84a' if div == 'GOLD' else '#c9ced8'; D = DIV[div]; rb = D['rib']
    b = f'''<path d="{SHIELD_O}" fill="url(#{u}r)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="{SHIELD_I}" fill="url(#{u}f)" stroke="{INK}" stroke-width="3"/>
<circle cx="150" cy="140" r="100" fill="url(#{u}g)" opacity=".5"/>{stars(14, 3 if div == 'GOLD' else 9, 300, 300, 120)}
<g transform="translate(56,52) scale(.94)">{m_buffalo('#ff5a3a')}</g>
{ribbon(u, div + ' DIVISION', 268, rb[0], rb[1], rb[2], 236)}
{sig(150, 333, 13)}'''
    return svg(300, 340, b, f'{div.title()} Buffalo division mark', defs(div, a, u))

def kbi_mark():
    u = 'k'
    d = (lg('M', DIV['GOLD']['metal'], 1, 1) + lg(f'{u}L', [(0, '#e6e9ef'), (.5, '#6c7482'), (1, '#262a33')], 0, 1) +
         lg(f'{u}R', DIV['GOLD']['rim'], 0, 1) + rg(f'{u}f', [(0, '#2a2210'), (1, '#050506')], '50%', '30%', '75%'))
    b = f'''<clipPath id="{u}cl"><rect x="0" y="0" width="150" height="340"/></clipPath>
<path d="{SHIELD_O}" fill="url(#{u}R)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="{SHIELD_O}" fill="url(#{u}L)" clip-path="url(#{u}cl)"/>
<path d="{SHIELD_O}" fill="none" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="{SHIELD_I}" fill="url(#{u}f)" stroke="{INK}" stroke-width="3"/>
<path d="M150,26 V300" stroke="#e8b84a" stroke-opacity=".25" stroke-width="2"/>
{stars(14, 21, 300, 300, 110)}
<g transform="translate(58,44) scale(.92)">{m_buffalo('#ff5a3a', crown=True)}</g>
{ribbon(u, 'KING BUFFALO', 262, '#c8902a', '#6e4a0e', '#1a1204', 236)}
{sig(150, 326, 16, '#e8b84a')}'''
    return svg(300, 340, b, 'King Buffalo Invitational mark', d)

def seal(title, sub, inner, ring_a, ring_b, u):
    d = lg(f'{u}r', [(0, ring_a), (1, ring_b)], 1, 1) + lg('M', DIV['GOLD']['metal'], 1, 1) + rg(f'{u}f', [(0, '#22252e'), (1, '#060709')], '50%', '35%', '70%')
    b = f'''<circle cx="150" cy="150" r="140" fill="url(#{u}r)" stroke="{INK}" stroke-width="5"/>
<circle cx="150" cy="150" r="112" fill="url(#{u}f)" stroke="{INK}" stroke-width="4"/>
<path id="{u}top" d="M30,150 A120,120 0 0 1 270,150" fill="none"/><path id="{u}bot" d="M14,150 A136,136 0 0 0 286,150" fill="none"/>
<text font-family="{FONT}" font-weight="900" font-size="20" letter-spacing="4" fill="#1a1204"><textPath href="#{u}top" startOffset="50%" text-anchor="middle">{title}</textPath></text>
<text font-family="{FONT}" font-weight="900" font-size="13" letter-spacing="4" fill="#1a1204"><textPath href="#{u}bot" startOffset="50%" text-anchor="middle">{sub}</textPath></text>
{''.join(f'<circle cx="{150 + 126 * __import__("math").cos(t):.1f}" cy="{150 + 126 * __import__("math").sin(t):.1f}" r="3" fill="#1a1204"/>' for t in (0, 3.14159))}
{inner}
{sig(150, 300, 12)}'''
    return svg(300, 306, b, f'{title} {sub}', d)

def region(name):
    ang = {'NORTH': 0, 'EAST': 90, 'SOUTH': 180, 'WEST': 270}[name]
    inner = f'''<g transform="translate(150,150)">
<path d="M0,-86 L14,-14 L86,0 L14,14 L0,86 L-14,14 L-86,0 L-14,-14 Z" fill="#2a2e38" stroke="{INK}" stroke-width="3"/>
<g transform="rotate({ang})"><path d="M0,-92 L20,-10 L0,0 Z" fill="url(#M)" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M0,-92 L-20,-10 L0,0 Z" fill="#b8862a" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/></g>
<circle r="30" fill="#0b0c10" stroke="url(#M)" stroke-width="5"/>
<text y="12" text-anchor="middle" font-family="{FONT}" font-weight="900" font-size="34" fill="#ffd98a">{name[0]}</text></g>'''
    return seal(name + ' REGION', 'TOURNAMENT', inner, '#fff0b8', '#9a6a14', 'r' + name[0])

def conf_finals():
    inner = f'''<g transform="translate(150,156)">
<path d="M-60,-40 L0,-70 L60,-40 L60,10 C60,50 30,72 0,82 C-30,72 -60,50 -60,10 Z" fill="url(#M)" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M-44,-30 L0,-52 L44,-30 L44,8 C44,38 22,56 0,64 C-22,56 -44,38 -44,8 Z" fill="#0b0c10"/>
<text y="-4" text-anchor="middle" font-family="{FONT}" font-weight="900" font-size="22" fill="#ffd98a">FINAL</text><text y="22" text-anchor="middle" font-family="{FONT}" font-weight="900" font-size="22" fill="#ffd98a">FOUR</text>
<path d="M-24,36 H24" stroke="#e8b84a" stroke-width="3"/></g>'''
    return seal('CONFERENCE FINALS', 'TOURNAMENT', inner, '#fff0b8', '#9a6a14', 'cf')

def championship():
    u = 'ch'
    d = lg('M', DIV['GOLD']['metal'], 1, 1) + lg('S', DIV['BLACK']['metal'], 1, 1) + rg(f'{u}glow', [(0, '#ffd98aaa'), (1, '#ffd98a00')])
    tro = lambda fill: f'''<path d="M-34,-56 C-62,-56 -64,-20 -30,-12 M34,-56 C62,-56 64,-20 30,-12" stroke="{INK}" stroke-width="9" fill="none"/><path d="M-34,-56 C-62,-56 -64,-20 -30,-12 M34,-56 C62,-56 64,-20 30,-12" stroke="{fill}" stroke-width="5" fill="none"/>
<path d="M-40,-66 L40,-66 L36,-30 C32,-8 14,4 0,6 C-14,4 -32,-8 -36,-30 Z" fill="{fill}" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
<rect x="-8" y="6" width="16" height="18" fill="{fill}" stroke="{INK}" stroke-width="3.5"/><path d="M-26,24 L26,24 L30,40 L-30,40 Z" fill="#1a1408" stroke="{INK}" stroke-width="3.5"/><rect x="-34" y="40" width="68" height="10" rx="2" fill="{fill}" stroke="{INK}" stroke-width="3"/>'''
    b = f'''<rect width="600" height="340" rx="24" fill="#07070a"/>
<path d="M0,24 Q0,0 24,0 H300 V340 H24 Q0,340 0,316 Z" fill="#14161c"/><path d="M300,0 H576 Q600,0 600,24 V316 Q600,340 576,340 H300 Z" fill="#2a1f0a"/>
<circle cx="300" cy="150" r="170" fill="url(#{u}glow)" opacity=".6"/>
<path d="M300,0 L272,170 L300,340 L328,170 Z" fill="#e8b84a" opacity=".18"/>
<g transform="translate(150,120) scale(.55)">{m_buffalo('#ff5a3a').replace('url(#M)', 'url(#S)')}</g>
<g transform="translate(450,120) scale(.55) scale(-1,1)">{m_buffalo('#ff5a3a')}</g>
<g transform="translate(300,170) scale(1.25)">{tro('url(#M)')}<path d="M0,-52 l4,9 10,1 -7,7 2,10 -9,-5 -9,5 2,-10 -7,-7 10,-1 Z" fill="#fff8dc" stroke="{INK}" stroke-width="1.6"/></g>
<text x="150" y="296" text-anchor="middle" font-family="{FONT}" font-weight="900" font-size="30" letter-spacing="4" fill="#e8eaf2">BLACK</text>
<text x="450" y="296" text-anchor="middle" font-family="{FONT}" font-weight="900" font-size="30" letter-spacing="4" fill="#ffd98a">GOLD</text>
<text x="300" y="300" text-anchor="middle" font-family="{FONT}" font-weight="900" font-size="18" fill="#a3a9c2">V</text>
<text x="300" y="36" text-anchor="middle" font-family="{FONT}" font-weight="900" font-size="15" letter-spacing="6" fill="#ffd98a">CHAMPIONSHIP</text>
{sig(582, 328, 15, '#a3a9c2', 'end')}
<rect x="2" y="2" width="596" height="336" rx="23" fill="none" stroke="#e8b84a" stroke-opacity=".5" stroke-width="3"/>'''
    return svg(600, 340, b, 'Championship, Black v Gold', d)

def wildcard():
    inner = f'''<g transform="translate(150,154)">
<circle r="62" fill="#0b0c10" stroke="url(#M)" stroke-width="5"/>
<path d="M-50,8 H50" stroke="#e8b84a" stroke-width="4" stroke-dasharray="8 6"/>
<circle cx="-18" cy="-16" r="13" fill="#7fe0a6" stroke="{INK}" stroke-width="3"/><circle cx="16" cy="-22" r="9" fill="#7fe0a6" opacity=".8" stroke="{INK}" stroke-width="2.5"/>
<circle cx="-6" cy="28" r="11" fill="#ff9a8a" stroke="{INK}" stroke-width="3"/><circle cx="26" cy="30" r="7" fill="#ff9a8a" opacity=".7" stroke="{INK}" stroke-width="2.5"/>
<text y="-34" text-anchor="middle" font-family="{FONT}" font-weight="900" font-size="12" letter-spacing="2" fill="#ffd98a">IN</text><text y="56" text-anchor="middle" font-family="{FONT}" font-weight="900" font-size="12" letter-spacing="2" fill="#ff9a8a">OUT</text></g>'''
    return seal('WILDCARD BUBBLE', 'TOURNAMENT', inner, '#e6e9ef', '#4a515e', 'wc')

import re
def uniq(svgtext, pre):
    ids = set(re.findall(r'id="([^"]+)"', svgtext))
    for i in sorted(ids, key=len, reverse=True):
        svgtext = re.sub(r'(id="|url\(#|href="#)' + re.escape(i) + r'(["\)])', lambda m: m.group(1) + pre + '-' + i + m.group(2), svgtext)
    return svgtext

def all_files():
    out = {}
    for div in ('BLACK', 'GOLD'):
        for c in CONFS:
            slug = f'{c.lower()}-{div.lower()}'
            out[f'crests/{slug}.svg'] = crest(c, div)
            out[f'banners/{slug}.svg'] = banner(c, div)
        out[f'marks/{div.lower()}-buffalo.svg'] = division_mark(div)
    out['marks/kbi.svg'] = kbi_mark()
    for r in ('NORTH', 'EAST', 'SOUTH', 'WEST'):
        out[f'marks/region-{r.lower()}.svg'] = region(r)
    out['marks/conference-finals.svg'] = conf_finals()
    out['marks/championship.svg'] = championship()
    out['marks/wildcard-bubble.svg'] = wildcard()
    return {p: uniq(v, 'kbi-' + p.split('/')[-1][:-4]) for p, v in out.items()}

if __name__ == '__main__':
    base = os.path.join(sys.argv[1], 'kbi'); n = 0
    for p, s in all_files().items():
        os.makedirs(os.path.dirname(os.path.join(base, p)), exist_ok=True)
        open(os.path.join(base, p), 'w').write(s); n += 1
    print('wrote', n)
