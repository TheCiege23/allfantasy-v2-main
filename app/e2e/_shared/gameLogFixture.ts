import { GROUP_LABELS, gameLogColumns, type GameLogSport, type GameLogValue } from '@/lib/player-game-log/gameLogColumns'

/**
 * Sample `/api/players/game-log` answers for the DB-free harnesses (player card, league screens).
 * Columns come from the real definitions (lib/player-game-log/gameLogColumns.ts), so a column added
 * there shows up here; the numbers are seeded and in each sport's ordinary range — a layout fixture,
 * not anybody's real season.
 */

const OPP: Record<string, string[]> = {
  NHL: ['DAL', 'COL', 'VGK', 'MIN', 'STL', 'WPG', 'CHI', 'NSH', 'EDM', 'CGY'],
  NBA: ['NOP', 'GSW', 'PHX', 'DEN', 'LAL', 'SAC', 'POR', 'UTA', 'OKC', 'MEM'],
  NCAAB: ['UNC', 'UVA', 'NCST', 'WAKE', 'CLEM', 'MIA', 'FSU', 'BC', 'PITT', 'SYR'],
  MLB: ['BOS', 'TOR', 'BAL', 'TB', 'HOU', 'SEA', 'TEX', 'LAA', 'OAK', 'MIN'],
  SOCCER: ['MCI', 'LIV', 'CHE', 'TOT', 'NEW', 'AVL', 'MUN', 'BHA', 'WHU', 'FUL'],
}

