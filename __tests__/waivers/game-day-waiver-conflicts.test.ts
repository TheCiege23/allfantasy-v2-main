import { describe, expect, it, vi } from 'vitest'
import { describeGameDayConflict, findGameDayWaiverConflicts } from '@/lib/waivers/gameDayWaiverConflicts'
import type { DailyWaiverSchedule } from '@/lib/waivers/dailyWaiverSchedule'

const schedule = (over: Partial<DailyWaiverSchedule['days']> = {}, processHour = 2): DailyWaiverSchedule => ({
  version: 1,
  enabled: true,
  processHour,
  days: { mon: 'waivers_then_fa', tue: 'locked', wed: 'waivers', thu: 'waivers_then_fa', fri: 'free_agents', sat: 'free_agents', sun: 'waivers_then_fa', ...over },
})
const now = new Date('2026-11-23T12:00:00Z') // Monday

describe('game days with no free-agent window', () => {
  it('flags a game on a waivers-only day and on a locked day, in the league zone', () => {
    // Wed Nov 25 8:15 PM ET and Tue Nov 24 7:30 PM ET.
    const conflicts = findGameDayWaiverConflicts({
      schedule: schedule(),
      timeZone: 'America/New_York',
      gameStarts: [new Date('2026-11-26T01:15:00Z'), new Date('2026-11-25T00:30:00Z')],
      now,
    })
    expect(conflicts.map((c) => [c.day, c.date, c.reason])).toEqual([
      ['tue', '2026-11-24', 'locked'],
      ['wed', '2026-11-25', 'claims_only'],
    ])
  })

  it('a "Waivers to FA" day is fine when waivers clear before kickoff, and flagged when they clear after', () => {
    const thursdayNight = new Date('2026-11-27T01:15:00Z') // Thu Nov 26 8:15 PM ET
    expect(findGameDayWaiverConflicts({ schedule: schedule({}, 2), timeZone: 'America/New_York', gameStarts: [thursdayNight], now })).toEqual([])
    const late = findGameDayWaiverConflicts({ schedule: schedule({}, 21), timeZone: 'America/New_York', gameStarts: [thursdayNight], now })
    expect(late.map((c) => c.reason)).toEqual(['free_agency_opens_after_kickoff'])
  })

  it('the same instant is a different day in another zone', () => {
    // 1:15 UTC Thursday is still Wednesday evening in Pacific: a waivers-only day there.
    const c = findGameDayWaiverConflicts({ schedule: schedule(), timeZone: 'America/Los_Angeles', gameStarts: [new Date('2026-11-26T01:15:00Z')], now })
    expect(c.map((x) => x.day)).toEqual(['wed'])
  })

  it('free-agent days, past games and a disabled schedule never conflict', () => {
    expect(findGameDayWaiverConflicts({ schedule: schedule(), timeZone: 'UTC', gameStarts: [new Date('2026-11-27T18:00:00Z')], now })).toEqual([]) // Friday
    expect(findGameDayWaiverConflicts({ schedule: schedule(), timeZone: 'UTC', gameStarts: [new Date('2026-11-22T18:00:00Z')], now })).toEqual([])
    expect(findGameDayWaiverConflicts({ schedule: { ...schedule(), enabled: false }, timeZone: 'UTC', gameStarts: [new Date('2026-11-25T18:00:00Z')], now })).toEqual([])
  })

  it('tells the commissioner in one sentence', () => {
    const [c] = findGameDayWaiverConflicts({ schedule: schedule(), timeZone: 'America/New_York', gameStarts: [new Date('2026-11-26T01:15:00Z')], now })
    expect(describeGameDayConflict(c!, 'America/New_York')).toBe(
      "Wednesday (2026-11-25) has 1 game from 8:15 PM EST, but it is a waivers-only day, so managers can't add a free agent before kickoff.",
    )
  })
})

const svc = vi.hoisted(() => ({ league: null as unknown, games: [] as Array<{ startTime: Date }>, plan: true }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: async () => svc.league },
    sportsGame: { findMany: async () => svc.games },
  },
}))
vi.mock('@/lib/stat-corrections/applyStatCorrections', () => ({ ownerHasAfCommissionerPlan: async () => svc.plan }))
vi.mock('@/lib/sports-data/riScheduleCache', () => ({ readRiScheduleWindow: async () => null }))

describe('the commissioner task', () => {
  const league = { id: 'L1', userId: 'owner', sport: 'NFL', season: 2026, timezone: 'America/New_York', settings: { af_daily_waiver_schedule: schedule() } }

  it('opens one task per conflicting date, with a notification and a link to the waiver days', async () => {
    svc.league = league
    svc.plan = true
    svc.games = [{ startTime: new Date('2026-11-26T01:15:00Z') }]
    const { readGameDayWaiverConflictTasks } = await import('@/lib/waivers/gameDayWaiverConflictService')
    const tasks = await readGameDayWaiverConflictTasks('L1', now)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      sourceKey: 'daily-waiver-game-day-conflict:v1:2026-11-25',
      title: 'Wednesday has games but no free-agent window before kickoff',
      notifyOnOpen: { actionLabel: 'Change Wednesday', actionHref: '/league/L1?view=settings&settingsPanel=waivers' },
    })
  })

  it('is AF Commissioner only: no plan, no task', async () => {
    svc.league = league
    svc.plan = false
    svc.games = [{ startTime: new Date('2026-11-26T01:15:00Z') }]
    const { readGameDayWaiverConflictTasks } = await import('@/lib/waivers/gameDayWaiverConflictService')
    expect(await readGameDayWaiverConflictTasks('L1', now)).toEqual([])
  })
})
