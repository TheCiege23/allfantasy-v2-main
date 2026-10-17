import { describe, expect, it } from 'vitest'
import {
  accumulateTeamTotals,
  resolveCategoryMatchup,
} from '@/lib/category-scoring/CategoryMatchupResolver'
import {
  NBA_CATEGORY_FG_PCT,
  NBA_CATEGORY_POINTS,
  NBA_CATEGORY_TURNOVERS,
  NBA_EIGHT_CAT,
  NBA_NINE_CAT,
  getNbaCategoryPreset,
} from '@/lib/category-scoring/NbaCategoryRegistry'

describe('NbaCategoryRegistry', () => {
  it('standard 8-cat excludes turnovers and includes 3PM', () => {
    expect(NBA_EIGHT_CAT.map((c) => c.id)).not.toContain('nba_to')
    expect(NBA_EIGHT_CAT.map((c) => c.id)).toContain('nba_3pm')
    expect(NBA_NINE_CAT.map((c) => c.id)).toContain('nba_3pm')
  })

  it('getNbaCategoryPreset returns the correct preset', () => {
    expect(getNbaCategoryPreset('nba_8cat')).toHaveLength(8)
    expect(getNbaCategoryPreset('nba_9cat')).toHaveLength(9)
  })

  it('turnovers are direction: lower', () => {
    expect(NBA_CATEGORY_TURNOVERS.direction).toBe('lower')
  })

  it('FG% is a ratio of made/attempted', () => {
    expect(NBA_CATEGORY_FG_PCT.computation.kind).toBe('ratio')
  })
})

describe('accumulateTeamTotals', () => {
  it('sums per-player stat maps, ignoring non-finite values', () => {
    const totals = accumulateTeamTotals([
      { points_scored: 20, rebound: 5 },
      { points_scored: 15, rebound: 10, assist: 3 },
      { points_scored: Infinity as unknown as number, rebound: 2 },
    ])
    expect(totals).toEqual({ points_scored: 35, rebound: 17, assist: 3 })
  })

  it('returns an empty object for empty input', () => {
    expect(accumulateTeamTotals([])).toEqual({})
  })

  it('treats missing keys as absent, not zero', () => {
    const totals = accumulateTeamTotals([{ points_scored: 10 }, { rebound: 5 }])
    expect(totals).toEqual({ points_scored: 10, rebound: 5 })
  })
})

describe('resolveCategoryMatchup — sum categories', () => {
  it('awards higher value the win in a direction:higher category', () => {
    const result = resolveCategoryMatchup(
      { points_scored: 120 },
      { points_scored: 110 },
      [NBA_CATEGORY_POINTS],
    )
    expect(result.aWins).toBe(1)
    expect(result.bWins).toBe(0)
    expect(result.ties).toBe(0)
    expect(result.categories[0]!.winner).toBe('a')
  })

  it('awards lower value the win in a direction:lower category', () => {
    const result = resolveCategoryMatchup(
      { turnover: 15 },
      { turnover: 10 },
      [NBA_CATEGORY_TURNOVERS],
    )
    expect(result.aWins).toBe(0)
    expect(result.bWins).toBe(1)
    expect(result.categories[0]!.winner).toBe('b')
  })

  it('records ties without awarding either side', () => {
    const result = resolveCategoryMatchup(
      { points_scored: 100 },
      { points_scored: 100 },
      [NBA_CATEGORY_POINTS],
    )
    expect(result.aWins).toBe(0)
    expect(result.bWins).toBe(0)
    expect(result.ties).toBe(1)
    expect(result.categories[0]!.winner).toBe('tie')
  })

  it('missing stat keys on one side default to 0 (opponent wins)', () => {
    const result = resolveCategoryMatchup(
      { points_scored: 50 },
      {}, // team B produced nothing
      [NBA_CATEGORY_POINTS],
    )
    expect(result.aWins).toBe(1)
    expect(result.categories[0]!.bValue).toBe(0)
  })
})

describe('resolveCategoryMatchup — ratio categories', () => {
  it('FG%: higher percentage wins, computed from team totals not per-player avgs', () => {
    // Team A: 50/100 = 50.0%, Team B: 45/90 = 50.0% -> tie
    const tie = resolveCategoryMatchup(
      { field_goals_made: 50, field_goals_attempted: 100 },
      { field_goals_made: 45, field_goals_attempted: 90 },
      [NBA_CATEGORY_FG_PCT],
    )
    expect(tie.categories[0]!.winner).toBe('tie')
    // Team A: 48/100 = 48.0%, Team B: 45/90 = 50.0% -> B wins
    const bWins = resolveCategoryMatchup(
      { field_goals_made: 48, field_goals_attempted: 100 },
      { field_goals_made: 45, field_goals_attempted: 90 },
      [NBA_CATEGORY_FG_PCT],
    )
    expect(bWins.categories[0]!.winner).toBe('b')
  })

  it('zero denominator does not produce NaN — both teams resolve to 0', () => {
    const result = resolveCategoryMatchup(
      { field_goals_made: 0, field_goals_attempted: 0 },
      { field_goals_made: 0, field_goals_attempted: 0 },
      [NBA_CATEGORY_FG_PCT],
    )
    expect(result.categories[0]!.aValue).toBe(0)
    expect(result.categories[0]!.bValue).toBe(0)
    expect(result.categories[0]!.winner).toBe('tie')
  })

  it('one side with zero attempts scores 0 — opponent with attempts wins', () => {
    const result = resolveCategoryMatchup(
      { field_goals_made: 40, field_goals_attempted: 90 }, // ~44%
      { field_goals_made: 0, field_goals_attempted: 0 }, // 0
      [NBA_CATEGORY_FG_PCT],
    )
    expect(result.categories[0]!.winner).toBe('a')
  })
})

describe('resolveCategoryMatchup — full 9-cat matchup', () => {
  it('aggregates across all 9 categories with mixed wins/losses/ties', () => {
    const teamA = {
      points_scored: 600,
      rebound: 200,
      assist: 140,
      steal: 30,
      block: 25,
      turnover: 55, // lower wins — A loses this
      field_goals_made: 225,
      field_goals_attempted: 500, // 45.0%
      free_throws_made: 90,
      free_throws_attempted: 110, // 81.8%
      three_point_made: 55,
    }
    const teamB = {
      points_scored: 580,
      rebound: 220, // higher wins — B wins
      assist: 145, // higher wins — B wins
      steal: 30, // tie
      block: 25, // tie
      turnover: 45,
      field_goals_made: 210,
      field_goals_attempted: 500, // 42.0% — A wins FG%
      free_throws_made: 100,
      free_throws_attempted: 110, // 90.9% — B wins FT%
      three_point_made: 60, // B wins 3PM
    }
    const result = resolveCategoryMatchup(teamA, teamB, NBA_NINE_CAT)
    // Expected: A wins PTS, FG% (2). B wins REB, AST, TO (lower wins), FT%, 3PM (5). Ties: STL, BLK (2).
    expect(result.aWins).toBe(2)
    expect(result.bWins).toBe(5)
    expect(result.ties).toBe(2)
    expect(result.categories).toHaveLength(9)
  })
})
