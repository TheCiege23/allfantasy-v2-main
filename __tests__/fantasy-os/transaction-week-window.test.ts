/**
 * What a LIVE refresh asks Sleeper for, and what it must not — both week knobs.
 *
 * ⚠ THEY ARE DELIBERATELY DIFFERENT SHAPES AND THE TESTS PIN THAT. Transactions get a WINDOW
 * (week ±1) because a trade is an event and older ones are already stored. Matchups get a CAP
 * (1..current+1) because `bootstrapLeagueFromNormalizedImport` upserts TeamPerformance from every
 * week in the payload, so dropping a PAST week would freeze a real score with nothing behind it —
 * `SleeperHistoricalMatchupSyncService` has no scheduled caller. Swapping the two shapes would be
 * silently wrong in both directions.
 *
 * 🛑 THE FAILURE THIS FILE EXISTS TO CATCH IS SILENT IN BOTH DIRECTIONS. Fetching the wrong weeks
 * writes nothing and still reports a completed scope — indistinguishable from a quiet week — and
 * fetching all 18 costs six times what it needs to while looking perfectly correct. Neither shows
 * up in a row count, so the requests themselves are asserted rather than the outcome.
 *
 * The window is derived from a CALENDAR, so every test here pins its own clock. A test that reads
 * `new Date()` would pass today and fail in January, which dates rather than fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/sleeper-client', () => ({ getAllPlayers: vi.fn(async () => ({})) }))

import {
  nflWeekForDate,
  resolveTransactionWeekWindow,
  resolveMatchupWeekCap,
  MAX_TRANSACTION_WEEK,
  TRANSACTION_WEEK_MARGIN,
} from '@/lib/import-os/season'

const nfl = (now: Date) => resolveTransactionWeekWindow({ sport: 'nfl', provider: 'sleeper', now })

describe('nflWeekForDate — calendar weeks off the Sep 4 opener', () => {
  it('calls opening day week 1', () => {
    expect(nflWeekForDate(new Date('2026-09-04T12:00:00Z'))).toBe(1)
  })

  it('stays in week 1 for the first six days', () => {
    expect(nflWeekForDate(new Date('2026-09-10T23:59:00Z'))).toBe(1)
  })

  it('rolls to week 2 on the seventh day', () => {
    expect(nflWeekForDate(new Date('2026-09-11T00:00:00Z'))).toBe(2)
  })

  it('reads mid-season correctly (41 days in is week 6)', () => {
    expect(nflWeekForDate(new Date('2026-10-15T12:00:00Z'))).toBe(6)
  })

  /*
   * ⚠ THE SEGMENT WRAPS THE YEAR END, so January belongs to the season that began the PREVIOUS
   * September. Getting this wrong would compute a negative day count, clamp to week 1, and send a
   * January refresh looking for week 1 trades — the silent-miss case, in the one month where a
   * dynasty league's trade volume is climbing.
   */
  it('attributes January to the season that opened the previous September', () => {
    expect(nflWeekForDate(new Date('2027-01-03T12:00:00Z'))).toBe(18)
  })

  it('never exceeds the last week Sleeper serves', () => {
    expect(nflWeekForDate(new Date('2027-01-06T12:00:00Z'))).toBe(MAX_TRANSACTION_WEEK)
  })

  it('never returns a week below 1', () => {
    expect(nflWeekForDate(new Date('2026-09-01T12:00:00Z'))).toBe(1)
  })
})

describe('resolveTransactionWeekWindow — narrow where confident, refuse where not', () => {
  it('returns the week either side of the current one in the regular season', () => {
    expect(nfl(new Date('2026-10-15T12:00:00Z'))).toEqual([5, 6, 7])
  })

  it('clamps at the bottom rather than asking for week 0', () => {
    expect(nfl(new Date('2026-09-05T12:00:00Z'))).toEqual([1, 2])
  })

  it('clamps at the top rather than asking for week 19', () => {
    expect(nfl(new Date('2026-12-25T12:00:00Z'))).toEqual([16, 17, 18])
  })

  /*
   * ⚠ MEASURED, NOT ASSUMED. The first four rows the live writer ingested on production
   * (2026-09-05 13:32Z) carried `week = 1` with `tradeDate` 2026-08-30 and 08-31 — both BEFORE the
   * Sep 4 opener. Sleeper files a preseason trade under week 1, so preseason centres there.
   */
  it('centres preseason on week 1, where Sleeper files those trades', () => {
    expect(nfl(new Date('2026-08-15T12:00:00Z'))).toEqual([1, 2])
  })

  /*
   * 🛑 NULL IS THE ANSWER, NOT A MISSING ONE, AND COLLAPSING IT TO A DEFAULT WEEK WOULD LOSE
   * TRADES IN THE SEASON THAT TRADES MOST. The calendar cannot say which week Sleeper files an
   * offseason trade under, so the caller keeps the full sweep — affordable because the offseason
   * cadence is 4-hourly.
   */
  it('declines to guess in the offseason', () => {
    expect(nfl(new Date('2026-03-15T12:00:00Z'))).toBeNull()
  })

  it('declines to guess for a sport with no calendar', () => {
    expect(
      resolveTransactionWeekWindow({ sport: 'nba', provider: 'sleeper', now: new Date('2026-10-15T12:00:00Z') }),
    ).toBeNull()
  })

  it('declines to guess for an unrecognised provider', () => {
    expect(
      resolveTransactionWeekWindow({ sport: 'nfl', provider: 'not-a-provider', now: new Date('2026-10-15T12:00:00Z') }),
    ).toBeNull()
  })

  it('is always a contiguous, ascending, in-range run of weeks', () => {
    for (const iso of ['2026-09-05', '2026-10-15', '2026-11-20', '2026-12-25', '2027-01-03']) {
      const weeks = nfl(new Date(`${iso}T12:00:00Z`))
      expect(weeks).not.toBeNull()
      const w = weeks as number[]
      expect(w.length).toBeLessThanOrEqual(2 * TRANSACTION_WEEK_MARGIN + 1)
      expect(w[0]).toBeGreaterThanOrEqual(1)
      expect(w[w.length - 1]).toBeLessThanOrEqual(MAX_TRANSACTION_WEEK)
      expect([...w].sort((a, b) => a - b)).toEqual(w)
      w.forEach((week, i) => i > 0 && expect(week).toBe(w[i - 1] + 1))
    }
  })
})

