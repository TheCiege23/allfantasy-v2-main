/**
 * The early-season blend (2026-11-16, owner's decision for NBA values): per game = w × this season +
 * (1 − w) × last season, w = g / (g + 20); games = both seasons'.
 */
import { describe, expect, it } from 'vitest'

import { BLEND_GAMES, BLEND_SPORTS, blendSeasonStats, blendWeight, inningsNotation } from '@/lib/af-projections/seasonBlend'
import { extractSeasonAggregate, mlbPerGameRates, perGameRates } from '@/lib/af-projections/core'

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

  it('NBA first, then MLB, by the owner’s order', () => {
    expect([...BLEND_SPORTS][0]).toBe('NBA')
  })
})

describe('⚾ baseball lines (MLB joined 2026-11-16)', () => {
  // Shaped like production's 2025 rows: innings in baseball notation and ERA as strings, an id riding along.
  const prev = { position: 'P', regular_season: { games_played: 32, E: 1, batting: null, pitching: { IP: '187.2', K: 216, ER: 41, ERA: '1.97', player_id: 4321 } } }
  const cur = { position: 'P', regular_season: { games_played: 4, E: 0, batting: null, pitching: { IP: '20.1', K: 30, ER: 9, ERA: '3.98', player_id: 4321 } } }

  it('blends innings as innings and writes them back in notation, so 187.2 is never read as 187.2', () => {
    const r = blendSeasonStats(cur, prev)!
    const w = 4 / 24
    const trueIp = (w * (20 + 1 / 3) / 4 + (1 - w) * (187 + 2 / 3) / 32) * 36
    const ip = (r.stats.regular_season as any).pitching.IP as number
    // Notation: the tenths digit is outs, 0–2.
    const outs = Math.round((ip - Math.trunc(ip)) * 10)
    expect(outs).toBeGreaterThanOrEqual(0)
    expect(outs).toBeLessThanOrEqual(2)
    expect(Math.trunc(ip) + outs / 3).toBeCloseTo(trueIp, 0)
  })

  it('ERA blends as a rate, an id is kept, counting stats blend per game over both seasons’ games', () => {
    const r = blendSeasonStats(cur, prev)!
    const p = (r.stats.regular_season as any).pitching
    const w = 4 / 24
    expect(p.ERA).toBeCloseTo(w * 3.98 + (1 - w) * 1.97, 9)
    expect(p.player_id).toBe(4321)
    expect(p.K).toBeCloseTo((w * (30 / 4) + (1 - w) * (216 / 32)) * 36, 9)
    expect((r.stats.regular_season as any).games_played).toBe(36)
    expect((r.stats.regular_season as any).batting).toBeNull()
  })

  it('the blended line goes through the real MLB per-game reader: innings per start between the two seasons', () => {
    const r = blendSeasonStats(cur, prev)!
    const rates = mlbPerGameRates(extractSeasonAggregate(r.stats)!)!
    const w = 4 / 24
    expect(rates.ip).toBeCloseTo(w * ((20 + 1 / 3) / 4) + (1 - w) * ((187 + 2 / 3) / 32), 1)
    expect(rates.so).toBeCloseTo(w * (30 / 4) + (1 - w) * (216 / 32), 6)
  })

  it('inningsNotation rounds to the nearest out and carries a third out into the next inning', () => {
    expect(inningsNotation(190 + 1 / 3)).toBe(190.1)
    expect(inningsNotation(190 + 2 / 3)).toBe(190.2)
    expect(inningsNotation(190.99)).toBe(191)
  })

  it('MLB is a blend sport now', () => {
    expect([...BLEND_SPORTS]).toContain('MLB')
  })
})

describe('🏒 hockey lines (NHL joined 2026-11-16)', () => {
  const goalie = (gp: number, sv: number, ga: number, svPct: number, gaa: number) => ({
    position: 'G',
    regular_season: { games_played: gp, saves: sv, goals_allowed: ga, win: Math.round(gp / 2), save_percentage: svPct, goals_against_average: gaa, time_on_ice: '58:12' },
  })

  it('save % and goals-against average blend as rates; saves and wins per game over both seasons’ games', () => {
    const r = blendSeasonStats(goalie(6, 170, 14, 0.924, 2.33), goalie(55, 1500, 140, 0.915, 2.6))!
    const rs = r.stats.regular_season as any
    const w = 6 / 26
    expect(rs.save_percentage).toBeCloseTo(w * 0.924 + (1 - w) * 0.915, 9)
    expect(rs.goals_against_average).toBeCloseTo(w * 2.33 + (1 - w) * 2.6, 9)
    expect(rs.saves).toBeCloseTo((w * (170 / 6) + (1 - w) * (1500 / 55)) * 61, 9)
    expect(rs.games_played).toBe(61)
    // A clock string is not a number: this season's is kept, never summed into nonsense.
    expect(rs.time_on_ice).toBe('58:12')
  })

  it('NHL is a blend sport', () => {
    expect([...BLEND_SPORTS]).toEqual(['NBA', 'MLB', 'NHL'])
  })
})

