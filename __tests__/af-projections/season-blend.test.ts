/**
 * The early-season blend (2026-11-16, owner's decision for NBA values): per game = w × this season +
 * (1 − w) × last season, w = g / (g + 20); games = both seasons'.
 */
import { describe, expect, it } from 'vitest'

import { BLEND_GAMES, BLEND_SPORTS, blendSeasonStats, blendWeight } from '@/lib/af-projections/seasonBlend'
import { extractSeasonAggregate, perGameRates } from '@/lib/af-projections/core'

const line = (gp: number, perGame: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  position: 'PG',
  riPlayerName: 'Tyrese Haliburton',
  regular_season: { games_played: gp, ...Object.fromEntries(Object.entries(perGame).map(([k, v]) => [k, v * gp])), ...extra },
})

describe('blendWeight', () => {
  it('this season counts g / (g + 20)', () => {
    expect(BLEND_GAMES).toBe(20)
    expect(blendWeight(5)).toBe(0.2)
    expect(blendWeight(20)).toBe(0.5)
    expect(blendWeight(60)).toBe(0.75)
    expect(blendWeight(0)).toBe(0)
  })
})

describe('blendSeasonStats', () => {
  it('per-game rates move gradually: 5 games of 30 ppg on top of a 20 ppg season reads 22, not 30', () => {
    const r = blendSeasonStats(line(5, { points: 30, assists: 10 }), line(70, { points: 20, assists: 9 }))!
    const agg = extractSeasonAggregate(r.stats)!
    expect(agg.gamesPlayed).toBe(75) // what the projection now rests on
    const rates = perGameRates(agg)
    expect(rates.points).toBeCloseTo(0.2 * 30 + 0.8 * 20, 9)
    expect(rates.assists).toBeCloseTo(0.2 * 10 + 0.8 * 9, 9)
    expect(r.weight).toBe(0.2)
    expect(r.stats.seasonBlend).toEqual({ currentGames: 5, previousGames: 70, currentWeight: 0.2 })
  })

  it('a field that is already a rate is blended as a rate, never scaled by games', () => {
    const r = blendSeasonStats(
      line(10, { points: 25 }, { DK_fantasy_points_per_game: 50, field_goal_percentage: 0.5 }),
      line(70, { points: 20 }, { DK_fantasy_points_per_game: 40, field_goal_percentage: 0.45 }),
    )!
    const regular = r.stats.regular_season as Record<string, number>
    const w = 10 / 30
    expect(regular.DK_fantasy_points_per_game).toBeCloseTo(w * 50 + (1 - w) * 40, 9)
    expect(regular.field_goal_percentage).toBeCloseTo(w * 0.5 + (1 - w) * 0.45, 9)
  })

  it('a stat missing from one season counts as zero there, and this season’s metadata is kept', () => {
    const r = blendSeasonStats(
      { ...line(20, { points: 20, blocks: 2 }), riTeam: 'IND' },
      { ...line(60, { points: 20 }), riTeam: 'OLD' },
    )!
    const rates = perGameRates(extractSeasonAggregate(r.stats)!)
    expect(rates.blocks).toBeCloseTo(0.5 * 2, 9)
    expect(r.stats.riTeam).toBe('IND')
  })

  it('nested groups (MLB-style) blend one level down', () => {
    const r = blendSeasonStats(
      { regular_season: { games_played: 20, batting: { hits: 30 } } },
      { regular_season: { games_played: 140, batting: { hits: 140 } } },
    )!
    const batting = (r.stats.regular_season as Record<string, Record<string, number>>).batting
    expect(batting.hits / 160).toBeCloseTo(0.5 * 1.5 + 0.5 * 1, 9)
  })

  it('nothing to blend without games on both sides', () => {
    expect(blendSeasonStats(line(0, { points: 0 }), line(70, { points: 20 }))).toBeNull()
    expect(blendSeasonStats(line(5, { points: 20 }), line(0, { points: 0 }))).toBeNull()
    expect(blendSeasonStats(null, line(70, { points: 20 }))).toBeNull()
  })

  it('NBA first, by the owner’s order', () => {
    expect([...BLEND_SPORTS]).toEqual(['NBA'])
  })
})