/* ── the wiring, asserted on the REQUESTS rather than on the options object ───────────────── */

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const BASE = 'https://api.sleeper.app/v1'

/** Records every `/transactions/{week}` AND `/matchups/{week}` the fetcher actually asked for. */
function mockSleeper(): { weeks: () => number[]; matchupWeeks: () => number[] } {
  const asked: number[] = []
  const askedMatchups: number[] = []
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input)
    const tx = url.match(/\/transactions\/(\d+)$/)
    if (tx) {
      asked.push(Number(tx[1]))
      return jsonRes([])
    }
    const mu = url.match(/\/matchups\/(\d+)$/)
    if (mu) {
      askedMatchups.push(Number(mu[1]))
      return jsonRes([])
    }
    if (url === `${BASE}/league/L1`) {
      return jsonRes({ league_id: 'L1', season: '2026', previous_league_id: null })
    }
    return jsonRes([])
  }) as unknown as typeof fetch
  return {
    weeks: () => [...asked].sort((a, b) => a - b),
    matchupWeeks: () => [...askedMatchups].sort((a, b) => a - b),
  }
}

describe('fetchSleeperLeagueForImport honours an explicit transaction window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /*
   * 🛑 THE TEST THAT MATTERS. Everything above could be right while the option is dropped on the
   * floor between the collector and the HTTP call — the option existed for months and nothing
   * passed it. This asserts the wire.
   */
  it('requests exactly the weeks it was given, and no others', async () => {
    const m = mockSleeper()
    const { fetchSleeperLeagueForImport } = await import(
      '@/lib/league-import/sleeper/SleeperLeagueFetchService'
    )
    await fetchSleeperLeagueForImport('L1', {
      transactionWeeks: [5, 6, 7],
      maxMatchupWeeks: 1,
      maxPreviousSeasons: 0,
    })
    expect(m.weeks()).toEqual([5, 6, 7])
    expect(m.weeks()).not.toContain(1)
  }, 20000)

  it('is dramatically cheaper than the default sweep', async () => {
    const wide = mockSleeper()
    const { fetchSleeperLeagueForImport } = await import(
      '@/lib/league-import/sleeper/SleeperLeagueFetchService'
    )
    await fetchSleeperLeagueForImport('L1', { maxMatchupWeeks: 1, maxPreviousSeasons: 0 })
    expect(wide.weeks().length).toBe(18)

    const narrow = mockSleeper()
    await fetchSleeperLeagueForImport('L1', {
      transactionWeeks: [5, 6, 7],
      maxMatchupWeeks: 1,
      maxPreviousSeasons: 0,
    })
    expect(narrow.weeks().length).toBe(3)
  }, 20000)

  /*
   * ⚠ AN EMPTY WINDOW MUST NOT MEAN "FETCH NOTHING". A caller whose arithmetic produced [] has a
   * bug; fetching zero weeks would write zero trades and report a completed scope, hiding it
   * behind exactly the green run this whole subsystem keeps being bitten by.
   */
  it('falls back to the full sweep on an empty window rather than fetching nothing', async () => {
    const m = mockSleeper()
    const { fetchSleeperLeagueForImport } = await import(
      '@/lib/league-import/sleeper/SleeperLeagueFetchService'
    )
    await fetchSleeperLeagueForImport('L1', {
      transactionWeeks: [],
      maxMatchupWeeks: 1,
      maxPreviousSeasons: 0,
    })
    expect(m.weeks().length).toBe(18)
  }, 20000)

  it('drops out-of-range and non-integer weeks instead of requesting them', async () => {
    const m = mockSleeper()
    const { fetchSleeperLeagueForImport } = await import(
      '@/lib/league-import/sleeper/SleeperLeagueFetchService'
    )
    await fetchSleeperLeagueForImport('L1', {
      transactionWeeks: [0, 2, 2, 19, 4.5, Number.NaN, 3],
      maxMatchupWeeks: 1,
      maxPreviousSeasons: 0,
    })
    expect(m.weeks()).toEqual([2, 3])
  }, 20000)

  it('leaves the import path untouched when no window is given', async () => {
    const m = mockSleeper()
    const { fetchSleeperLeagueForImport } = await import(
      '@/lib/league-import/sleeper/SleeperLeagueFetchService'
    )
    await fetchSleeperLeagueForImport('L1', {
      maxTransactionWeeks: 4,
      maxMatchupWeeks: 1,
      maxPreviousSeasons: 0,
    })
    expect(m.weeks()).toEqual([1, 2, 3, 4])
  }, 20000)
})

