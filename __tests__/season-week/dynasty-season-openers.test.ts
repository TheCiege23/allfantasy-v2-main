/**
 * 🛑 A DYNASTY LEAGUE'S YEAR 2 HAD NO OPENER, SO IT NEVER ACTIVATED OR SCORED.
 *
 * `dailySportSeasonStarts.ts` hard-codes openers per sport/year (NBA/NHL 2026, MLB 2026-27). A
 * dynasty league rolls into `season + 1` every year, so NBA/NHL 2027 (the 2027-28 season) and MLB
 * 2028 resolved no anchor: the week roller held, the stat sync and finalizer declined. These tests
 * pin the fix: a season past the curated table derives its opener from games the stored schedule
 * LABELS regular season, the curated table still wins, and with no labelled schedule the opener is
 * only ever an ESTIMATE that is flagged and never used as a week anchor.
 *
 * No database: every client is a hand-built mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDerivedDailySportSeasonStarts,
  dailySportWeekForInstant,
  estimateDailySportSeasonStart,
  recordDerivedDailySportSeasonStart,
  resolveDailySportSeasonStart,
  resolveDailySportWeekWindow,
} from '@/lib/season-week/dailySportSeasonStarts'
import {
  ensureDailySportSeasonStart,
  resetDailySportSeasonStartChecks,
} from '@/lib/season-week/deriveDailySportSeasonStart'

type Row = { startTime: Date; seasonType: string | null }
const row = (iso: string, seasonType: string | null): Row => ({ startTime: new Date(iso), seasonType })

/** A client whose SportsGame table holds `rows`, filtered by the `startTime` range the deriver asks for. */
function dbWith(rows: Row[], cache?: Record<string, unknown>) {
  const findMany = vi.fn(async (args: any) => {
    const { gte, lt } = args.where.startTime
    return rows.filter((r) => r.startTime >= gte && r.startTime < lt)
  })
  const sportsDataCache = cache
    ? {
        findUnique: vi.fn(async ({ where }: any) => (where.cacheKey in cache ? { data: cache[where.cacheKey] } : null)),
        findMany: vi.fn(async ({ where }: any) =>
          (where.cacheKey.in as string[]).filter((k) => k in cache).map((cacheKey) => ({ cacheKey, data: cache[cacheKey] })),
        ),
      }
    : undefined
  return { db: { sportsGame: { findMany }, ...(sportsDataCache ? { sportsDataCache } : {}) } as never, findMany }
}

beforeEach(() => {
  clearDerivedDailySportSeasonStarts()
  resetDailySportSeasonStartChecks()
})
afterEach(() => vi.restoreAllMocks())

describe('the estimate (search-window centre, never an anchor)', () => {
  it.each([
    ['NBA', 2027, '2027-10-19'], // 2026-10-20 was a Tuesday → nearest Tuesday a year on
    ['NHL', 2027, '2027-09-28'], // 2026-09-29 Tuesday
    ['MLB', 2028, '2028-03-22'], // 2027-03-24 Wednesday
  ])('%s %i is estimated at %s, on the same weekday as the latest curated opener', (sport, season, day) => {
    const est = estimateDailySportSeasonStart(sport, season)!
    expect(est.slice(0, 10)).toBe(day)
    const latest = resolveDailySportSeasonStart(sport, sport === 'MLB' ? 2027 : 2026)!
    expect(new Date(est).getUTCDay()).toBe(new Date(latest).getUTCDay())
  })

  it('does not estimate soccer, curated years, earlier years, or sports with no curated opener', () => {
    expect(estimateDailySportSeasonStart('SOCCER', 2027)).toBeNull()
    expect(estimateDailySportSeasonStart('NBA', 2026)).toBeNull()
    expect(estimateDailySportSeasonStart('NBA', 2025)).toBeNull()
    expect(estimateDailySportSeasonStart('NFL', 2027)).toBeNull()
  })
})