function rng(seed: number) {
  let s = seed * 9301 + 49297
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

function rowValues(sport: GameLogSport, group: string, r: () => number) {
  const n = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const v: Record<string, GameLogValue> = {}
  const ratio: Record<string, number> = {}
  if (sport === 'NHL' && group === 'skaters') {
    const g = r() < 0.7 ? 0 : n(1, 2)
    const a = n(0, 2)
    Object.assign(v, { toi: 15 + r() * 7, g, a, pts: g + a, plusminus: n(-2, 2), sog: n(1, 6), ppp: r() < 0.3 ? 1 : 0, shp: 0, hits: n(0, 5), blks: n(0, 3), pim: r() < 0.25 ? 2 : 0, fow: n(4, 12) })
  } else if (sport === 'NHL') {
    const sa = n(22, 38), ga = n(0, 4), sv = sa - ga
    Object.assign(v, { toi: 60, dec: ga <= 2 ? 'W' : r() < 0.3 ? 'OTL' : 'L', g_sa: sa, g_sv: sv, g_ga: ga, svpct: sv / sa, g_so: ga === 0 ? 1 : 0 })
    Object.assign(ratio, { g_sv: sv, g_sa: sa })
  } else if (sport === 'NBA' || sport === 'NCAAB') {
    const fga = n(9, 20), fgm = Math.min(fga, n(4, 11)), fta = n(0, 8), ftm = Math.min(fta, n(0, 7)), threes = n(0, 4)
    Object.assign(v, { min: 26 + r() * 12, pts: fgm * 2 + threes + ftm, reb: n(2, 10), ast: n(1, 9), stl: n(0, 3), blk: n(0, 2), threes, to: n(0, 4), fg: { made: fgm, att: fga }, ft: { made: ftm, att: fta }, pf: n(0, 4) })
  } else if (sport === 'MLB' && group === 'batting') {
    const ab = n(3, 5), h = Math.min(ab, n(0, 3)), hr = h && r() < 0.35 ? 1 : 0
    Object.assign(v, { ab, r: n(0, 2), h, hr, rbi: hr + n(0, 2), bb: n(0, 2), bat_so: n(0, 2), sb: r() < 0.1 ? 1 : 0, tb: h + hr * 3, avg: ab ? h / ab : null })
    Object.assign(ratio, { h, ab })
  } else if (sport === 'MLB') {
    const ip = 5 + n(0, 2) + n(0, 2) / 3, er = n(0, 4)
    Object.assign(v, { dec: er <= 2 ? 'W' : 'L', ip, p_h: n(3, 8), er, p_bb: n(0, 3), so: n(4, 10), p_hr: n(0, 2), pitches: n(85, 105), era: (er * 9) / ip })
    Object.assign(ratio, { er, ip })
  } else {
    Object.assign(v, { minutes_played: n(60, 90), goals: r() < 0.3 ? 1 : 0, assists: r() < 0.2 ? 1 : 0, shots: n(0, 4), shots_on_target: n(0, 2), fouls_drawn: n(0, 3), yellow_card: r() < 0.15 ? 1 : 0, red_card: 0, clean_sheet_def: 0 })
  }
  return { values: v, ratioInputs: ratio }
}

/** Sample points, roughly the sport's default weights — enough to draw the column and its marks. */
function samplePoints(values: Record<string, GameLogValue>): number {
  const n = (k: string) => (typeof values[k] === 'number' ? (values[k] as number) : 0)
  const pts =
    n('g') * 3 + n('a') * 2 + n('sog') * 0.3 + n('blks') * 0.3 + n('hits') * 0.2 + n('ppp') * 0.5 +
    n('g_sv') * 0.2 - n('g_ga') + (values.dec === 'W' ? 5 : 0) + n('g_so') * 5 +
    n('pts') * (n('min') ? 1 : 0) + n('reb') * 1.2 + n('ast') * 1.5 + n('stl') * 3 + n('blk') * 3 - n('to') +
    n('r') + n('h') + n('hr') * 4 + n('rbi') + n('bb') + n('sb') * 2 + n('so') * 1 - n('er') * 2 + n('ip') * 3 +
    n('goals') * 6 + n('assists') * 3 + n('shots_on_target')
  return Math.round(pts * 10) / 10
}

function withPoints(line: { values: Record<string, GameLogValue>; ratioInputs: Record<string, number> }, played: boolean) {
  return { ...line, fantasyPoints: played ? samplePoints(line.values) : null }
}

export function harnessGameLog(
  sport: string,
  group?: string,
  games = 12,
  scoring: { kind: 'league'; leagueName: string | null } | { kind: 'default' } = { kind: 'default' },
) {
  const s = sport.toUpperCase() as GameLogSport
  const g = group ?? (s === 'NHL' ? 'skaters' : s === 'MLB' ? 'batting' : s === 'SOCCER' ? 'fielders' : 'all')
  const r = rng(s.length * 17 + g.length)
  const opp = OPP[s] ?? OPP.NHL
  const step = s === 'MLB' ? 1 : s === 'SOCCER' ? 7 : 2
  const rows = Array.from({ length: games }, (_, i) => {
    const date = new Date(Date.now() - (i * step + 1) * 86_400_000).toISOString().slice(0, 10)
    const teamScore = s === 'NBA' || s === 'NCAAB' ? 95 + Math.floor(r() * 30) : Math.floor(r() * 6) + 1
    const oppScore = s === 'NBA' || s === 'NCAAB' ? 95 + Math.floor(r() * 30) : Math.floor(r() * 6)
    // One healthy scratch, so the "Did not play" row is in the picture.
    const played = i !== 6
    return {
      gameId: `h-${s}-${i}`,
      date,
      team: null,
      opponent: opp[i % opp.length],
      home: i % 2 === 0,
      teamScore,
      oppScore,
      result: teamScore > oppScore ? 'W' : teamScore < oppScore ? 'L' : s === 'SOCCER' ? 'T' : null,
      postseason: false,
      played,
      ...withPoints(rowValues(s, g, r), played),
    }
  })
  return {
    supported: true,
    resolved: true,
    season: 2026,
    seasons: [2026, 2025],
    groups: [{ group: g, label: GROUP_LABELS[g] ?? g, columns: gameLogColumns(s, g), rows }],
    scoring,
  }
}
