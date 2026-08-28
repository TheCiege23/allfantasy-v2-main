import { describe, expect, it } from 'vitest'

import {
  componentsForCategoryScoring,
  getCategoryScoringRules,
  isCategoryScoredSport,
  scoreCategoryComponents,
} from '@/lib/af-projections/categoryScoring'
import { extractSeasonAggregate } from '@/lib/af-projections/core'

/**
 * Category scoring for MLB / NBA / NHL.
 *
 * Two failure modes here are silent rather than loud, and both are asserted below:
 *   - MLB reuses keys across `batting` and `pitching` with OPPOSITE meanings, so a flat merge
 *     scores hits ALLOWED as hits recorded;
 *   - a rule set whose keys stop matching the payload scores every player to exactly 0.0 and
 *     presents it as a projection.
 */

// Verbatim shape from `fantasy_stat_lines`, matching what the ingest writes.
const MLB_STATS = {
  riTeam: 'Athletics',
  riPlayerName: 'Two Way',
  position: 'DH',
  regular_season: {
    games_played: 10,
    E: 1,
    batting: { '1B': 10, '2B': 2, '3B': 1, HR: 3, RBI: 12, R: 8, BB: 5, SB: 2, H: 16 },
    pitching: { IP: 20, K: 25, W: 2, ER: 6, H: 14, BB: 4 },
  },
}

describe('MLB grouped keys', () => {
  it('keeps batting and pitching apart — a hit allowed is not a hit recorded', () => {
    const agg = extractSeasonAggregate(MLB_STATS)!
    const merged = componentsForCategoryScoring(agg)

    // The two H values must survive as DISTINCT entries. If either is missing, or if some flat
    // `H` exists carrying 16+14=30, the namespaces were merged.
    expect(merged['batting.H']).toBe(16)
    expect(merged['pitching.H']).toBe(14)
    expect(merged.H).toBeUndefined()
  })

  it('does not put grouped keys into `components` — NFL reads that map', () => {
    const agg = extractSeasonAggregate(MLB_STATS)!
    expect(agg.components).toEqual({ games_played: 10, E: 1 })
    expect(agg.groupedComponents?.['batting.HR']).toBe(3)
  })

  it('scores hitting and pitching under their own signs', () => {
    const agg = extractSeasonAggregate(MLB_STATS)!
    const scored = scoreCategoryComponents({
      components: componentsForCategoryScoring(agg),
      rules: getCategoryScoringRules('MLB')!,
    })!
    // Earned runs and hits allowed must REDUCE the total.
    expect(scored.breakdown['pitching.ER']).toBeLessThan(0)
    expect(scored.breakdown['pitching.H']).toBeLessThan(0)
    expect(scored.breakdown['batting.HR']).toBe(30)
    expect(scored.points).toBeGreaterThan(0)
  })
})

describe('a rule set that matches nothing REFUSES rather than scoring zero', () => {
  it('returns null when no rule key is present', () => {
    const scored = scoreCategoryComponents({
      components: { totally_different_key: 99 },
      rules: { points: 1, assists: 1.5 },
    })
    // 0.0 presented as a projection is indistinguishable from an unproductive player. This is
    // the guard against an upstream stat-key rename turning a whole sport into silent zeroes.
    expect(scored).toBeNull()
  })

  it('a genuine zero from MATCHED keys is still a score, not a refusal', () => {
    const scored = scoreCategoryComponents({
      components: { points: 0, assists: 0 },
      rules: { points: 1, assists: 1.5 },
    })
    expect(scored).not.toBeNull()
    expect(scored!.points).toBe(0)
    expect(scored!.matched).toBe(2)
  })
})

describe('NBA and NHL rules', () => {
  it('NBA uses total_rebounds only, so a rebound is never counted twice', () => {
    const rules = getCategoryScoringRules('NBA')!
    expect(rules.total_rebounds).toBeGreaterThan(0)
    expect(rules.offensive_rebounds).toBeUndefined()
    expect(rules.defensive_rebounds).toBeUndefined()
  })

  it('NBA turnovers cost points', () => {
    expect(getCategoryScoringRules('NBA')!.turnovers).toBeLessThan(0)
  })

  it('NHL scores skaters and goalies from one map without collision', () => {
    const rules = getCategoryScoringRules('NHL')!
    const skater = scoreCategoryComponents({
      components: { goals: 2, assists: 3, shots_on_goal: 8, blocks: 2 },
      rules,
    })!
    const goalie = scoreCategoryComponents({
      components: { win: 1, saves: 30, goals_allowed: 2, shutouts: 0 },
      rules,
    })!
    expect(skater.points).toBeGreaterThan(0)
    expect(goalie.points).toBeGreaterThan(0)
    // A goalie's own keys must not be scored as skater production and vice versa.
    expect(skater.breakdown.saves).toBeUndefined()
    expect(goalie.breakdown.goals).toBeUndefined()
  })

  it('goals allowed reduce a goalie score', () => {
    expect(getCategoryScoringRules('NHL')!.goals_allowed).toBeLessThan(0)
  })
})

describe('sport gating', () => {
  it('covers exactly MLB, NBA and NHL', () => {
    expect(isCategoryScoredSport('MLB')).toBe(true)
    expect(isCategoryScoredSport('nba')).toBe(true)
    expect(isCategoryScoredSport('NHL')).toBe(true)
    // Football must keep its own bases; soccer and college have no rules and must keep refusing
    // rather than be handed a default nobody chose.
    expect(isCategoryScoredSport('NFL')).toBe(false)
    expect(isCategoryScoredSport('SOCCER')).toBe(false)
    expect(isCategoryScoredSport('NCAAB')).toBe(false)
  })

  it('returns null rules for an unscored sport, never an empty map', () => {
    // `{}` would score every player to 0.0 and call it a projection.
    expect(getCategoryScoringRules('SOCCER')).toBeNull()
    expect(getCategoryScoringRules(null)).toBeNull()
  })
})

describe('NFL is provably untouched', () => {
  it('an NFL aggregate gains no grouped field, even with a nested snap_counts object', () => {
    const agg = extractSeasonAggregate({
      riPlayerName: 'Some Back',
      position: 'RB',
      regular_season: {
        games_played: 17,
        rushing_yards: 1200,
        DK_fantasy_points_per_game: 14.2,
        snap_counts: { offense: 500, defense: 0 },
      },
    })!
    expect(agg.components.rushing_yards).toBe(1200)
    expect(agg.components.snap_counts).toBeUndefined()
    expect(agg.dkPointsPerGame).toBe(14.2)
    // The nested object is captured, but OUT of `components` where football consumers read.
    expect(agg.groupedComponents).toEqual({ 'snap_counts.offense': 500, 'snap_counts.defense': 0 })
  })
})