describe('a season past the curated table derives its opener from the labelled schedule', () => {
  it('NBA 2027: the earliest game labelled regular, ignoring unlabelled preseason rows', async () => {
    const { db } = dbWith([
      row('2027-10-05T23:00:00Z', null), // preseason — unlabelled, must not count
      row('2027-10-12T23:00:00Z', 'pre'),
      row('2027-10-26T23:30:00Z', 'regular'), // 7:30pm Eastern on the 26th
      row('2027-10-27T23:30:00Z', 'regular'),
    ])
    // Before priming, a synchronous reader declines exactly as it always has.
    expect(resolveDailySportSeasonStart('NBA', 2027)).toBeNull()

    const res = await ensureDailySportSeasonStart('NBA', 2027, { db })
    expect(res).toMatchObject({ source: 'schedule', estimated: false, opener: '2027-10-26T00:00:00.000Z' })

    // Every synchronous reader now sees it — this is what lets the roller and scorer run.
    expect(resolveDailySportSeasonStart('NBA', 2027)).toBe('2027-10-26T00:00:00.000Z')
    expect(resolveDailySportWeekWindow('NBA', 2027, 1)?.start.toISOString()).toBe('2027-10-26T00:00:00.000Z')
    expect(dailySportWeekForInstant('NBA', 2027, new Date('2027-10-27T02:00:00Z'))).toBe(1)
    expect(dailySportWeekForInstant('NBA', 2027, new Date('2027-10-12T23:00:00Z'))).toBeNull() // preseason
  })

  it('NHL 2027: a game late on an Eastern evening anchors on its Eastern day, not the UTC one', async () => {
    const { db } = dbWith([
      row('2027-09-20T23:00:00Z', null),
      row('2027-10-06T00:00:00Z', 'Regular Season'), // 8pm Eastern on 5 October
    ])
    const res = await ensureDailySportSeasonStart('NHL', 2027, { db })
    expect(res.opener).toBe('2027-10-05T00:00:00.000Z')
    expect(resolveDailySportWeekWindow('NHL', 2027, 2)?.start.toISOString()).toBe('2027-10-12T00:00:00.000Z')
  })

  it('MLB 2028: from the Rolling Insights season schedule cached in Postgres', async () => {
    const prefix = 'MLB:rischedule:2028:'
    const { db } = dbWith([], {
      [`${prefix}meta`]: { syncedAt: '2028-02-01T00:00:00Z' },
      [`${prefix}2028-03-15`]: { games: [{ gameId: 'st', day: '2028-03-15', seasonType: 'pre', replacedBy: null }] },
      [`${prefix}2028-03-23`]: { games: [{ gameId: 'op', day: '2028-03-23', seasonType: 'regular', replacedBy: null }] },
      [`${prefix}2028-03-24`]: { games: [{ gameId: 'd2', day: '2028-03-24', seasonType: 'regular', replacedBy: null }] },
    })
    const res = await ensureDailySportSeasonStart('MLB', 2028, { db })
    expect(res).toMatchObject({ source: 'schedule', opener: '2028-03-23T00:00:00.000Z' })
    expect(resolveDailySportWeekWindow('MLB', 2028, 1)?.start.toISOString()).toBe('2028-03-23T00:00:00.000Z')
  })

  it('with no labelled schedule, returns a FLAGGED estimate and leaves the anchor null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db } = dbWith([row('2027-10-05T23:00:00Z', null)]) // only unlabelled rows
    const res = await ensureDailySportSeasonStart('NBA', 2027, { db })
    expect(res).toMatchObject({ source: 'estimate', estimated: true, opener: '2027-10-19T00:00:00.000Z' })
    // The estimate must never become a week anchor.
    expect(resolveDailySportSeasonStart('NBA', 2027)).toBeNull()
    expect(resolveDailySportWeekWindow('NBA', 2027, 1)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/ESTIMATED opener 2027-10-19/)
  })

  it('MLB 2028 with nothing stored yet is an estimate too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await ensureDailySportSeasonStart('MLB', 2028, { db: dbWith([]).db })
    expect(res).toMatchObject({ source: 'estimate', estimated: true, opener: '2028-03-22T00:00:00.000Z' })
  })

  it('a failed read is "cannot tell", not "no games"', async () => {
    const db = { sportsGame: { findMany: vi.fn(async () => { throw new Error('db down') }) } } as never
    const res = await ensureDailySportSeasonStart('NHL', 2027, { db })
    expect(res).toMatchObject({ source: 'unknown', opener: null })
  })
})

describe('the curated table still wins', () => {
  it('a curated season never reads the database', async () => {
    const { db, findMany } = dbWith([row('2026-10-01T23:00:00Z', 'regular')])
    const res = await ensureDailySportSeasonStart('NBA', 2026, { db })
    expect(res).toMatchObject({ source: 'curated', opener: '2026-10-20T00:00:00.000Z' })
    expect(findMany).not.toHaveBeenCalled()
  })

  it('a derived opener cannot be recorded over a curated one, nor for soccer or NFL', () => {
    recordDerivedDailySportSeasonStart('NBA', 2026, '2026-10-01T00:00:00.000Z')
    recordDerivedDailySportSeasonStart('SOCCER', 2027, '2027-08-13T00:00:00.000Z')
    recordDerivedDailySportSeasonStart('NFL', 2027, '2027-09-09T00:00:00.000Z')
    expect(resolveDailySportSeasonStart('NBA', 2026)).toBe('2026-10-20T00:00:00.000Z')
    expect(resolveDailySportSeasonStart('SOCCER', 2027)).toBeNull()
    expect(resolveDailySportSeasonStart('NFL', 2027)).toBeNull()
  })
})

describe('the week roller resolves a year-2 dynasty season', () => {
  it('resolveSportWeek NBA 2027 is no longer NO_WEEK_SIGNAL once the schedule labels the opener', async () => {
    const { resolveSportWeek } = await import('@/lib/season-week/seasonWeekService')
    const rows = [
      { week: 0, seasonType: 'regular', startTime: new Date('2027-10-26T23:30:00Z'), status: 'final', source: 'rolling_insights', fetchedAt: new Date('2027-10-27T05:00:00Z') },
      { week: 0, seasonType: 'regular', startTime: new Date('2027-10-27T23:30:00Z'), status: 'final', source: 'rolling_insights', fetchedAt: new Date('2027-10-28T05:00:00Z') },
    ]
    const prisma = {
      sportsGame: {
        findMany: vi.fn(async (args: any) =>
          rows.filter((r) => r.startTime >= args.where.startTime.gte && r.startTime < (args.where.startTime.lt ?? args.where.startTime.lte ?? new Date(8.64e15))),
        ),
      },
    } as never
    const resolved = await resolveSportWeek('NBA', 2027, { prisma, now: new Date('2027-10-28T12:00:00Z') })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.sportWeek).toBe(1)
  })
})
