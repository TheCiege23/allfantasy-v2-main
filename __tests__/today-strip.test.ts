import { describe, expect, it } from 'vitest'

import { currentSeasonOf, nextWeeklyRun } from '@/lib/core-app/todayStrip'

/**
 * The two pieces of real arithmetic behind the Dashboard v2 top strip.
 *
 * `nextWeeklyRun` turns a stored weekday + UTC hour into a genuine instant, and
 * that instant is what the client localises. Getting it wrong by a day is not a
 * cosmetic bug: a waiver row is something people set an alarm by.
 */
describe('nextWeeklyRun', () => {
  // Sunday = 0, matching both Date.getUTCDay() and the stored column.
  const TUESDAY = 2
  const WEDNESDAY = 3

  it('finds the slot later the same day', () => {
    // Tuesday 08:00 UTC, looking for Tuesday 10:00 UTC.
    const now = new Date('2026-08-18T08:00:00.000Z')
    const horizon = new Date(now.getTime() + 24 * 3_600_000)
    expect(nextWeeklyRun(now, horizon, TUESDAY, '10:00')?.toISOString()).toBe(
      '2026-08-18T10:00:00.000Z',
    )
  })

  it('rolls to next week when today’s slot has already passed', () => {
    // Tuesday 11:00 UTC — 10:00 is gone, so the next run is seven days out and
    // therefore outside a 24h horizon.
    const now = new Date('2026-08-18T11:00:00.000Z')
    const horizon = new Date(now.getTime() + 24 * 3_600_000)
    expect(nextWeeklyRun(now, horizon, TUESDAY, '10:00')).toBeNull()
  })

  it('crosses midnight into tomorrow', () => {
    // Tuesday 20:00 UTC, looking for Wednesday 02:00 UTC — six hours away, and a
    // different calendar day. This is the case a naive "same day" implementation
    // drops.
    const now = new Date('2026-08-18T20:00:00.000Z')
    const horizon = new Date(now.getTime() + 24 * 3_600_000)
    expect(nextWeeklyRun(now, horizon, WEDNESDAY, '02:00')?.toISOString()).toBe(
      '2026-08-19T02:00:00.000Z',
    )
  })

  it('returns null for a slot beyond the horizon', () => {
    // Tuesday 12:00 looking for Wednesday 10:00 is 22h away — inside. Looking for
    // Thursday is not.
    const now = new Date('2026-08-18T12:00:00.000Z')
    const horizon = new Date(now.getTime() + 24 * 3_600_000)
    expect(nextWeeklyRun(now, horizon, WEDNESDAY, '10:00')).not.toBeNull()
    expect(nextWeeklyRun(now, horizon, 4 /* Thursday */, '10:00')).toBeNull()
  })

  it('rejects an unparseable time rather than defaulting to midnight', () => {
    const now = new Date('2026-08-18T08:00:00.000Z')
    const horizon = new Date(now.getTime() + 24 * 3_600_000)
    expect(nextWeeklyRun(now, horizon, TUESDAY, '')).toBeNull()
    expect(nextWeeklyRun(now, horizon, TUESDAY, 'nonsense')).toBeNull()
  })
})

describe('currentSeasonOf', () => {
  /*
   * The gate that keeps last season's results off a tile labelled "today". On
   * production every WeeklyMatchup row is season 2025 while the clock reads
   * 2026-08 — so this must return 2026 for that date, or the record tile would
   * present a finished season as live.
   */
  it('treats August onward as the new season', () => {
    expect(currentSeasonOf(new Date('2026-08-18T00:00:00.000Z'))).toBe(2026)
    expect(currentSeasonOf(new Date('2026-12-31T00:00:00.000Z'))).toBe(2026)
  })

  it('keeps January through July on the previous season', () => {
    // A season that starts in autumn carries its own year into the new calendar
    // year — January 2027 is still season 2026.
    expect(currentSeasonOf(new Date('2027-01-05T00:00:00.000Z'))).toBe(2026)
    expect(currentSeasonOf(new Date('2026-07-31T00:00:00.000Z'))).toBe(2025)
  })
})
