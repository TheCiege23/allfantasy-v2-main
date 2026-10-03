import { describe, expect, it, vi } from 'vitest'

/**
 * Sleeper's own daily-hour setting as the fallback schedule (lib/waivers/sleeperWaiverSchedule.ts).
 * The observed half is covered in sleeper-waiver-schedule.test.ts; here it is stubbed per test.
 */

const observed = vi.hoisted(() => ({ map: new Map<string, unknown>() }))
vi.mock('@/lib/waivers/observedWaiverSchedule', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/waivers/observedWaiverSchedule')>()),
  loadObservedWaiverSchedules: async () => observed.map,
}))

import { loadSleeperWaiverSchedules, scheduleFromSleeperSetting } from '@/lib/waivers/sleeperWaiverSchedule'
import { rowWaiverSchedule } from '@/lib/core-app/waiverRowMeta'

const PT = 'America/Los_Angeles'
const setting = (raw: unknown) => scheduleFromSleeperSetting({ sleeper_waiver_schedule: raw })

describe('scheduleFromSleeperSetting', () => {
  it('a daily league runs every day at daily_waivers_hour, Pacific (S-06: 246 of 249 leagues agree)', () => {
    expect(setting({ daily_waivers: 1, daily_waivers_hour: 9, waiver_day_of_week: 2 })).toEqual({ dayOfWeek: null, time: '09:00', timeZone: PT })
    expect(setting({ daily_waivers: 1, daily_waivers_hour: 0 })).toEqual({ dayOfWeek: null, time: '00:00', timeZone: PT })
  })

  it('a league that is NOT daily gets nothing — its weekday is unresolved (S-05)', () => {
    expect(setting({ daily_waivers: 0, daily_waivers_hour: 0, waiver_day_of_week: 2 })).toBeNull()
    expect(setting({ daily_waivers_hour: 0 })).toBeNull()
  })

  it('refuses an hour that is not an hour', () => {
    for (const h of [24, -1, 1.5, '9', null]) expect(setting({ daily_waivers: 1, daily_waivers_hour: h })).toBeNull()
  })

  it('nothing stored, nothing returned', () => {
    expect(scheduleFromSleeperSetting({})).toBeNull()
    expect(scheduleFromSleeperSetting(null)).toBeNull()
  })
})

describe('loadSleeperWaiverSchedules', () => {
  const prismaWith = (rows: unknown) => ({ league: { findMany: vi.fn() }, $queryRaw: vi.fn(async () => rows) })

  it('observed first; the setting only for leagues observation left unanswered', async () => {
    observed.map = new Map([['A', { schedule: { dayOfWeek: null, time: '00:05', timeZone: PT }, agreeingRuns: 6, consideredRuns: 10, lastRunAt: 'x' }]])
    const prisma = prismaWith([
      { id: 'B', raw: { daily_waivers: 1, daily_waivers_hour: 8 } },
      { id: 'C', raw: { daily_waivers: 0, daily_waivers_hour: 0 } },
    ])
    const out = await loadSleeperWaiverSchedules(prisma as never, ['A', 'B', 'C', 'D'])
    expect(out.get('A')).toMatchObject({ source: 'observed', agreeingRuns: 6 })
    expect(out.get('B')).toEqual({ source: 'sleeper_setting', schedule: { dayOfWeek: null, time: '08:00', timeZone: PT } })
    expect(out.has('C')).toBe(false)
    expect(out.has('D')).toBe(false)
    /* Only the leagues without an observed answer are asked about. */
    const sent = (prisma.$queryRaw.mock.calls[0] as unknown as [{ values: unknown[] }])[0].values
    expect(sent).toContainEqual(['B', 'C', 'D'])
  })

  it('a failed settings read costs the fallback, never the observed answers', async () => {
    observed.map = new Map([['A', { schedule: { dayOfWeek: null, time: '00:05', timeZone: PT }, agreeingRuns: 6, consideredRuns: 10, lastRunAt: 'x' }]])
    const prisma = { league: { findMany: vi.fn() }, $queryRaw: vi.fn(() => { throw new Error('boom') }) }
    const out = await loadSleeperWaiverSchedules(prisma as never, ['A', 'B'])
    expect([...out.keys()]).toEqual(['A'])
  })
})

describe('rowWaiverSchedule — what the board row says it rests on', () => {
  it("labels a setting-derived schedule as Sleeper's setting, an observed one by its runs", () => {
    const s = { dayOfWeek: null, time: '09:00', timeZone: PT }
    expect(rowWaiverSchedule(null, 'sleeper', { source: 'sleeper_setting', schedule: s })?.label).toBe("Daily 09:00 Pacific (Sleeper's setting)")
    expect(rowWaiverSchedule(null, 'sleeper', { source: 'observed', schedule: s, agreeingRuns: 4 })?.label).toBe('Daily 09:00 Pacific (seen over 4 runs)')
  })
})
