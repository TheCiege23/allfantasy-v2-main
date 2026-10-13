"""Scoring and roster labels.
Outputs (python3 gen_rules.py <out_dir> -> <out_dir>/rules/...):
  scoring/<id>.svg     scoring preset plate, 280x112
  roster/<id>.svg      roster preset strip (width varies, 64 tall per row)
  positions/<pos>.svg  position chip, 64x64
  rules.json           full catalog: every scoring value and every roster slot
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_a import svg, lg
from outline import text as T_, width as W_

INK = '#07080d'
F = "font-family=\"Archivo, 'Arial Black', sans-serif\""

# ------------------------------------------------------------------ catalog
NFL_BASE = {'pass_yd': 0.04, 'pass_td': 4, 'int': -2, 'rush_yd': 0.1, 'rush_td': 6, 'rec': 0, 'rec_yd': 0.1, 'rec_td': 6,
            'fum_lost': -2, 'two_pt': 2, 'te_rec_bonus': 0, 'first_down': 0, 'bonus_100_rush_rec': 0, 'bonus_300_pass': 0, 'bonus_40_td': 0}
NFL_LABELS = {'pass_yd': 'Passing yard', 'pass_td': 'Passing TD', 'int': 'Interception', 'rush_yd': 'Rushing yard', 'rush_td': 'Rushing TD',
              'rec': 'Reception', 'rec_yd': 'Receiving yard', 'rec_td': 'Receiving TD', 'fum_lost': 'Fumble lost', 'two_pt': '2-pt conversion',
              'te_rec_bonus': 'TE reception bonus', 'first_down': 'Rush/rec first down', 'bonus_100_rush_rec': '100+ rush or rec yards',
              'bonus_300_pass': '300+ passing yards', 'bonus_40_td': '40+ yard TD'}
def nfl(**k):
    d = dict(NFL_BASE); d.update(k); return d

# id, sport, code, name, family colour (a, b), glyph, short line, best for, values
SCORING = [
    ('std', 'NFL', 'STD', 'Standard', ('#5b6b8c', '#2c3550'), 'shield', 'No points for catches', 'Classic leagues, run-first value', nfl()),
    ('half', 'NFL', 'HALF', 'Half PPR', ('#e8b84a', '#8a5d12'), 'half', '0.5 per catch', 'The balanced default', nfl(rec=0.5)),
    ('ppr', 'NFL', 'PPR', 'Full PPR', ('#3d8fe0', '#173e70'), 'hands', '1 per catch', 'Pass-catchers rise', nfl(rec=1)),
    ('te', 'NFL', 'TE+', 'TE Premium', ('#e89a2c', '#7a4610'), 'te', 'PPR + 0.5 per TE catch', 'Makes tight ends matter', nfl(rec=1, te_rec_bonus=0.5)),
    ('six', 'NFL', '6PT', '6-pt passing TD', ('#e0553f', '#6e1f14'), 'target', 'Half PPR, pass TD = 6', 'Quarterbacks score like everyone else', nfl(rec=0.5, pass_td=6)),
    ('fd', 'NFL', '1ST', 'First downs', ('#3abf7a', '#14563a'), 'chain', 'Half PPR + 0.5 per first down', 'Rewards volume, not just TDs', nfl(rec=0.5, first_down=0.5)),
    ('bonus', 'NFL', 'BONUS', 'Big-play bonus', ('#c04fd0', '#4f1a5a'), 'burst', 'Half PPR + yardage bonuses', 'Boom weeks pay extra', nfl(rec=0.5, bonus_100_rush_rec=3, bonus_300_pass=3, bonus_40_td=2)),
    ('pts', 'NBA', 'PTS', 'Points', ('#e8743a', '#6e2a0e'), 'hoop', 'Every stat is worth points', 'Simple weekly totals',
     {'pts': 1, 'reb': 1.2, 'ast': 1.5, 'stl': 3, 'blk': 3, 'to': -1, 'three': 0.5, 'dd': 0, 'td': 0}),
    ('ptsb', 'NBA', 'PTS+', 'Points + bonuses', ('#e8b84a', '#7a4a0e'), 'burst', 'Points + double-double and triple-double', 'Stat-sheet stuffers', {'pts': 1, 'reb': 1.2, 'ast': 1.5, 'stl': 3, 'blk': 3, 'to': -1, 'three': 0.5, 'dd': 1.5, 'td': 3}),
    ('cat9', 'NBA', '9CAT', '9-category', ('#4fb3d9', '#12475e'), 'grid9', 'Win categories, not points', 'Balanced builds', {'cats': ['FG%', 'FT%', '3PM', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO']}),
    ('cat8', 'NBA', '8CAT', '8-category', ('#3abf7a', '#14563a'), 'grid8', '9-cat without turnovers', 'Lets you play high-usage stars', {'cats': ['FG%', 'FT%', '3PM', 'PTS', 'REB', 'AST', 'STL', 'BLK']}),
    ('custom', 'ANY', 'CUSTOM', 'Custom', ('#8a8fa8', '#2c3040'), 'sliders', 'Commissioner sets every value', 'Unique house rules', {}),
]
NBA_LABELS = {'pts': 'Point', 'reb': 'Rebound', 'ast': 'Assist', 'stl': 'Steal', 'blk': 'Block', 'to': 'Turnover', 'three': '3-pointer made', 'dd': 'Double-double', 'td': 'Triple-double'}

POS = {  # pos: (fill, text)
    'QB': ('#e0553f', '#fff'), 'RB': ('#3abf7a', '#06200f'), 'WR': ('#3d8fe0', '#fff'), 'TE': ('#e89a2c', '#1a1004'), 'FLEX': ('#8a8fa8', '#0b0d14'),
    'SFLEX': ('#c04fd0', '#fff'), 'K': ('#b48cf0', '#1a0d33'), 'DST': ('#8a6a4a', '#fff'), 'DL': ('#2fb5a5', '#04201d'), 'LB': ('#1f8f86', '#fff'),
    'DB': ('#5fd0e0', '#05242a'), 'IDP': ('#4a7f7a', '#fff'),
    'PG': ('#3d8fe0', '#fff'), 'SG': ('#4fb3d9', '#05242a'), 'SF': ('#3abf7a', '#06200f'), 'PF': ('#e89a2c', '#1a1004'), 'C': ('#e0553f', '#fff'),
    'G': ('#7aa6ec', '#0b1830'), 'F': ('#7fd09c', '#06200f'), 'UTIL': ('#8a8fa8', '#0b0d14'),
    'BN': ('#1d2130', '#a3a9c2'), 'IR': ('#2a1418', '#ff9a8a'), 'IL': ('#2a1418', '#ff9a8a'),
}
# id, sport, name, starters, bench, ir, best for
ROSTERS = [
    ('nfl-std', 'NFL', 'Standard', ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST'], 7, 1, 'Most leagues'),
    ('nfl-sf', 'NFL', 'Superflex', ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SFLEX', 'K', 'DST'], 7, 1, 'Quarterbacks get valuable'),
    ('nfl-2qb', 'NFL', '2QB', ['QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST'], 7, 1, 'Deep quarterback strategy'),
    ('nfl-3wr', 'NFL', '3WR', ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST'], 7, 1, 'Pairs well with PPR'),
    ('nfl-skill', 'NFL', 'Skill only', ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX'], 6, 1, 'No kickers or defenses'),
    ('nfl-idp', 'NFL', 'IDP', ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST', 'DL', 'LB', 'DB', 'IDP'], 8, 1, 'Defensive players too'),
    ('nba-std', 'NBA', 'Standard', ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL', 'UTIL'], 3, 1, 'Most leagues'),
    ('nba-small', 'NBA', 'Lean', ['PG', 'SG', 'SF', 'PF', 'C', 'UTIL', 'UTIL'], 3, 1, 'Fast drafts, bigger stars'),
    ('nba-deep', 'NBA', 'Deep', ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL', 'UTIL'], 6, 2, 'Bench depth matters'),
]

# ------------------------------------------------------------------ glyphs (drawn in a 64x64 box, white on colour)
def glyph(kind, c='#fff'):
    s = f'stroke="{c}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"'
    if kind == 'shield': return f'<path d="M32,8 L52,15 L50,36 C48,48 40,54 32,58 C24,54 16,48 14,36 L12,15 Z" {s}/>'
    if kind == 'half': return f'<circle cx="32" cy="32" r="20" {s}/><path d="M32,12 A20,20 0 0 1 32,52 Z" fill="{c}"/>'
    if kind == 'hands': return (f'<ellipse cx="32" cy="22" rx="13" ry="8" transform="rotate(-25 32 22)" fill="{c}"/>'
                               f'<path d="M12,52 C12,40 18,34 24,34 L28,44 M52,52 C52,40 46,34 40,34 L36,44" {s}/>')
    if kind == 'te': return (f'<rect x="10" y="16" width="44" height="32" rx="8" {s}/>' + T_('TE', 32, 39, 'archivo-900', 19, c, 'middle') +
                            f'<path d="M50,8 V20 M44,14 H56" {s}/>')
    if kind == 'target': return f'<circle cx="32" cy="32" r="22" {s}/><circle cx="32" cy="32" r="12" {s}/><circle cx="32" cy="32" r="4" fill="{c}"/>'
    if kind == 'chain': return (f'<path d="M14,10 V54 M50,10 V54" {s}/><path d="M14,18 Q32,26 50,18 M14,32 Q32,40 50,32" {s} stroke-dasharray="4 5"/>'
                               f'<rect x="8" y="46" width="12" height="10" rx="2" fill="{c}"/><rect x="44" y="46" width="12" height="10" rx="2" fill="{c}"/>')
    if kind == 'burst':
        import math
        pts = ' '.join(f'{32 + (24 if i % 2 == 0 else 11) * math.cos(math.radians(-90 + i * 30)):.1f},{32 + (24 if i % 2 == 0 else 11) * math.sin(math.radians(-90 + i * 30)):.1f}' for i in range(12))
        return f'<polygon points="{pts}" fill="{c}"/>'
    if kind == 'hoop': return (f'<circle cx="32" cy="26" r="16" {s}/><path d="M16,26 H48 M32,10 V42 M21,14 C27,20 27,32 21,38 M43,14 C37,20 37,32 43,38" stroke="{c}" stroke-width="3" fill="none"/>'
                              f'<path d="M14,48 H50 M18,48 L24,58 M46,48 L40,58 M30,48 V58" {s}/>')
    if kind in ('grid9', 'grid8'):
        out = ''
        for i in range(9):
            x, y = 12 + (i % 3) * 14, 12 + (i // 3) * 14
            out += f'<rect x="{x}" y="{y}" width="11" height="11" rx="2.5" fill="{c}" opacity="{0.25 if (kind == "grid8" and i == 8) else 1}"/>'
        return out
    if kind == 'sliders': return ''.join(f'<path d="M12,{y} H52" {s}/><circle cx="{x}" cy="{y}" r="6" fill="{c}"/>' for x, y in ((22, 16), (42, 32), (28, 48)))
    return ''

# ------------------------------------------------------------------ art
def scoring_svg(row):
    sid, sport, code, name, (a, b), gl, line, best, vals = row
    u = 'sc' + sid
    defs = lg(u + 'g', [(0, a), (1, b)], 1, 1) + lg(u + 'h', [(0, 'rgba(255,255,255,.35)'), (1, 'rgba(255,255,255,0)')], 0, 1)
    fs = 44 if len(code) <= 4 else (36 if len(code) == 5 else 31)
    sub = (sport if sport != 'ANY' else 'NFL · NBA') + ' · ' + name.upper()
    sub_fs = 14 if len(sub) <= 18 else (12 if len(sub) <= 22 else 10.5)
    body = f'''<rect x="2" y="2" width="276" height="108" rx="22" fill="url(#{u}g)" stroke="{INK}" stroke-width="4"/>
<rect x="8" y="8" width="264" height="44" rx="16" fill="url(#{u}h)"/>
<circle cx="58" cy="56" r="40" fill="{INK}" opacity=".28"/>
<g transform="translate(26,24)">{glyph(gl)}</g>
{T_(code, 112, 60 if fs == 44 else 56, 'archivo-900', fs, '#fff', spacing=1)}
{T_(sub, 113, 84, 'archivo-700', sub_fs, '#fff', opacity=.85)}'''
    return svg(280, 112, body, f'{name} scoring', defs)

def chip(pos, x, y, w=56, h=56):
    fill, txt = POS[pos]
    fs = 20 if len(pos) <= 2 else (15 if len(pos) == 3 else 12.5)
    ol = f' stroke="#ff9a8a" stroke-width="2" stroke-dasharray="4 3"' if pos in ('IR', 'IL') else f' stroke="{INK}" stroke-width="3"'
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}"{ol}/>'
            f'<rect x="{x + 4}" y="{y + 4}" width="{w - 8}" height="{h * .38:.0f}" rx="9" fill="#fff" opacity=".14"/>' +
            T_(pos, x + w / 2, y + h / 2 + fs * .36, 'archivo-900', fs, txt, 'middle'))

def pos_svg(pos):
    return svg(64, 64, chip(pos, 4, 4), f'{pos} slot')

def roster_svg(row):
    rid, sport, name, st, bn, ir, best = row
    gap, w = 6, 56
    n = len(st) + 2
    W = 24 + n * (w + gap) + 14
    x = 20; body = ''
    for p in st:
        body += chip(p, x, 52, w); x += w + gap
    x += 8
    body += chip('BN', x, 52, w) + T_('×' + str(bn), x + w / 2, 126, 'archivo-800', 13, '#a3a9c2', 'middle'); x += w + gap
    body += chip('IR' if sport == 'NFL' else 'IL', x, 52, w) + T_('×' + str(ir), x + w / 2, 126, 'archivo-800', 13, '#ff9a8a', 'middle')
    head = (f'<rect x="2" y="2" width="{W - 4}" height="132" rx="18" fill="#0d1018" stroke="#2a2f42" stroke-width="2"/>' +
            T_(f'{sport} · {name.upper()}', 20, 36, 'archivo-900', 20, '#fff') +
            T_(f'{len(st)} start · {len(st) + bn} slots + {ir} ' + ('IR' if sport == 'NFL' else 'IL'), W - 20, 36, 'archivo-700', 14, '#a3a9c2', 'end'))
    return svg(W, 136, head + body, f'{sport} {name} roster')

def catalog():
    sc = []
    for sid, sport, code, name, (a, b), gl, line, best, vals in SCORING:
        labels = NFL_LABELS if sport == 'NFL' else NBA_LABELS
        rows = [{'key': k, 'label': labels.get(k, k), 'value': v} for k, v in vals.items() if k != 'cats' and (v != 0 or k in ('rec', 'pass_td'))] if 'cats' not in vals else []
        sc.append({'id': sid, 'sport': sport, 'code': code, 'name': name, 'colors': [a, b], 'glyph': gl, 'line': line, 'bestFor': best,
                   'type': 'categories' if 'cats' in vals else ('custom' if not vals else 'points'), 'values': rows, 'categories': vals.get('cats', []),
                   'image': f'scoring/{sid}.svg'})
    ro = [{'id': rid, 'sport': sport, 'name': name, 'starters': st, 'bench': bn, 'injured': ir, 'startCount': len(st), 'slots': len(st) + bn,
           'bestFor': best, 'image': f'roster/{rid}.svg'} for rid, sport, name, st, bn, ir, best in ROSTERS]
    return {'scoring': sc, 'rosters': ro, 'positions': {p: {'fill': f, 'text': t, 'image': f'positions/{p.lower()}.svg'} for p, (f, t) in POS.items()},
            'defaults': {'NFL': {'scoring': 'half', 'roster': 'nfl-std'}, 'NBA': {'scoring': 'pts', 'roster': 'nba-std'}},
            'kdst': {'note': 'K and DST use the AF standard tables in every NFL preset.'}}

def all_files():
    out = {f'scoring/{r[0]}.svg': scoring_svg(r) for r in SCORING}
    out.update({f'roster/{r[0]}.svg': roster_svg(r) for r in ROSTERS})
    out.update({f'positions/{p.lower()}.svg': pos_svg(p) for p in POS})
    return out

if __name__ == '__main__':
    base = os.path.join(sys.argv[1], 'rules')
    for p, s in all_files().items():
        os.makedirs(os.path.dirname(os.path.join(base, p)), exist_ok=True); open(os.path.join(base, p), 'w').write(s)
    json.dump(catalog(), open(os.path.join(base, 'rules.json'), 'w'), indent=1)
    print('wrote', len(all_files()))
