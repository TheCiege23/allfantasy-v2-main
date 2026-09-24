/**
 * NBA/NHL weekly stat normalization.
 *
 * Asserts that what we extract lands on keys the scoring engine can actually
 * score, that a week of several games is summed rather than sampled, and that
 * an unrecognised payload is loud instead of silently zero.
 *
 * ✅ The provider spellings are VERIFIED as of 36fcfe71f, which committed
 * `contracts/rolling-insights/fixtures/live.{NBA,NHL}.json` and resolved
 * GAPS.md `G-01`. The final describe block pins the real vendor keys; six of
 * them were wrong in the first version of the alias tables.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getSportConfig } from '@/lib/sportConfig'
import {
  aggregateWeeklyStats,
  collectCachedWeekRows,
  countDoubleDigitCategories,
  isDailyStatSport,
  normalizeDailySportWeeklyStats,
  normalizeNbaGameStats,
  normalizeNcaabGameStats,
  normalizeNhlGameStats,
  weekWindowFromSeasonStart,
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
    ['NCAAB', normalizeNcaabGameStats, { points: 27, total_rebounds: 8, assists: 4, steals: 0, blocks: 4, turnovers: 4, three_points_made: 1, field_goals_made: 10, free_throws_made: 6 }],
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

describe('NCAAB — against the committed /live fixture (the 2026 national final)', () => {
  const box = (JSON.parse(readFileSync(path.join(process.cwd(), 'contracts', 'rolling-insights', 'fixtures', 'live.NCAABB.json'), 'utf8')) as {
    data: { NCAABB: Array<{ player_box: Record<string, Record<string, Record<string, unknown>>> }> }
  }).data.NCAABB[0].player_box
  const players = [...Object.values(box.home_team), ...Object.values(box.away_team)]

  it('is a daily stat sport now', () => {
    expect(isDailyStatSport('NCAAB')).toBe(true)
  })

  it('scores every real box line, and reports NO key the vendor always sends', () => {
    for (const p of players) {
      const { stats, unmappedKeys } = normalizeNcaabGameStats({ stats: p })
      expect(stats.pts).toBe(p.points)
      expect(stats.reb).toBe(p.total_rebounds)
      // fouls, minutes, attempts…: known and deliberately unscored, so the "alias table may be
      // wrong" warning stays reserved for a key the vendor has never sent.
      expect(unmappedKeys).toEqual([])
    }
  })

  it('still reports a key it has never seen', () => {
    const { unmappedKeys } = normalizeNcaabGameStats({ stats: { points: 10, brand_new_vendor_stat: 3 } })
    expect(unmappedKeys).toEqual(['brand_new_vendor_stat'])
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

describe('a daily-sport week is a date window', () => {
  // `weekOrRound` is 0 on every daily-sport row in production, so the window is
  // the only selector that can work. NHL 2026-27 opener used as the anchor.
  const start = '2026-10-07T00:00:00.000Z'

  it('week 1 starts on the season start', () => {
    const w = weekWindowFromSeasonStart(start, 1)!
    expect(w.start.toISOString()).toBe('2026-10-07T00:00:00.000Z')
    expect(w.end.toISOString()).toBe('2026-10-14T00:00:00.000Z')
  })

  it('each later week is exactly seven days on', () => {
    const w3 = weekWindowFromSeasonStart(start, 3)!
    expect(w3.start.toISOString()).toBe('2026-10-21T00:00:00.000Z')
    expect(w3.end.toISOString()).toBe('2026-10-28T00:00:00.000Z')
  })

  it('windows are contiguous and non-overlapping', () => {
    for (let week = 1; week < 12; week += 1) {
      const a = weekWindowFromSeasonStart(start, week)!
      const b = weekWindowFromSeasonStart(start, week + 1)!
      expect(a.end.getTime()).toBe(b.start.getTime())
    }
  })

  // Preseason exclusion falls out of the anchor for free: NHL preseason games
  // are played in September, before a window anchored on the October opener.
  it('cannot contain a preseason game played before the season start', () => {
    const preseasonGame = new Date('2026-09-19T23:00:00.000Z')
    for (let week = 1; week <= 26; week += 1) {
      const w = weekWindowFromSeasonStart(start, week)!
      const inside = preseasonGame >= w.start && preseasonGame < w.end
      expect(inside).toBe(false)
    }
  })

  it('declines rather than inventing a start date', () => {
    expect(weekWindowFromSeasonStart(null, 1)).toBeNull()
    expect(weekWindowFromSeasonStart(undefined, 1)).toBeNull()
    expect(weekWindowFromSeasonStart('not a date', 1)).toBeNull()
    expect(weekWindowFromSeasonStart(start, 0)).toBeNull()
    expect(weekWindowFromSeasonStart(start, -3)).toBeNull()
  })
})

/**
 * Vendor spellings captured verbatim from the committed fixtures
 * `contracts/rolling-insights/fixtures/live.{NBA,NHL}.json` (landed in
 * 36fcfe71f, probed 2026-03-15, GAPS.md `G-01` RESOLVED).
 *
 * Six of these were WRONG in the first version of the alias tables, which is
 * why they are pinned individually rather than asserted in bulk: a bulk
 * "something mapped" assertion passes with half the categories missing.
 */
