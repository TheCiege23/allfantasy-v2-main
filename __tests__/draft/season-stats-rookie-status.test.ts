/**
 * MLB / NBA / NHL rookie verdicts from our own stored season stats (docs/DYNASTY_PROSPECT_DATA_PLAN.md
 * §2.5, §4.3). Each verdict is `rookie`, `not_rookie` or `unknown` — never a guess.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  loadSeasonStatsRookieVerdicts,
  mlbRookieVerdict,
  nbaRookieVerdict,
  nhlRookieVerdict,
  parseInningsPitched,
  rollingInsightsIdOfPoolRow,
} from '@/lib/draft-room/seasonStatsRookieStatus'

/** Rows shaped as the Rolling Insights mirror writes them (`flattenRiSeasonStats`). */
const hitter = (season: number, ab: number | string | null, gp = 40) => ({
  season: String(season),
  gamesPlayed: gp,
  stats: { games_played: gp, 'batting.AB': ab, 'batting.H': 10 },
})
const pitcher = (season: number, ip: string | number | null, gp = 10) => ({
  season: String(season),
  gamesPlayed: gp,
  stats: { games_played: gp, 'pitching.IP': ip, 'pitching.K': 20 },
})
const seasons = (from: number, to: number) => new Set(Array.from({ length: to - from + 1 }, (_, i) => from + i))

describe('parseInningsPitched', () => {
  it('reads baseball notation: .1 is a third of an inning, .2 two thirds', () => {
    expect(parseInningsPitched('33.1')).toBeCloseTo(33 + 1 / 3)
    expect(parseInningsPitched('50.2')).toBeCloseTo(50 + 2 / 3)
    expect(parseInningsPitched(50)).toBe(50)
    expect(parseInningsPitched('12.0')).toBe(12)
  })

  it('refuses anything that is not baseball notation rather than rounding it', () => {
    expect(parseInningsPitched('33.5')).toBeNull()
    expect(parseInningsPitched('abc')).toBeNull()
    expect(parseInningsPitched('')).toBeNull()
    expect(parseInningsPitched(null)).toBeNull()
  })
})

describe('MLB: official rookie limits (130 AB, 50 IP) over prior major-league seasons', () => {
  const full = seasons(2000, 2026)

  it('is not a rookie once prior at-bats pass 130 — even split across seasons', () => {
    expect(mlbRookieVerdict({ rows: [hitter(2025, 70), hitter(2026, 61)], season: 2027, coveredSeasons: full, age: 25 })).toBe('not_rookie')
    expect(mlbRookieVerdict({ rows: [hitter(2025, 70), hitter(2026, 60)], season: 2027, coveredSeasons: full, age: 25 })).toBe('rookie')
  })

  it('is not a rookie once prior innings pass 50, reading "50.1" as 50⅓', () => {
    expect(mlbRookieVerdict({ rows: [pitcher(2026, '50.1')], season: 2027, coveredSeasons: full, age: 25 })).toBe('not_rookie')
    expect(mlbRookieVerdict({ rows: [pitcher(2026, '50.0')], season: 2027, coveredSeasons: full, age: 25 })).toBe('rookie')
  })

  it('does not count the season being drafted for, or later ones', () => {
    expect(mlbRookieVerdict({ rows: [hitter(2027, 400), hitter(2028, 500)], season: 2027, coveredSeasons: full, age: 23 })).toBe('rookie')
  })

  it('proves "not a rookie" from partial history, but never "rookie"', () => {
    // Only 2026 is stored: 400 AB is enough to prove a veteran ...
    expect(mlbRookieVerdict({ rows: [hitter(2026, 400)], season: 2027, coveredSeasons: new Set([2026]), age: 27 })).toBe('not_rookie')
    // ... but 20 AB in the one stored season says nothing about 2019-2025.
    expect(mlbRookieVerdict({ rows: [hitter(2026, 20)], season: 2027, coveredSeasons: new Set([2026]), age: 27 })).toBe('unknown')
  })

  it('treats no prior rows as a rookie only when every season he could have played is stored', () => {
    // Age 22 in 2027: could have played from 2021 (turned 16 in 2021 under the slack window).
    expect(mlbRookieVerdict({ rows: [], season: 2027, coveredSeasons: seasons(2021, 2026), age: 22 })).toBe('rookie')
    expect(mlbRookieVerdict({ rows: [], season: 2027, coveredSeasons: seasons(2022, 2026), age: 22 })).toBe('unknown')
    expect(mlbRookieVerdict({ rows: [], season: 2027, coveredSeasons: full, age: null })).toBe('unknown')
  })

  it('answers unknown when a prior row cannot be read', () => {
    expect(mlbRookieVerdict({ rows: [hitter(2026, null)], season: 2027, coveredSeasons: full, age: 25 })).toBe('unknown')
    expect(mlbRookieVerdict({ rows: [pitcher(2026, '7.4')], season: 2027, coveredSeasons: full, age: 25 })).toBe('unknown')
    // No batting or pitching group at all: not an MLB line we understand.
    expect(
      mlbRookieVerdict({ rows: [{ season: '2026', stats: { 'At Bats': '20' } }], season: 2027, coveredSeasons: full, age: 25 }),
    ).toBe('unknown')
  })

  it('a two-way line counts both groups; a missing group counts as zero', () => {
    const twoWay = { season: '2026', stats: { 'batting.AB': 100, 'pitching.IP': '20.0' } }
    expect(mlbRookieVerdict({ rows: [twoWay], season: 2027, coveredSeasons: full, age: 25 })).toBe('rookie')
    expect(mlbRookieVerdict({ rows: [twoWay, pitcher(2025, '31.0')], season: 2027, coveredSeasons: full, age: 25 })).toBe('not_rookie')
  })
})

