/**
 * Games limits (lib/redraft/gamesLimits.ts): games-played caps, the NHL goalie minimum and MLB innings
 * limits — the pure rules. The scoring integration is games-limits-scoring.test.ts.
 *
 * The rule pinned throughout: the DAY that reaches a limit counts in full; every later day scores 0 for it.
 */
import { describe, expect, it } from 'vitest'

import { applyGamesLimits, parseGamesLimits, readGamesLimits, type LimitLedgerEntry } from '@/lib/redraft/gamesLimits'

const e = (day: string, slot: string, stats: Record<string, number>, gamesPlayed = 1, positions = [slot], playerId = 'p'): LimitLedgerEntry => ({
  day,
  playerId,
  slot,
  positions,
  gamesPlayed,
  stats,
})

describe('parseGamesLimits — validation', () => {
  it('null, {} and all-blank values mean off', () => {
    expect(parseGamesLimits(null, 'NBA', {})).toEqual({ ok: true, value: null })
    expect(parseGamesLimits({}, 'NBA', {})).toEqual({ ok: true, value: null })
    expect(parseGamesLimits({ gamesPlayedCaps: { PG: '' } }, 'NBA', {})).toEqual({ ok: true, value: null })
  })

  it('accepts per-slot caps for NBA, normalizing the slot token', () => {
    expect(parseGamesLimits({ gamesPlayedCaps: { pg: 82, UTIL: '82' } }, 'NBA', {})).toEqual({
      ok: true,
      value: { gamesPlayedCaps: { PG: 82, UTIL: 82 } },
    })
  })

  it.each([
    [{ gamesPlayedCaps: { PG: 82 } }, 'NFL', /NBA, NHL and MLB/],
    [{ gamesPlayedCaps: { QB: 82 } }, 'NBA', /does not start: QB/],
    [{ gamesPlayedCaps: { PG: 0 } }, 'NBA', /1 to 200/],
    [{ gamesPlayedCaps: { PG: 82.5 } }, 'NBA', /1 to 200/],
    [{ gamesPlayedCaps: { PG: 201 } }, 'NBA', /1 to 200/],
    [{ gamesPlayedCaps: [82] }, 'NBA', /object of slot/],
    [{ goalieMinStarts: 3 }, 'NBA', /NHL leagues only/],
    [{ goalieMinStarts: 8 }, 'NHL', /1 to 7/],
    [{ inningsMin: 20 }, 'NHL', /MLB leagues only/],
    [{ inningsMax: -1 }, 'MLB', /1 to 200/],
    [{ inningsMin: 50, inningsMax: 40 }, 'MLB', /cannot be greater/],
    [{ gamesCap: 82 }, 'NBA', /Unknown gamesLimits setting/],
    ['82', 'NBA', /must be an object/],
  ])('refuses %j for %s', (raw, sport, error) => {
    const r = parseGamesLimits(raw, sport, {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(error)
  })

  it('readGamesLimits is lenient: a stored value that no longer validates reads as off', () => {
    expect(readGamesLimits({ games_limits: { goalieMinStarts: 3 } }, 'NBA')).toBeNull()
    expect(readGamesLimits({ games_limits: { goalieMinStarts: 3 } }, 'NHL')).toEqual({ goalieMinStarts: 3 })
    expect(readGamesLimits({}, 'NHL')).toBeNull()
  })
})

describe('games-played caps', () => {
  const seats = new Map([['PG', 1], ['G', 2]])

  it('the day that reaches the cap counts in full; later days in that slot score 0', () => {
    // Cap 3. Two games used before this week. Monday: a doubleheader-style 2-game day takes it to 4 —
    // all of it counts. Tuesday: already at the cap, zeroed.
    const week = [e('2026-11-02', 'PG', { pts: 30 }, 2), e('2026-11-03', 'PG', { pts: 25 })]
    const prior = [e('2026-10-20', 'PG', { pts: 10 }), e('2026-10-22', 'PG', { pts: 10 })]
    const r = applyGamesLimits({ sport: 'NBA', limits: { gamesPlayedCaps: { PG: 3 } }, scoringMode: 'points', seats, prior, week })
    expect(r.stats[0]).toBe(week[0].stats)
    expect(r.stats[1]).toEqual({})
    expect(r.summary.caps).toEqual([{ slot: 'PG', used: 4, cap: 3 }])
  })

  it('a cap is per seat: two G seats with a cap of 2 allow 4 games', () => {
    const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((d) => e(d, 'G', { pts: 1 }))
    const r = applyGamesLimits({ sport: 'NBA', limits: { gamesPlayedCaps: { G: 2 } }, scoringMode: 'points', seats, prior: [], week })
    expect(r.stats.map((s) => s.pts ?? 0)).toEqual([1, 1, 1, 1, 0])
    expect(r.summary.caps).toEqual([{ slot: 'G', used: 4, cap: 4 }])
  })

  it('two players filling one slot on the same day both count when the slot starts the day under its cap', () => {
    const week = [e('2026-11-02', 'G', { pts: 5 }, 1, ['PG'], 'a'), e('2026-11-02', 'G', { pts: 7 }, 1, ['SG'], 'b')]
    const prior = [e('2026-10-20', 'G', {}, 3)]
    const r = applyGamesLimits({ sport: 'NBA', limits: { gamesPlayedCaps: { G: 2 } }, scoringMode: 'points', seats, prior, week })
    expect(r.stats).toEqual([{ pts: 5 }, { pts: 7 }])
    expect(r.summary.caps?.[0].used).toBe(5)
  })

  it('an uncapped slot is untouched, and a zeroed day adds nothing to usage', () => {
    const prior = [e('2026-10-20', 'PG', {}, 3)]
    const week = [e('2026-11-02', 'PG', { pts: 9 }), e('2026-11-02', 'C', { pts: 4 }, 1, ['C'], 'c')]
    const r = applyGamesLimits({ sport: 'NBA', limits: { gamesPlayedCaps: { PG: 3 } }, scoringMode: 'points', seats, prior, week })
    expect(r.stats).toEqual([{}, { pts: 4 }])
    expect(r.summary.caps).toEqual([{ slot: 'PG', used: 3, cap: 3 }])
  })
})

describe('MLB innings limits', () => {
  const day1 = e('2026-04-06', 'SP', { ip: 10, outs: 30, so: 12, er: 2, w: 1 })
  const day2 = e('2026-04-07', 'SP', { ip: 5, outs: 15, so: 6, er: 1 })
  // A two-way player on day 3: his batting must survive the innings max.
  const day3 = e('2026-04-08', 'UTIL', { hr: 1, r: 1, ip: 6, outs: 18, so: 7 })

  it('max: the day that reaches it counts in full; pitching on later days does not, batting does', () => {
    const r = applyGamesLimits({ sport: 'MLB', limits: { inningsMax: 12 }, scoringMode: 'points', seats: new Map(), prior: [], week: [day1, day2, day3] })
    expect(r.stats[0]).toBe(day1.stats) // 30 outs < 36
    expect(r.stats[1]).toBe(day2.stats) // starts the day at 30 < 36 → all 15 count (45)
    expect(r.stats[2]).toEqual({ hr: 1, r: 1 })
    expect(r.summary.innings).toEqual({ outs: 45, maxOuts: 36, maxReached: true })
  })

  it('min not met, points league: every pitching stat scores 0 that week', () => {
    const r = applyGamesLimits({ sport: 'MLB', limits: { inningsMin: 30 }, scoringMode: 'points', seats: new Map(), prior: [], week: [day1, day3] })
    expect(r.stats).toEqual([{}, { hr: 1, r: 1 }])
    expect(r.summary.innings).toEqual({ outs: 48, minOuts: 90, minMet: false })
  })

  it('min not met, category league: only ERA/WHIP inputs are voided; W and K still count', () => {
    const r = applyGamesLimits({ sport: 'MLB', limits: { inningsMin: 30 }, scoringMode: 'category', seats: new Map(), prior: [], week: [day1] })
    expect(r.stats[0]).toEqual({ so: 12, w: 1 })
  })

  it('min met: nothing changes', () => {
    const r = applyGamesLimits({ sport: 'MLB', limits: { inningsMin: 15 }, scoringMode: 'points', seats: new Map(), prior: [], week: [day1, day2] })
    expect(r.stats[0]).toBe(day1.stats)
    expect(r.stats[1]).toBe(day2.stats)
    expect(r.summary.innings?.minMet).toBe(true)
  })
})

describe('NHL goalie minimum', () => {
  const goalie = (day: string, stats: Record<string, number>) => e(day, 'G', stats, 1, ['G'], `g-${day}`)
  const skater = e('2026-10-08', 'C', { g: 1, a: 1 }, 1, ['C'], 'skater')

  it('below the minimum, the week\'s goalie stats score 0 and skaters are untouched', () => {
    const week = [goalie('2026-10-07', { g_win: 1, g_sv: 30 }), skater, goalie('2026-10-09', { g_sv: 20, g_ga: 4 })]
    const r = applyGamesLimits({ sport: 'NHL', limits: { goalieMinStarts: 3 }, scoringMode: 'points', seats: new Map(), prior: [], week })
    expect(r.stats).toEqual([{}, { g: 1, a: 1 }, {}])
    expect(r.stats[1]).toBe(skater.stats)
    expect(r.summary.goalieStarts).toEqual({ count: 2, min: 3, met: false })
  })

  it('at the minimum, nothing changes', () => {
    const week = [goalie('2026-10-07', { g_sv: 30 }), goalie('2026-10-09', { g_sv: 20 })]
    const r = applyGamesLimits({ sport: 'NHL', limits: { goalieMinStarts: 2 }, scoringMode: 'points', seats: new Map(), prior: [], week })
    expect(r.stats[0]).toBe(week[0].stats)
    expect(r.summary.goalieStarts).toEqual({ count: 2, min: 2, met: true })
  })

  it('a goalie day zeroed by a G cap does not count toward the minimum', () => {
    const week = [goalie('2026-10-07', { g_sv: 30 }), goalie('2026-10-09', { g_sv: 20 })]
    const r = applyGamesLimits({
      sport: 'NHL',
      limits: { goalieMinStarts: 2, gamesPlayedCaps: { G: 1 } },
      scoringMode: 'points',
      seats: new Map([['G', 1]]),
      prior: [],
      week,
    })
    expect(r.summary.goalieStarts).toEqual({ count: 1, min: 2, met: false })
    expect(r.stats).toEqual([{}, {}])
  })
})
