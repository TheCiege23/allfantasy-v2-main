/**
 * NBA/NHL weekly stat normalization.
 *
 * These cover the half of the problem that IS knowable from committed sources.
 * The provider key spellings are unverified (ENDPOINTS.yaml: NBA `confidence:
 * low`, NHL `confidence: none`; GAPS.md G-01), so nothing here asserts that a
 * particular vendor field exists. What it does assert is that whatever we
 * extract lands on keys the scoring engine can actually score, that a week of
 * several games is summed rather than sampled, and that an unrecognised payload
 * is loud instead of silently zero.
 */
import { describe, expect, it } from 'vitest'
import { getSportConfig } from '@/lib/sportConfig'
import {
  aggregateWeeklyStats,
  collectCachedWeekRows,
  countDoubleDigitCategories,
  isDailyStatSport,
  normalizeDailySportWeeklyStats,
  normalizeNbaGameStats,
  normalizeNhlGameStats,
} from '@/lib/scoring-runtime/dailySportStatNormalization'

/** Bonus categories are derived here, not sent by the provider. */
const DERIVED_NBA_KEYS = new Set(['dbl_dbl', 'trpl_dbl'])

describe('normalized keys are keys the scoring engine can score', () => {
  // This is the assertion that matters most and is fully verifiable: if a
  // canonical key here is not a category key in the sport config,
  // `calculateScoreFromSportConfig` scores it as nothing and the league silently
  // under-scores forever, however correct the provider mapping is.
  it.each([
    ['NBA', normalizeNbaGameStats, { points: 30, rebounds: 12, assists: 11, steals: 2, blocks: 1, turnovers: 3, tpm: 4, fgm: 10, ftm: 6 }],
    ['NHL', normalizeNhlGameStats, { goals: 2, assists: 1, plus_minus: 3, shots: 7, power_play_points: 1, short_handed_points: 0, blocked: 2, hits: 4, penalty_minutes: 2, saves: 30, wins: 1, shutouts: 0, goals_against: 2 }],
  ])('%s output keys all exist in the sport config', (sport, normalize, payload) => {
    const configKeys = new Set(getSportConfig(sport).scoringCategories.map((c) => c.key))
    const { stats } = normalize(payload)

    expect(Object.keys(stats).length).toBeGreaterThan(0)
    for (const key of Object.keys(stats)) {
      expect(configKeys.has(key), `${sport} emits "${key}" which the sport config cannot score`).toBe(true)
    }
  })

  it('every derived NBA bonus key is also a real config category', () => {
    const configKeys = new Set(getSportConfig('NBA').scoringCategories.map((c) => c.key))
    for (const key of DERIVED_NBA_KEYS) expect(configKeys.has(key)).toBe(true)
  })
})

describe('a week of several games is summed, not sampled', () => {
  // The defect this module exists to prevent: the NFL path takes ONE row per
  // week, which for a 4-game NBA week scores a quarter of it and looks fine.
  const week = 3
  const payload = {
    logs: [
      { week, gameId: 'g1', stats: { points: 20, rebounds: 5, assists: 4 } },
      { week, gameId: 'g2', stats: { points: 18, rebounds: 7, assists: 6 } },
      { week, gameId: 'g3', stats: { points: 25, rebounds: 4, assists: 9 } },
      { week: week + 1, gameId: 'g4', stats: { points: 99, rebounds: 99, assists: 99 } },
    ],
  }

  it('collects every row for the week and none from other weeks', () => {
    expect(collectCachedWeekRows(payload, week)).toHaveLength(3)
  })

  it('sums the week rather than returning the first game', () => {
    const { stats, gamesCounted } = normalizeDailySportWeeklyStats('NBA', payload, week)
    expect(gamesCounted).toBe(3)
    expect(stats.pts).toBe(63)
    expect(stats.reb).toBe(16)
    expect(stats.ast).toBe(19)
  })

  it('ignores a week the player did not play', () => {
    const empty = normalizeDailySportWeeklyStats('NBA', payload, 99)
    expect(empty.gamesCounted).toBe(0)
    expect(empty.stats).toEqual({})
  })
})

