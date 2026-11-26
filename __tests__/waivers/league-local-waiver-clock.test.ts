import { describe, expect, it } from 'vitest'
import {
  engineScheduleFromLocalClear,
  formatLocalWaiverClear,
  nextLocalWaiverClear,
  parseLocalWaiverClear,
} from '@/lib/waivers/leagueLocalWaiverClock'

const wedMidnight = { days: [3], hour: 0, minute: 0 }

describe('waivers clear at league time, all year', () => {
  it('Wednesday 12:00 AM Pacific is Wednesday 08:00 UTC in winter and 07:00 UTC in summer', () => {
    expect(engineScheduleFromLocalClear(wedMidnight, 'America/Los_Angeles', new Date('2026-12-01T12:00:00Z'))).toEqual({
      processingDays: [3],
      processingDayOfWeek: 3,
      processingTimeUtc: '08:00',
    })
    expect(engineScheduleFromLocalClear(wedMidnight, 'America/Los_Angeles', new Date('2026-09-15T12:00:00Z')).processingTimeUtc).toBe('07:00')
  })

  it('rolls the UTC weekday when the local time crosses midnight UTC', () => {
    // Wednesday 9:00 PM Eastern (winter) is Thursday 02:00 UTC.
    expect(engineScheduleFromLocalClear({ days: [3], hour: 21, minute: 0 }, 'America/New_York', new Date('2026-12-01T12:00:00Z'))).toMatchObject({
      processingDays: [4],
      processingTimeUtc: '02:00',
    })
  })

  it('the next clear lands on the same local wall-clock time on both sides of a DST change', () => {
    // US clocks fall back Sunday 2026-11-01. Clears on Wed Oct 28 (PDT) and Wed Nov 4 (PST).
    const before = nextLocalWaiverClear(wedMidnight, 'America/Los_Angeles', new Date('2026-10-26T00:00:00Z'))!
    const after = nextLocalWaiverClear(wedMidnight, 'America/Los_Angeles', new Date('2026-11-02T00:00:00Z'))!
    expect(before.toISOString()).toBe('2026-10-28T07:00:00.000Z')
    expect(after.toISOString()).toBe('2026-11-04T08:00:00.000Z')
  })

  it('names the clear in the league zone without a season letter', () => {
    expect(formatLocalWaiverClear(wedMidnight, 'America/Los_Angeles', new Date('2026-12-01T12:00:00Z'))).toBe('Wed 12:00 AM PT')
    expect(formatLocalWaiverClear({ days: [0, 1, 2, 3, 4, 5, 6], hour: 3, minute: 0 }, 'America/New_York', new Date('2026-07-01T12:00:00Z'))).toBe('Daily 3:00 AM ET')
  })

  it('rejects a malformed stored clear', () => {
    expect(parseLocalWaiverClear({ days: [], hour: 0 })).toBeNull()
    expect(parseLocalWaiverClear({ days: [3], hour: 24 })).toBeNull()
    expect(parseLocalWaiverClear({ days: [3, 3, 9], hour: 2 })).toEqual({ days: [3], hour: 2, minute: 0 })
  })
})

describe('a per-day schedule clears on league time too', () => {
  it('Wed + Sat "Waivers to FA" at 2 AM Eastern: the next run is 2 AM Eastern on both sides of the clock change', async () => {
    const { nextLeagueWaiverRunAt } = await import('@/lib/waiver-wire/waiver-state-service')
    const settings = {
      af_daily_waiver_schedule: {
        version: 1, enabled: true, processHour: 2,
        days: { mon: 'free_agents', tue: 'locked', wed: 'waivers_then_fa', thu: 'free_agents', fri: 'free_agents', sat: 'waivers_then_fa', sun: 'locked' },
      },
    }
    const league = { settings, timezone: 'America/New_York' }
    const schedule = { processingDayOfWeek: 3, processingTimeUtc: '06:00', processingDays: [3, 6] }
    // Before the change (EDT, UTC-4): Wed Oct 28 2:00 AM = 06:00 UTC.
    expect(nextLeagueWaiverRunAt(new Date('2026-10-27T12:00:00Z'), schedule, league)).toBe('2026-10-28T06:00:00.000Z')
    // After it (EST, UTC-5): Wed Nov 4 2:00 AM = 07:00 UTC — the stored 06:00 UTC would be 1 AM.
    expect(nextLeagueWaiverRunAt(new Date('2026-11-02T12:00:00Z'), schedule, league)).toBe('2026-11-04T07:00:00.000Z')
    // Sat comes next after Wed.
    expect(nextLeagueWaiverRunAt(new Date('2026-11-04T08:00:00Z'), schedule, league)).toBe('2026-11-07T07:00:00.000Z')
  })
})