/* ── the matchup CAP, which is deliberately a different shape from the window above ───────── */

describe('resolveMatchupWeekCap — keep every played week, drop the unplayed tail', () => {
  const cap = (now: Date) => resolveMatchupWeekCap({ sport: 'nfl', provider: 'sleeper', now })

  /*
   * 🛑 THE ASYMMETRY IS THE DESIGN. Transactions get a WINDOW because a trade is an event and last
   * month's are already stored. Matchups get a CAP because `bootstrapLeagueFromNormalizedImport`
   * upserts TeamPerformance from every week in the payload, and a past week dropped from the fetch
   * simply stops being refreshed — `SleeperHistoricalMatchupSyncService` has no scheduled caller.
   * A window would silently freeze real scores; "1..current+1" cannot.
   */
  it('keeps every week up to next week in the regular season', () => {
    expect(cap(new Date('2026-10-15T12:00:00Z'))).toBe(7) // week 6 + 1
  })

  it('asks for only two weeks in week 1, where 16 of 18 cannot hold a score', () => {
    expect(cap(new Date('2026-09-05T12:00:00Z'))).toBe(2)
  })

  it('centres preseason on week 1 like the transaction window does', () => {
    expect(cap(new Date('2026-08-15T12:00:00Z'))).toBe(2)
  })

  it('never exceeds the last week Sleeper serves', () => {
    expect(cap(new Date('2026-12-25T12:00:00Z'))).toBe(MAX_TRANSACTION_WEEK)
    expect(cap(new Date('2027-01-03T12:00:00Z'))).toBe(MAX_TRANSACTION_WEEK)
  })

  it('declines to cap in the offseason, so the full sweep is kept', () => {
    expect(cap(new Date('2026-03-15T12:00:00Z'))).toBeNull()
  })

  it('declines to cap for a sport with no calendar', () => {
    expect(
      resolveMatchupWeekCap({ sport: 'nba', provider: 'sleeper', now: new Date('2026-10-15T12:00:00Z') }),
    ).toBeNull()
  })

  /*
   * ⚠ THE PROPERTY THAT MATTERS MOST, ASSERTED ACROSS THE WHOLE SEASON RATHER THAN AT A POINT:
   * the cap never excludes a week that could already hold a score. If this ever fails, a real
   * TeamPerformance row stops being refreshed and nothing else refreshes it.
   */
  it('never drops a week that has already been played', () => {
    for (const iso of ['2026-09-05', '2026-10-15', '2026-11-20', '2026-12-25', '2027-01-03']) {
      const now = new Date(`${iso}T12:00:00Z`)
      const c = cap(now)
      expect(c).not.toBeNull()
      expect(c as number).toBeGreaterThanOrEqual(nflWeekForDate(now))
    }
  })
})

describe('fetchSleeperLeagueForImport honours the matchup cap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests only weeks 1..N of matchups, and keeps every earlier week', async () => {
    const m = mockSleeper()
    const { fetchSleeperLeagueForImport } = await import(
      '@/lib/league-import/sleeper/SleeperLeagueFetchService'
    )
    await fetchSleeperLeagueForImport('L1', {
      maxMatchupWeeks: 2,
      transactionWeeks: [1],
      maxPreviousSeasons: 0,
    })
    expect(m.matchupWeeks()).toEqual([1, 2])
  }, 20000)

  it('still sweeps all 18 matchup weeks when no cap is given (the import path)', async () => {
    const m = mockSleeper()
    const { fetchSleeperLeagueForImport } = await import(
      '@/lib/league-import/sleeper/SleeperLeagueFetchService'
    )
    await fetchSleeperLeagueForImport('L1', { transactionWeeks: [1], maxPreviousSeasons: 0 })
    expect(m.matchupWeeks().length).toBe(18)
  }, 20000)

  /* Both knobs are independent: capping matchups must not disturb the transaction window. */
  it('caps matchups without touching the transaction window', async () => {
    const m = mockSleeper()
    const { fetchSleeperLeagueForImport } = await import(
      '@/lib/league-import/sleeper/SleeperLeagueFetchService'
    )
    await fetchSleeperLeagueForImport('L1', {
      maxMatchupWeeks: 2,
      transactionWeeks: [5, 6, 7],
      maxPreviousSeasons: 0,
    })
    expect(m.matchupWeeks()).toEqual([1, 2])
    expect(m.weeks()).toEqual([5, 6, 7])
  }, 20000)
})
