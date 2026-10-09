import { describe, expect, it } from 'vitest'

import { extractSeasonAggregate, mlbPerGameRates, perGameRates, perGameRatesFor } from '@/lib/af-projections/core'
import { MLB_SIX_BY_SIX } from '@/lib/category-scoring/MlbCategoryRegistry'
import type { CategoryDefinition } from '@/lib/category-scoring/types'
import { MLB_CONFIG } from '@/lib/sportConfig/configs/mlb'

/** Every stat key a category reads: a counting stat, or a ratio's parts. */
function categoryStatKeys(categories: readonly CategoryDefinition[]): string[] {
  return categories.flatMap(({ computation: c }) =>
    c.kind === 'sum' ? [c.statKey] : [c.numeratorStatKey, c.denominatorStatKey, ...(c.additionalNumeratorStatKeys ?? [])],
  )
}

/**
 * MLB per-game rates for `AFProjectionSnapshot.adjustmentFactors.perGameRates`.
 *
 * Until 2026-10-09 every MLB row stored `{E, PO}` — fielding — because the production sits under
 * `regular_season.batting` / `.pitching`. These lines are verbatim 2025 `fantasy_stat_lines` payloads
 * read from production (innings and ERA arrive as strings, innings in baseball notation).
 */
const line = (gp: number, groups: { batting?: Record<string, unknown> | null; pitching?: Record<string, unknown> | null }) => ({
  riTeam: 'Team',
  riPlayerName: 'Player',
  position: 'P',
  regular_season: { games_played: gp, E: 2, PO: 30, ...groups },
})

const JUDGE = line(152, {
  pitching: null,
  batting: { H: 179, R: 137, '1B': 94, '2B': 30, '3B': 2, AB: 541, BB: 124, CS: 5, HR: 53, SB: 12, SO: 160, HBP: 7, IBB: 36, RBI: 114, Outs: 266 },
})
const SKENES = line(32, {
  batting: null,
  pitching: { H: 136, K: 216, L: 10, R: 45, S: 0, W: 10, '1B': 86, '2B': 37, '3B': 2, BB: 42, BK: 0, BS: 0, CS: 2, ER: 41, HR: 11, IP: '187.2', SB: 4, WP: 2, ERA: '1.97', HBP: 6, HLD: 0, IBB: 0, pitches: 2997, strikes: 1952 },
})
const OHTANI = line(158, {
  pitching: { H: 40, K: 62, L: 1, R: 15, S: 0, W: 1, '1B': 31, '2B': 6, '3B': 0, BB: 9, BK: 0, BS: 0, CS: 0, ER: 15, HR: 3, IP: '47.0', SB: 1, WP: 10, ERA: '2.87', HBP: 0, HLD: 0, IBB: 0, pitches: 753, strikes: 495 },
  batting: { H: 172, R: 146, '1B': 83, '2B': 25, '3B': 9, AB: 611, BB: 109, CS: 6, HR: 55, SB: 20, SO: 187, HBP: 3, IBB: 20, RBI: 102, Outs: 340 },
})

const rates = (stats: unknown) => mlbPerGameRates(extractSeasonAggregate(stats)!)

describe('mlbPerGameRates', () => {
  it('stores a hitter’s production per game in the engine’s keys, not his fielding', () => {
    const r = rates(JUDGE)!
    expect(r.hr).toBeCloseTo(53 / 152, 9)
    expect(r.rbi).toBeCloseTo(114 / 152, 9)
    expect(r.r).toBeCloseTo(137 / 152, 9)
    expect(r.bat_so).toBeCloseTo(160 / 152, 9)
    expect(r.tb).toBeCloseTo((94 + 2 * 30 + 3 * 2 + 4 * 53) / 152, 9)
    expect(r).not.toHaveProperty('E')
    expect(r).not.toHaveProperty('PO')
    expect(r).not.toHaveProperty('so') // a batter's strikeouts are `bat_so`; `so` is a pitcher's
  })

  it('reads a pitcher’s innings in baseball notation and keeps hits allowed off the hitting keys', () => {
    const r = rates(SKENES)!
    expect(r.ip).toBeCloseTo((187 + 2 / 3) / 32, 9) // 187.2 is 187⅔ innings, not 187.2
    expect(r.outs).toBeCloseTo(563 / 32, 9)
    expect(r.so).toBeCloseTo(216 / 32, 9)
    expect(r.p_h).toBeCloseTo(136 / 32, 9)
    expect(r.w).toBeCloseTo(10 / 32, 9)
    expect(r).not.toHaveProperty('h')
  })

  it('never divides ERA by games, and leaves quality starts out rather than testing a season total', () => {
    const r = rates(SKENES)!
    expect(r).not.toHaveProperty('era')
    expect(r).not.toHaveProperty('ERA')
    expect(r).not.toHaveProperty('qs')
  })

  it('keeps a two-way player’s hits and hits allowed apart', () => {
    const r = rates(OHTANI)!
    expect(r.h).toBeCloseTo(172 / 158, 9)
    expect(r.p_h).toBeCloseTo(40 / 158, 9)
    expect(r.hr).toBeCloseTo(55 / 158, 9)
    expect(r.p_hr).toBeCloseTo(3 / 158, 9)
  })

  it('derives singles when the line has none, so total bases are not short', () => {
    const r = rates(line(10, { batting: { H: 20, '2B': 4, '3B': 1, HR: 5, AB: 60 } }))!
    expect(r.single).toBeCloseTo(10 / 10, 9)
    expect(r.tb).toBeCloseTo((10 + 2 * 4 + 3 * 1 + 4 * 5) / 10, 9)
  })

  it('is null for a fielding-only line', () => {
    expect(rates(line(5, {}))).toBeNull()
  })

  it('only emits keys a points league or an MLB category reads', () => {
    const read = new Set([...MLB_CONFIG.scoringCategories.map((c) => c.key), ...categoryStatKeys(MLB_SIX_BY_SIX)])
    for (const stats of [JUDGE, SKENES, OHTANI]) {
      for (const key of Object.keys(rates(stats)!)) expect(read.has(key), key).toBe(true)
    }
  })

  it('carries every stat the 5x5 and 6x6 categories read, AVG, ERA and WHIP included', () => {
    const r = rates(OHTANI)!
    for (const key of categoryStatKeys(MLB_SIX_BY_SIX)) expect(r, key).toHaveProperty(key)
  })
})

describe('perGameRatesFor', () => {
  it('routes only MLB to the grouped builder', () => {
    const agg = extractSeasonAggregate(JUDGE)!
    expect(perGameRatesFor('mlb', agg)).toEqual(mlbPerGameRates(agg))
    const nfl = extractSeasonAggregate({ regular_season: { games_played: 4, receptions: 20, snap_counts: { offense: 200 } } })!
    expect(perGameRatesFor('NFL', nfl)).toEqual(perGameRates(nfl))
    expect(perGameRatesFor('NFL', nfl)).toEqual({ receptions: 5 })
  })
})
