/**
 * Week resolution for the DAILY sports (NBA, NHL).
 *
 * These sports carry no usable week in their feed — NBA writes 0, NHL writes
 * 500 — so `sportWeekSignal` excluded them and `resolveSportWeek` returned
 * `NO_WEEK_SIGNAL`. That made the scheduled reconciliation in
 * `/api/redraft/score-sync` skip every NBA/NHL season at `skippedUnresolvedWeek`,
 * before the stat sync was ever called: stats ingested fine and nothing scored,
 * with nothing red anywhere.
 *
 * The week is now derived from the recorded regular-season opener and the rows
 * go through the SAME slate machinery as the week-signal sports.
 */
import { describe, expect, it } from 'vitest'
import { relabelDailySportWeeks, resolveSportWeekFromSchedule } from '@/lib/season-week/sportWeekSignal'
import { resolveDailySportSeasonStart } from '@/lib/season-week/dailySportSeasonStarts'
import type { ScheduleRow } from '@/lib/season-week/types'

const NHL_OPENER = new Date(resolveDailySportSeasonStart('NHL', 2026)!)

function game(startTime: string, extra: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    // The feed's own week is deliberately garbage here — 500 is what NHL
    // actually writes. Nothing downstream may depend on it.
    week: 500,
    seasonType: null,
    startTime: new Date(startTime),
    status: 'final',
    source: 'rolling_insights',
    fetchedAt: new Date(startTime),
    ...extra,
  } as ScheduleRow
}

describe('daily-sport weeks are derived from the opener, not the feed', () => {
  it('ignores the feed week entirely', () => {
    const rows = [game('2026-09-29T23:00:00Z'), game('2026-10-01T23:00:00Z')]
    const out = relabelDailySportWeeks(rows, NHL_OPENER)
    expect(out.every((r) => r.week !== 500)).toBe(true)
    expect(out.map((r) => r.week)).toEqual([1, 1])
  })

  it('numbers weeks from the opener in seven-day blocks', () => {
    const rows = [
      game('2026-09-29T23:00:00Z'), // opening night -> week 1
      game('2026-10-05T23:00:00Z'), // still inside the first 7 days
      game('2026-10-06T00:00:00Z'), // exactly 7 days on -> week 2
      game('2026-10-20T23:00:00Z'), // -> week 4
    ]
    expect(relabelDailySportWeeks(rows, NHL_OPENER).map((r) => r.week)).toEqual([1, 1, 2, 4])
  })

  // The property that replaces a seasonType filter: SportsGame.seasonType is
  // NULL on every NBA/NHL row, so the anchor is the only thing separating
  // preseason from regular season.
  it('drops preseason games instead of scoring them', () => {
    const rows = [
      game('2026-09-19T23:00:00Z'), // NHL preseason
      game('2026-09-26T23:00:00Z'), // NHL preseason
      game('2026-09-29T23:00:00Z'), // opening night
    ]
    const out = relabelDailySportWeeks(rows, NHL_OPENER)
    expect(out).toHaveLength(1)
    expect(out[0].week).toBe(1)
  })

  it('asserts regular season on what survives, replacing the feed null', () => {
    const out = relabelDailySportWeeks([game('2026-10-01T23:00:00Z')], NHL_OPENER)
    expect(out[0].seasonType).toBe('regular')
  })

  it('skips rows with an unusable kickoff rather than guessing', () => {
    const bad = { ...game('2026-10-01T23:00:00Z'), startTime: new Date('nonsense') } as ScheduleRow
    expect(relabelDailySportWeeks([bad], NHL_OPENER)).toHaveLength(0)
  })
})

