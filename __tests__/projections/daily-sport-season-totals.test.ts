/**
 * Last season from SEASON TOTALS (lib/projections/dailySportSeasonTotals.ts): the per-sport mapping,
 * the gates that refuse a sport or a league whose scoring weights a key the totals cannot supply, and
 * the blend reading totals ÷ games as last season's per-game rate.
 *
 * The fixture rows are real `player_season_stats` 2025 rows (source rolling_insights), read 2026-10-26.
 */
import { describe, expect, it } from 'vitest'

import { scoreFormBlob, type DailySportFormBlob } from '@/lib/projections/dailySportForm'
import {
  buildSeasonTotalsForm,
  leagueAcceptsSeasonTotals,
  mapSeasonTotals,
  seasonTotalsBlockersForSport,
  seasonTotalsUnmappedKeys,
} from '@/lib/projections/dailySportSeasonTotals'
import { resolveLeagueScoringRules } from '@/lib/redraft/leagueScoringRules'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'

// Adam Fantilli, CBJ, 2025-26.
const NHL_SKATER_2025 = {
  hits: 139, goals: 24, blocks: 51, assists: 35, giveaways: 94, takeaways: 25, plus_minus: -13,
  time_on_ice: 93000, faceoffs_won: 552, games_played: 82, faceoffs_lost: 556, shots_on_goal: 214,
  shootout_goals: 0, penalty_minutes: 38, power_play_goals: 4, power_play_assists: 9,
  short_handed_goals: 0, short_handed_assists: 0,
}
// Karel Vejmelka, UTA, 2025-26 — a goalie row (disjoint keys).
const NHL_GOALIE_2025 = {
  win: 20, loss: 8, saves: 1457, shutouts: 0, time_on_ice: 221565, games_played: 64,
  goals_allowed: 169, overtime_loss: 1, shots_against: 1626,
}
// Brandin Podziemski, GSW, 2025-26.
const NBA_2025 = {
  fouls: 136, blocks: 15, points: 1133, steals: 88, assists: 304, minutes: 139965, turnovers: 131,
  plus_minus: -18, games_played: 82, total_rebounds: 419, two_points_made: 241, field_goals_made: 394,
  free_throws_made: 192, three_points_made: 153, defensive_rebounds: 347, offensive_rebounds: 72,
  two_point_percentage: 0.53, two_points_attempted: 454, field_goals_attempted: 866,
  free_throws_attempted: 241, three_points_attempted: 412,
}

const defaults = (sport: string) => resolveLeagueScoringRules({ sport, settings: null })!

describe('which sports qualify, under their default scoring', () => {
  it('NHL qualifies; NBA is blocked by its per-game doubles; MLB has no mapping', () => {
    expect(seasonTotalsBlockersForSport('NHL')).toEqual([])
    expect(seasonTotalsBlockersForSport('NBA')).toEqual(['dbl_dbl', 'trpl_dbl'])
    expect(seasonTotalsBlockersForSport('MLB')).toEqual(['no_mapping'])
  })

  it('an unmapped key with weight disqualifies; the same key at 0 does not', () => {
    const nhl = defaults('NHL')
    expect(seasonTotalsUnmappedKeys('NHL', nhl)).toEqual([])
    const withHatTrick = { ...nhl, overrides: { ...nhl.overrides, hat_trick: 2 } }
    expect(seasonTotalsUnmappedKeys('NHL', withHatTrick)).toEqual(['hat_trick'])
    // NBA with the doubles switched off is exact.
    const nba = defaults('NBA')
    expect(seasonTotalsUnmappedKeys('NBA', { ...nba, overrides: { ...nba.overrides, dbl_dbl: 0, trpl_dbl: 0 } })).toEqual([])
  })
})

