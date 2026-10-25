/**
 * The daily-sport AF projection and position rank (lib/projections/dailySportForm.ts), checked against
 * numbers worked out by hand from each sport's scoring table — with the REAL normalizers and the REAL
 * league scorer (`buildLeagueStatScorer`), so a drift in either fails here rather than on a screen.
 *
 * Hand arithmetic, NBA defaults (pts 1, reb 1.2, ast 1.5, stl 3, blk 3, to -1, threes 0.5, dbl_dbl 1.5):
 *   A g1  20 pts 10 reb 5 ast 1 stl 1 blk 2 to 2 3pm  = 20 + 12 + 7.5 + 3 + 3 - 2 + 1 + 1.5 = 46
 *   A g2  10 pts  4 reb 2 ast                         = 10 + 4.8 + 3                       = 17.8
 *   A g3  30 pts 12 reb 3 ast 4 to                    = 30 + 14.4 + 4.5 - 4 + 1.5          = 46.4
 *   A     season 110.2, per game 110.2 / 3 = 36.73, three team games -> 110.19
 *   B     12 pts 2 reb = 14.4 ; 8 pts 2 ast = 11 -> season 25.4, per game 12.7, two games -> 25.4
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import {
  buildDailySportForm,
  formatPositionRank,
  isUnavailableForProjection,
  positionRanks,
  projectPeriodPoints,
  rankPositionFor,
  scoreFormBlob,
  type GameLogRow,
  type ScoredFormPlayer,
} from '@/lib/projections/dailySportForm'

let seq = 0
function row(sport: string, playerId: string, day: string, line: Record<string, unknown>, extra: Partial<GameLogRow> = {}): GameLogRow {
  seq += 1
  const game = extra.providerGameId ?? `${day}-${seq}`
  return {
    playerId,
    gameId: line.group === 'batting' || line.group === 'pitching' ? `${game}:${line.group}` : game,
    providerGameId: game,
    gameDate: new Date(`${day}T00:00:00.000Z`),
    season: 2026,
    team: extra.team ?? null,
    normalizedStatMap: { seasonType: 'regular', ...line },
    ...extra,
  }
}

function build(sport: string, rows: GameLogRow[], positions: Record<string, string>) {
  return buildDailySportForm({
    sport,
    season: 2026,
    rows,
    identityPositions: new Map(Object.entries(positions)),
    normalizer: getDailySportNormalizer(sport)!,
    computedAt: new Date('2026-10-25T07:00:00Z'),
  })
}

const nba = (stats: Record<string, number>) => ({ group: 'all', stats })

describe('NBA — projection and season points by hand', () => {
  const rows = [
    row('NBA', 'a', '2026-10-21', nba({ points: 20, total_rebounds: 10, assists: 5, steals: 1, blocks: 1, turnovers: 2, three_points_made: 2 }), { team: 'DEN' }),
    row('NBA', 'a', '2026-10-23', nba({ points: 10, total_rebounds: 4, assists: 2 }), { team: 'DEN' }),
    row('NBA', 'a', '2026-10-25', nba({ points: 30, total_rebounds: 12, assists: 3, turnovers: 4 }), { team: 'DEN' }),
    // A 50-point preseason game: real, ingested, and not a fantasy game.
    { ...row('NBA', 'a', '2026-10-10', nba({ points: 50 }), { team: 'DEN' }), normalizedStatMap: { seasonType: 'pre', ...nba({ points: 50 }) } },
    row('NBA', 'b', '2026-10-22', nba({ points: 12, total_rebounds: 2 }), { team: 'LAL' }),
    row('NBA', 'b', '2026-10-24', nba({ points: 8, assists: 2 }), { team: 'LAL' }),
  ]
  const blob = build('NBA', rows, { a: 'C', b: 'C' })
  const scorer = buildLeagueStatScorer({ sport: 'NBA', settings: {} })!
  const scored = scoreFormBlob(blob, scorer)

  it('season points exclude the preseason game', () => {
    expect(blob.players.a.sg).toBe(3)
    expect(scored.get('a')!.seasonPoints).toBe(110.2)
    expect(scored.get('b')!.seasonPoints).toBe(25.4)
  })

  it('per game x team games x availability', () => {
    expect(scored.get('a')!.perGame).toBe(36.73)
    expect(projectPeriodPoints({ perGame: scored.get('a')!.perGame, teamGames: 3, available: true, part: blob.players.a.part })).toBe(110.19)
    expect(scored.get('b')!.perGame).toBe(12.7)
    expect(projectPeriodPoints({ perGame: scored.get('b')!.perGame, teamGames: 2, available: true, part: null })).toBe(25.4)
  })

  it('an injured player projects 0, and a day without a game projects 0', () => {
    const b = scored.get('b')!
    expect(projectPeriodPoints({ perGame: b.perGame, teamGames: 2, available: !isUnavailableForProjection('Out'), part: null })).toBe(0)
    expect(projectPeriodPoints({ perGame: b.perGame, teamGames: 0, available: true, part: null })).toBe(0)
  })

  it("the league's own scoring decides the number (positive control: double the points weight)", () => {
    const heavy = buildLeagueStatScorer({ sport: 'NBA', settings: { sportConfig: { categoryPoints: { pts: 2 } } } })!
    // A: 110.2 + the 60 points he scored again = 170.2
    expect(scoreFormBlob(blob, heavy).get('a')!.seasonPoints).toBe(170.2)
  })

  it('the recent window is the most recent games, not the first', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      row('NBA', 'c', `2026-10-${String(i + 1).padStart(2, '0')}`, nba({ points: i < 2 ? 0 : 10 }), { team: 'BOS' }),
    )
    const b2 = build('NBA', many.map((r) => ({ ...r, normalizedStatMap: { ...(r.normalizedStatMap as object), seasonType: 'regular' } })), { c: 'PG' })
    const c = scoreFormBlob(b2, scorer).get('c')!
    expect(b2.players.c.rg).toBe(10)
    // The two scoreless games are the OLDEST two, outside the ten-game window.
    expect(c.perGame).toBe(10)
    expect(c.seasonPoints).toBe(100)
  })
})

describe('NHL — a skater and a goalie by hand (defaults)', () => {
  // Skater g1: 1 G (3) 1 A (2) +1 (0.5) 4 SOG (1.2) 1 PPG -> 1 PPP (0.5) 2 BLK (0.6) 3 HIT (0.6) 2 PIM (-0.2) = 8.2
  // Skater g2: 2 A (4) 2 SOG (0.6) 1 HIT (0.2) = 4.8  -> per game 6.5, four team games -> 26
  // Goalie g1: win 5, 30 saves 6, 2 GA -2 = 9 ; g2: win 5, 25 saves 5, shutout 5 = 15 -> per game 12
  const rows = [
    row('NHL', 's', '2026-10-20', { group: 'skaters', stats: { goals: 1, assists: 1, plus_minus: 1, shots_on_goal: 4, power_play_goals: 1, blocks: 2, hits: 3, penalty_minutes: 2 } }, { team: 'DET' }),
    row('NHL', 's', '2026-10-22', { group: 'skaters', stats: { assists: 2, shots_on_goal: 2, hits: 1 } }, { team: 'DET' }),
    row('NHL', 'g', '2026-10-20', { group: 'goalies', stats: { win: 1, saves: 30, goals_allowed: 2, shots_against: 32 } }, { team: 'DET' }),
    row('NHL', 'g', '2026-10-22', { group: 'goalies', stats: { win: 1, saves: 25, goals_allowed: 0, shutouts: 1, shots_against: 25 } }, { team: 'DET' }),
  ]
  const blob = build('NHL', rows, { s: 'C', g: 'G' })
  const scored = scoreFormBlob(blob, buildLeagueStatScorer({ sport: 'NHL', settings: {} })!)

  it('skater', () => {
    expect(scored.get('s')!.perGame).toBe(6.5)
    expect(projectPeriodPoints({ perGame: 6.5, teamGames: 4, available: true, part: blob.players.s.part })).toBe(26)
  })
  it('goalie', () => {
    expect(scored.get('g')!.seasonPoints).toBe(24)
    expect(scored.get('g')!.perGame).toBe(12)
    expect(blob.players.g.pos).toBe('G')
  })
})

describe('MLB — a hitter and a starting pitcher by hand', () => {
  /*
   * League rules set explicitly: r 1, hr 4, rbi 1, tb 1, bb 1, bat_so -1 ; so 1, ip 3, w 4, er -2.
   *   H g1: 1 R, 1 HR, 2 RBI, TB 5 (1B + HR), 1 BB, 1 SO = 1 + 4 + 2 + 5 + 1 - 1 = 12
   *   H g2: 1B, 2 SO                                     = 1 - 2                 = -1   -> per game 5.5
   *   SP g1: 6 IP (18) 7 K, W (4), 2 ER (-4) = 25 ; g2: 5 IP (15) 5 K, 3 ER (-6) = 14 -> per game 19.5
   *   His team played 10 games, he pitched 2 -> participation 0.2; six team games -> 19.5 x 6 x 0.2 = 23.4
   */
  const settings = { sportConfig: { categoryPoints: { r: 1, hr: 4, rbi: 1, sb: 2, tb: 1, bb: 1, bat_so: -1, w: 4, sv: 5, so: 1, ip: 3, qs: 0, l: 0, er: -2, hld: 0, era: 0 } } }
  const teammates = Array.from({ length: 7 }, (_, i) =>
    row('MLB', 'mate', `2026-09-${String(i + 1).padStart(2, '0')}`, { group: 'batting', position: '1B', stats: { AB: 4, H: 0 } }, { team: 'NYY' }),
  )
  const rows = [
    row('MLB', 'h', '2026-09-20', { group: 'batting', position: 'LF', stats: { AB: 4, H: 2, R: 1, HR: 1, RBI: 2, '1B': 1, BB: 1, SO: 1 } }, { team: 'NYY', providerGameId: '2026-09-20-h' }),
    row('MLB', 'h', '2026-09-21', { group: 'batting', position: 'LF', stats: { AB: 3, H: 1, '1B': 1, SO: 2 } }, { team: 'NYY' }),
    // A playoff game does not count toward the season or toward form.
    { ...row('MLB', 'h', '2026-10-10', { group: 'batting', stats: { AB: 4, H: 4, HR: 4, RBI: 8, R: 4 } }, { team: 'NYY' }), normalizedStatMap: { seasonType: 'post', group: 'batting', stats: { AB: 4, H: 4, HR: 4 } } },
    row('MLB', 'sp', '2026-09-20', { group: 'pitching', position: 'S', stats: { IP: 6, K: 7, ER: 2, W: 1 } }, { team: 'NYY', providerGameId: '2026-09-20-h' }),
    row('MLB', 'sp', '2026-09-25', { group: 'pitching', position: 'S', stats: { IP: 5, K: 5, ER: 3, L: 1 } }, { team: 'NYY' }),
    row('MLB', 'rp', '2026-09-22', { group: 'pitching', position: 'R', stats: { IP: 1, K: 2 } }, { team: 'BOS' }),
    ...teammates,
  ]
  // NYY's regular-season game keys: the hitter's two (the first shared with the SP's first start), the
  // SP's second start, and seven teammate games = 10. The playoff game is not one of them.
  const blob = build('MLB', rows, { h: 'LF', sp: 'P', rp: 'P', mate: '1B' })
  const scored = scoreFormBlob(blob, buildLeagueStatScorer({ sport: 'MLB', settings })!)

  it('hitter: corner outfield ranks as OF, playoffs excluded', () => {
    expect(blob.players.h.pos).toBe('OF')
    expect(blob.players.h.sg).toBe(2)
    expect(scored.get('h')!.perGame).toBe(5.5)
    expect(blob.players.h.part).toBeNull()
    expect(projectPeriodPoints({ perGame: 5.5, teamGames: 6, available: true, part: null })).toBe(33)
  })

  it('starting pitcher: SP from his starts, scaled by how often he pitches', () => {
    expect(blob.players.sp.pos).toBe('SP')
    expect(scored.get('sp')!.perGame).toBe(19.5)
    expect(blob.players.sp.part).toBe(0.2)
    expect(projectPeriodPoints({ perGame: scored.get('sp')!.perGame, teamGames: 6, available: true, part: blob.players.sp.part })).toBe(23.4)
  })

  it('a pitcher who relieved is an RP', () => {
    expect(blob.players.rp.pos).toBe('RP')
    expect(blob.players.rp.rg).toBe(1)
    // One appearance is under the two-game floor: no rate, so no projection (never a guess).
    expect(scored.get('rp')!.perGame).toBeNull()
    expect(projectPeriodPoints({ perGame: null, teamGames: 3, available: true, part: 1 })).toBeNull()
  })
})