describe('relabelled rows resolve through the normal slate machinery', () => {
  it('produces a real resolution instead of NO_WEEK_SIGNAL', () => {
    const rows = [
      game('2026-09-29T23:00:00Z'),
      game('2026-09-30T23:00:00Z'),
      game('2026-10-01T23:00:00Z'),
    ]
    const now = new Date('2026-10-02T12:00:00Z')
    const resolved = resolveSportWeekFromSchedule(relabelDailySportWeeks(rows, NHL_OPENER), now)

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.sportWeek).toBe(1)
    expect(resolved.seasonType).toBe('regular')
    // Every game final and the last kickoff passed -> the week is over.
    expect(resolved.state).toBe('played')
    expect(resolved.slate.gameCount).toBe(3)
  })

  // Weeks must stay inside MAX_PLAUSIBLE_SPORT_WEEK (60) or the plausibility
  // backstop rejects them — an 82-game NBA season spans ~26 weeks, so the
  // arithmetic has to hold across a whole season.
  it('keeps a full season inside the plausibility ceiling', () => {
    const nba = new Date(resolveDailySportSeasonStart('NBA', 2026)!)
    const lastGame = game('2027-04-04T23:30:00Z') // real end of the NBA schedule
    const [out] = relabelDailySportWeeks([lastGame], nba)
    expect(out.week).toBeGreaterThan(20)
    expect(out.week).toBeLessThanOrEqual(60)
  })

  it('still declines when there are no games at all', () => {
    expect(resolveSportWeekFromSchedule(relabelDailySportWeeks([], NHL_OPENER), new Date()))
      .toEqual({ ok: false, reason: 'NO_SCHEDULE_ROWS' })
  })
})

/**
 * The tests above exercise the helper. This one proves the BEHAVIOUR CHANGE at
 * the gate: `resolveSportWeek` used to return `NO_WEEK_SIGNAL` for NHL/NBA
 * before touching the database, which is what made the scheduled sweep skip
 * them. `SeasonWeekDeps` takes an injected prisma, so no module mock is needed.
 */
describe('resolveSportWeek no longer refuses the daily sports', () => {
  const fakeDb = (rows: unknown[]) => ({
    sportsGame: { findMany: async () => rows },
  }) as never

  it('resolves NHL instead of returning NO_WEEK_SIGNAL', async () => {
    const { resolveSportWeek } = await import('@/lib/season-week/seasonWeekService')
    const resolved = await resolveSportWeek('NHL', 2026, {
      prisma: fakeDb([
        game('2026-09-29T23:00:00Z'),
        game('2026-09-30T23:00:00Z'),
      ]),
      now: new Date('2026-10-01T12:00:00Z'),
    })

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.sportWeek).toBe(1)
    expect(resolved.seasonType).toBe('regular')
  })

  it('resolves NBA too', async () => {
    const { resolveSportWeek } = await import('@/lib/season-week/seasonWeekService')
    const resolved = await resolveSportWeek('NBA', 2026, {
      prisma: fakeDb([game('2026-10-20T23:00:00Z')]),
      now: new Date('2026-10-21T12:00:00Z'),
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.sportWeek).toBe(1)
  })

  // The decline must survive for a sport with neither a feed week nor an
  // anchor — widening the gate must not become "resolve everything".
  it('still returns NO_WEEK_SIGNAL for a sport with no anchor', async () => {
    const { resolveSportWeek } = await import('@/lib/season-week/seasonWeekService')
    const resolved = await resolveSportWeek('MLB', 2026, {
      prisma: fakeDb([game('2026-05-01T23:00:00Z')]),
      now: new Date('2026-05-02T12:00:00Z'),
    })
    expect(resolved).toEqual({ ok: false, reason: 'NO_WEEK_SIGNAL' })
  })

  // An unrecorded season must decline rather than borrow a nearby year's opener.
  it('declines NHL for a season with no recorded opener', async () => {
    const { resolveSportWeek } = await import('@/lib/season-week/seasonWeekService')
    const resolved = await resolveSportWeek('NHL', 2031, {
      prisma: fakeDb([game('2031-10-01T23:00:00Z')]),
      now: new Date('2031-10-02T12:00:00Z'),
    })
    expect(resolved).toEqual({ ok: false, reason: 'NO_WEEK_SIGNAL' })
  })
})