describe('NBA: any prior regular-season games proves not a rookie; nothing proves rookie', () => {
  it('reads the gamesPlayed column or the RI `games_played` key', () => {
    expect(nbaRookieVerdict({ rows: [{ season: '2025', gamesPlayed: 3, stats: {} }], season: 2026 })).toBe('not_rookie')
    expect(nbaRookieVerdict({ rows: [{ season: '2025', gamesPlayed: null, stats: { games_played: 1 } }], season: 2026 })).toBe('not_rookie')
  })

  it('stays unknown for no prior games, a zero-games prior row, or only the current season', () => {
    expect(nbaRookieVerdict({ rows: [], season: 2026 })).toBe('unknown')
    expect(nbaRookieVerdict({ rows: [{ season: '2025', gamesPlayed: 0, stats: {} }], season: 2026 })).toBe('unknown')
    expect(nbaRookieVerdict({ rows: [{ season: '2026', gamesPlayed: 60, stats: {} }], season: 2026 })).toBe('unknown')
  })
})

describe('NHL: more than 25 prior regular-season games proves not a rookie', () => {
  it('sums prior seasons', () => {
    expect(nhlRookieVerdict({ rows: [{ season: '2024', gamesPlayed: 13, stats: {} }, { season: '2025', gamesPlayed: 13, stats: {} }], season: 2026 })).toBe('not_rookie')
    expect(nhlRookieVerdict({ rows: [{ season: '2025', gamesPlayed: 25, stats: {} }], season: 2026 })).toBe('unknown')
    expect(nhlRookieVerdict({ rows: [{ season: '2026', gamesPlayed: 82, stats: {} }], season: 2026 })).toBe('unknown')
  })
})

describe('rollingInsightsIdOfPoolRow', () => {
  it('returns the id only for a Rolling Insights row with no Sleeper id', () => {
    expect(rollingInsightsIdOfPoolRow({ external_source_id: '12345', metadata: { source: 'rolling_insights' } })).toBe('12345')
    // A TheSportsDB or Sleeper number is a different numbering — reading it would give a stranger's seasons.
    expect(rollingInsightsIdOfPoolRow({ external_source_id: '12345', metadata: { source: 'thesportsdb' } })).toBeNull()
    expect(rollingInsightsIdOfPoolRow({ external_source_id: '12345', sleeper_id: '12345', metadata: { source: 'rolling_insights' } })).toBeNull()
    expect(rollingInsightsIdOfPoolRow({ external_source_id: 'tsdb_99', metadata: { source: 'rolling_insights' } })).toBeNull()
    expect(rollingInsightsIdOfPoolRow(undefined)).toBeNull()
  })
})

describe('loadSeasonStatsRookieVerdicts (DB-first)', () => {
  it('reads only regular-season Rolling Insights rows, and answers unknown for ids with none', async () => {
    const findMany = vi.fn(async (args: { where: Record<string, unknown>; distinct?: string[] }) => {
      if (args.distinct) return [{ season: '2025' }, { season: '2026' }, { season: '2025-2026' }]
      return [
        { playerId: '1', season: '2025', gamesPlayed: 70, stats: { games_played: 70 } },
        { playerId: '2', season: '2026', gamesPlayed: 10, stats: { games_played: 10 } },
      ]
    })
    const verdicts = await loadSeasonStatsRookieVerdicts({ playerSeasonStats: { findMany } } as never, {
      sport: 'NBA',
      season: 2026,
      players: [{ riId: '1' }, { riId: '2' }, { riId: '3' }, { riId: '1' }],
    })
    expect(Object.fromEntries(verdicts)).toEqual({ 1: 'not_rookie', 2: 'unknown', 3: 'unknown' })
    expect(findMany).toHaveBeenCalledTimes(1) // the covered-seasons read is MLB only
    expect(findMany.mock.calls[0]![0].where).toMatchObject({
      sport: 'NBA',
      source: 'rolling_insights',
      seasonType: 'regular',
      playerId: { in: ['1', '2', '3'] },
    })
  })

  it('MLB reads which seasons are stored, ignoring labels that are not a year', async () => {
    const findMany = vi.fn(async (args: { distinct?: string[] }) =>
      args.distinct
        ? Array.from({ length: 12 }, (_, i) => ({ season: String(2015 + i) })).concat([{ season: '2014-2015' }])
        : [],
    )
    const verdicts = await loadSeasonStatsRookieVerdicts({ playerSeasonStats: { findMany } } as never, {
      sport: 'MLB',
      season: 2027,
      players: [{ riId: '7', age: 22 }, { riId: '8', age: 30 }],
    })
    // Age 22 needs 2021-2026, all stored; age 30 needs 2013-2026 and 2013/2014 are not.
    expect(verdicts.get('7')).toBe('rookie')
    expect(verdicts.get('8')).toBe('unknown')
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it('does not query at all for a pool with no Rolling Insights ids', async () => {
    const findMany = vi.fn()
    expect((await loadSeasonStatsRookieVerdicts({ playerSeasonStats: { findMany } } as never, { sport: 'NHL', season: 2026, players: [] })).size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})