describe('position rank', () => {
  const p = (id: string, pos: string | null, seasonPoints: number): ScoredFormPlayer => ({ id, pos, seasonPoints, perGame: null, recentGames: 0, part: null, team: null })

  it('orders by season points within position; ties share a rank and the next rank skips', () => {
    const ranks = positionRanks([p('d', 'C', 30), p('a', 'C', 50), p('b', 'C', 40), p('c', 'C', 40), p('x', 'PG', 10), p('n', null, 99)])
    expect([...['a', 'b', 'c', 'd']].map((id) => ranks.get(id)!.rank)).toEqual([1, 2, 2, 4])
    expect(ranks.get('a')).toEqual({ position: 'C', rank: 1, of: 4 })
    expect(ranks.get('x')).toEqual({ position: 'PG', rank: 1, of: 1 })
    expect(ranks.has('n')).toBe(false)
    expect(formatPositionRank(ranks.get('d'))).toBe('C4')
  })
})

describe('availability and rank groups', () => {
  it('ruled out, IL and Rolling Insights INACT zero a player; questionable does not', () => {
    for (const s of ['Out', 'IR', '60-Day IL', 'INACT', 'Inactive', 'Suspension']) expect(isUnavailableForProjection(s)).toBe(true)
    for (const s of ['Questionable', 'Day-To-Day', 'ACT', null, '']) expect(isUnavailableForProjection(s)).toBe(false)
  })

  it('MLB pitchers split by starts; a pinch-hit line does not name a position', () => {
    expect(rankPositionFor('MLB', 'P', { pitchingApps: 4, starts: 3, lastGamePosition: null })).toBe('SP')
    expect(rankPositionFor('MLB', 'P', { pitchingApps: 4, starts: 1, lastGamePosition: null })).toBe('RP')
    expect(rankPositionFor('MLB', null, { pitchingApps: 0, starts: 0, lastGamePosition: 'PH-2B' })).toBe('2B')
    expect(rankPositionFor('MLB', null, { pitchingApps: 0, starts: 0, lastGamePosition: 'PH' })).toBeNull()
    expect(rankPositionFor('NHL', 'LW', { pitchingApps: 0, starts: 0, lastGamePosition: 'C' })).toBe('LW')
  })
})
