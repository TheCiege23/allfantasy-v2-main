/**
 * Processing Time as a picker (owner request, 2026-11-28). The hour lives on the custom daily schedule in
 * LEAGUE time; `League.waiverProcessTime` is the UTC run time the settings PATCH derives from it, so the
 * row used to print 07:00 for a 2 AM Eastern run under "Time shown in America/New_York".
 */
import { describe, expect, it } from 'vitest'
import { buildWaiverGroups, clockHourLabel, dailyScheduleWithHour, DAILY_WAIVER_HOUR_FIELD } from '@/lib/league-settings-hub/hubModel'
import { DAILY_WAIVER_SCHEDULE_SETTINGS_KEY, defaultDailyWaiverSchedule, deriveEngineProcessingFromSchedule } from '@/lib/waivers/dailyWaiverSchedule'

const schedule = { ...defaultDailyWaiverSchedule(), enabled: true, processHour: 2 }
const snapshot = { [DAILY_WAIVER_SCHEDULE_SETTINGS_KEY]: schedule }
const processRow = (snap: Record<string, unknown>, league: Record<string, unknown> = {}) =>
  buildWaiverGroups(
    { league: { sport: 'NBA', waiverType: 'rolling', customDailyWaivers: true, waiverProcessTime: '07:00', timezone: 'America/New_York', ...league }, settingsSnapshot: snap },
    'redraft',
  )
    .flatMap((g) => g.rows)
    .find((r) => r.key === 'process')

describe('waiver processing time picker', () => {
  it('shows the league-time hour from the schedule, not the UTC column', () => {
    const row = processRow(snapshot)!
    expect(row.value).toBe('2:00 AM')
    expect(row.description).toBe('Time shown in America/New_York')
  })

  it('offers every hour of the day, with the current one marked', () => {
    const row = processRow(snapshot)!
    expect(row.edit?.field).toBe(DAILY_WAIVER_HOUR_FIELD)
    expect(row.edit?.current).toBe(2)
    expect(row.edit?.choices.map((c) => c.value)).toEqual(Array.from({ length: 24 }, (_, h) => h))
    expect(row.edit?.choices[0]?.label).toBe('12:00 AM')
    expect(row.edit?.choices[12]?.label).toBe('12:00 PM')
    expect(row.edit?.choices[21]?.label).toBe('9:00 PM')
  })

  it('without a readable schedule, falls back to the stored time and offers no picker', () => {
    const row = processRow({})!
    expect(row.value).toBe('07:00')
    expect(row.edit).toBeUndefined()
  })

  it('has no row at all when custom daily waivers are off', () => {
    expect(processRow(snapshot, { customDailyWaivers: false })).toBeUndefined()
  })

  it('saves the whole schedule with only the hour changed, and the run moves with it', () => {
    const next = dailyScheduleWithHour(snapshot, 21)!
    expect(next).toEqual({ ...schedule, processHour: 21 })
    expect(next.days).toEqual(schedule.days)
    // 9 PM Eastern on a Wednesday is 02:00 UTC Thursday (EST, UTC-5).
    expect(deriveEngineProcessingFromSchedule(next, 'America/New_York').processingTimeUtc).toBe('02:00')
  })

  it('refuses to save when the schedule is off or missing, or the hour is not an hour', () => {
    expect(dailyScheduleWithHour({ [DAILY_WAIVER_SCHEDULE_SETTINGS_KEY]: { ...schedule, enabled: false } }, 5)).toBeNull()
    expect(dailyScheduleWithHour({}, 5)).toBeNull()
    expect(dailyScheduleWithHour(snapshot, 24)).toBeNull()
    expect(dailyScheduleWithHour(snapshot, 2.5)).toBeNull()
  })

  it('labels hours on a 12-hour clock', () => {
    expect([0, 1, 11, 12, 13, 23].map(clockHourLabel)).toEqual(['12:00 AM', '1:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '11:00 PM'])
  })
})