describe('double-doubles are counted per game, never from week totals', () => {
  it('counts one double-double per qualifying game', () => {
    const payload = {
      logs: [
        { week: 1, gameId: 'a', stats: { points: 22, rebounds: 11, assists: 3 } }, // DD
        { week: 1, gameId: 'b', stats: { points: 19, rebounds: 12, assists: 10 } }, // TD
        { week: 1, gameId: 'c', stats: { points: 8, rebounds: 3, assists: 2 } }, // neither
      ],
    }
    const { stats } = normalizeDailySportWeeklyStats('NBA', payload, 1)
    expect(stats.dbl_dbl).toBe(2) // the DD game and the TD game both double-double
    expect(stats.trpl_dbl).toBe(1)
  })

  // The inflation trap: four quiet games total 40/20 but contain no
  // double-double. Deriving from the aggregate would invent one.
  it('does not invent a double-double from summed quiet games', () => {
    const payload = {
      logs: [1, 2, 3, 4].map((i) => ({ week: 2, gameId: `q${i}`, stats: { points: 10, rebounds: 5, assists: 1 } })),
    }
    const { stats } = normalizeDailySportWeeklyStats('NBA', payload, 2)
    expect(stats.pts).toBe(40)
    expect(stats.reb).toBe(20)
    // Each game had exactly one double-digit category (points), so no DD at all.
    expect(stats.dbl_dbl).toBeUndefined()
    expect(stats.trpl_dbl).toBeUndefined()
  })

  it('counts double-digit categories from the five that qualify', () => {
    expect(countDoubleDigitCategories({ pts: 10, reb: 10, ast: 10 })).toBe(3)
    expect(countDoubleDigitCategories({ pts: 30, threes: 12 })).toBe(1) // threes do not qualify
  })
})

describe('an unrecognised payload is loud, not silently zero', () => {
  // The MLB precedent recorded in ENDPOINTS.yaml: a parser written from a
  // sibling sport's hint yielded ZERO rows across fifteen games and did not say
  // so. A wrong alias table must be visible.
  it('reports numeric keys no alias claimed', () => {
    const { stats, unmappedKeys } = normalizeNbaGameStats({
      stats: { totally_unexpected_points: 30, another_mystery: 7 },
    })
    expect(stats).toEqual({})
    expect(unmappedKeys).toEqual(expect.arrayContaining(['totally_unexpected_points', 'another_mystery']))
  })

  it('surfaces unmapped keys through the weekly aggregate', () => {
    const rows = [{ week: 1, stats: { points: 20, mystery_stat: 4 } }]
    const { stats, unmappedKeys } = aggregateWeeklyStats(rows, normalizeNbaGameStats)
    expect(stats.pts).toBe(20)
    expect(unmappedKeys).toContain('mystery_stat')
  })

  it('does not count a game that produced no usable stats', () => {
    const rows = [{ week: 1, stats: { nothing_we_know: 5 } }]
    expect(aggregateWeeklyStats(rows, normalizeNbaGameStats).gamesCounted).toBe(0)
  })
})

describe('sport routing', () => {
  it('claims only the daily sports', () => {
    expect(isDailyStatSport('NBA')).toBe(true)
    expect(isDailyStatSport('nhl')).toBe(true)
    expect(isDailyStatSport('NFL')).toBe(false)
    expect(isDailyStatSport(null)).toBe(false)
  })

  it('returns an empty aggregate for a sport it does not handle', () => {
    const result = normalizeDailySportWeeklyStats('NFL', { logs: [{ week: 1, stats: { points: 10 } }] }, 1)
    expect(result).toEqual({ stats: {}, gamesCounted: 0, unmappedKeys: [] })
  })
})

describe('split rebounds are reconstructed', () => {
  it('sums offensive and defensive rebounds when no total is present', () => {
    const { stats, unmappedKeys } = normalizeNbaGameStats({ stats: { points: 12, oreb: 3, dreb: 6 } })
    expect(stats.reb).toBe(9)
    expect(unmappedKeys).not.toContain('oreb')
    expect(unmappedKeys).not.toContain('dreb')
  })

  it('prefers an explicit total over the halves', () => {
    const { stats } = normalizeNbaGameStats({ stats: { rebounds: 10, oreb: 3, dreb: 6 } })
    expect(stats.reb).toBe(10)
  })
})