describe('real vendor keys from the committed /live fixtures', () => {
  const NBA_BOX = {
    assists: 11, blocks: 1, defensive_rebounds: 8, field_goals_attempted: 20,
    field_goals_made: 10, fouls: 2, free_throws_attempted: 7, free_throws_made: 6,
    minutes: 34, offensive_rebounds: 4, points: 30, steals: 2,
    three_points_attempted: 9, three_points_made: 4, total_rebounds: 12,
    turnovers: 3, two_points_attempted: 11, two_points_made: 6,
  }

  const NHL_SKATER = {
    assists: 1, blocks: 2, faceoffs_lost: 4, faceoffs_won: 6, giveaways: 1,
    goals: 2, hits: 4, penalty_minutes: 2, plus_minus: 3,
    power_play_assists: 1, power_play_goals: 1, shootout_goals: 0,
    short_handed_assists: 0, short_handed_goals: 1, shots_on_goal: 7, takeaways: 2,
  }

  const NHL_GOALIE = {
    goals_allowed: 2, loss: 0, overtime_loss: 0, saves: 30,
    shots_against: 32, shutouts: 0, win: 1,
  }

  it('maps every NBA category the config can score', () => {
    const { stats } = normalizeNbaGameStats(NBA_BOX)
    expect(stats).toMatchObject({
      pts: 30,
      reb: 12, // total_rebounds, NOT the oreb+dreb fallback
      ast: 11,
      stl: 2,
      blk: 1,
      to: 3,
      threes: 4, // three_points_made — the one-letter miss
      fgm: 10,
      ftm: 6,
    })
  })

  it('maps every NHL skater category, summing the special-teams halves', () => {
    const { stats } = normalizeNhlGameStats(NHL_SKATER)
    expect(stats).toMatchObject({
      g: 2,
      a: 1,
      plusminus: 3,
      sog: 7,
      blks: 2,
      hits: 4,
      pim: 2,
      ppp: 2, // power_play_goals 1 + power_play_assists 1
      shp: 1, // short_handed_goals 1 + short_handed_assists 0
    })
  })

  it('maps every NHL goalie category', () => {
    const { stats } = normalizeNhlGameStats(NHL_GOALIE)
    expect(stats).toMatchObject({
      g_win: 1, // "win", singular
      g_sv: 30,
      g_so: 0,
      g_ga: 2, // "goals_allowed", not goals_against
    })
  })

  // A category the feed genuinely does not carry must stay absent rather than
  // being invented as 0 — the scoring engine treats absent and zero alike, but
  // a fabricated 0 would hide a future mapping regression.
  it('leaves unmapped vendor extras out of stats but names them', () => {
    const { stats, unmappedKeys } = normalizeNbaGameStats(NBA_BOX)
    expect(stats).not.toHaveProperty('minutes')
    expect(unmappedKeys).toContain('minutes')
    expect(unmappedKeys).toContain('fouls')
  })
})