describe('mapping a season row to scorer keys', () => {
  it('NHL skater: every vendor key lands on its scorer key, halves summed', () => {
    const m = mapSeasonTotals('NHL', NHL_SKATER_2025, 82)!
    expect(m.games).toBe(82)
    expect(m.line).toEqual({
      g: 24, a: 35, pts: 59, plusminus: -13, sog: 214, ppp: 13, ppg: 4, ppa: 9,
      blks: 51, hits: 139, pim: 38, fow: 552, fol: 556, tk: 25, gv: 94,
    })
    // Priced under the default scoring, it is the same number the per-key arithmetic gives.
    const scorer = buildLeagueStatScorer({ sport: 'NHL', settings: null })!
    const expected = 24 * 3 + 35 * 2 + -13 * 0.5 + 214 * 0.3 + 13 * 0.5 + 51 * 0.3 + 139 * 0.2 + 38 * -0.1
    expect(scorer(m.line, 'C')).toBeCloseTo(expected, 6)
  })

  it('NHL goalie rows are refused (their 2025 decisions are half a season), and so is a broken skater row', () => {
    expect(mapSeasonTotals('NHL', NHL_GOALIE_2025, 64)).toBeNull()
    const { hits: _drop, ...noHits } = NHL_SKATER_2025
    expect(mapSeasonTotals('NHL', noHits, 82)).toBeNull()
    expect(mapSeasonTotals('NHL', { ...NHL_SKATER_2025, goals: '24' }, 82)).toBeNull()
    expect(mapSeasonTotals('NHL', NHL_SKATER_2025, 0)).toBeNull()
    expect(mapSeasonTotals('NHL', NHL_SKATER_2025, null)).toBeNull()
  })

  it('NBA maps too — it is the gate, not the table, that keeps it out', () => {
    expect(mapSeasonTotals('NBA', NBA_2025, 82)!.line).toEqual({
      pts: 1133, reb: 419, ast: 304, stl: 88, blk: 15, to: 131, threes: 153,
      fgm: 394, ftm: 192, fga: 866, fta: 241,
    })
  })
})

describe('the blend reads totals ÷ games as last season\'s rate', () => {
  const now = new Date('2026-10-25T07:00:00Z')
  const prior = buildSeasonTotalsForm({
    sport: 'NHL',
    season: 2025,
    rows: [
      { playerId: 'id-skater', stats: NHL_SKATER_2025, gamesPlayed: 82, team: 'Columbus Blue Jackets' },
      { playerId: 'id-goalie', stats: NHL_GOALIE_2025, gamesPlayed: 64, team: 'Utah Mammoth' },
    ],
    identityPositions: new Map([['id-skater', 'C'], ['id-goalie', 'G']]),
    computedAt: now,
  })

  it('stores the skater only, marked as totals, with the keys it can price', () => {
    expect(Object.keys(prior.players)).toEqual(['id-skater'])
    expect(prior.players['id-skater']).toMatchObject({ pos: 'C', sg: 82, rg: 0, rs: {}, part: null })
    expect(prior.basis).toBe('season_totals')
    expect(prior.mappedKeys).toContain('g_win')
    expect(prior.mappedKeys).not.toContain('hat_trick')
  })

  it('blendPerGame takes the totals-derived rate', () => {
    const scorer = buildLeagueStatScorer({ sport: 'NHL', settings: null })!
    const lastRate = scorer(prior.players['id-skater']!.ss, 'C') / 82
    const thisSeason: DailySportFormBlob = {
      v: 1, sport: 'NHL', season: 2026, computedAt: now.toISOString(), recentGames: 10,
      players: { 'id-skater': { pos: 'C', team: 'CBJ', sg: 4, ss: { g: 4 }, rg: 4, rs: { g: 4 }, part: null } },
    }
    const out = scoreFormBlob(thisSeason, scorer, prior).get('id-skater')!
    // (4 games x 3 a game + 8 x lastRate) / 12, K = 8 for NHL
    expect(out.perGame).toBeCloseTo((4 * 3 + 8 * lastRate) / 12, 2)
    expect(out.priorGames).toBe(82)
  })

  it('a league weighting an unmapped key declines the totals prior; the default league accepts it', () => {
    expect(leagueAcceptsSeasonTotals({ sport: 'NHL', settings: null }, prior)).toBe(true)
    const custom = { sportConfig: { categoryPoints: { hat_trick: 2 } } }
    expect(leagueAcceptsSeasonTotals({ sport: 'NHL', settings: custom }, prior)).toBe(false)
  })
})
