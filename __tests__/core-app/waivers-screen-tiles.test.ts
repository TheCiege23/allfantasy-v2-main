import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The league Waivers screen's tiles and rules, each pinned to the defect it used to have
 * (2026-10-02 audit). Same harness shape as waivers-roster-payload.test.ts.
 */

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn(), findUnique: vi.fn() },
  leagueWaiverSettings: { findUnique: vi.fn() },
  waiverClaim: { count: vi.fn() },
  /* Sleeper's own settings, read for a league with no observed schedule (lib/waivers/sleeperWaiverSchedule.ts). */
  $queryRaw: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

/* The observed Sleeper schedule, per test — its own derivation is covered in sleeper-waiver-schedule.test.ts. */
const observed = vi.hoisted(() => ({ map: new Map<string, unknown>() }))
vi.mock('@/lib/waivers/observedWaiverSchedule', async (importOriginal) => ({
  /* Keep the real exports: lib/waivers/sleeperWaiverSchedule.ts reads OBSERVED_TIME_ZONE from here,
   * and a bare mock throws on it — which the screen's catch turns into a silent "not observed". */
  ...(await importOriginal<typeof import('@/lib/waivers/observedWaiverSchedule')>()),
  loadObservedWaiverSchedules: async () => observed.map,
}))
vi.mock('server-only', () => ({}))

const LEAGUE = { id: 'L1', name: 'Test League', platform: 'sleeper', leagueType: 'redraft', platformLeagueId: 'SL1' }

vi.mock('@/lib/core-app/leagueContext', () => ({
  leagueContextFor: () => ({
    league: async () => LEAGUE,
    claimedTeam: async () => ({ platformUserId: 'me', externalId: '1' }),
  }),
}))

import { getWaiversData } from '@/lib/core-app/waivers'

beforeEach(() => {
  vi.clearAllMocks()
  observed.map = new Map()
  LEAGUE.platform = 'sleeper'
  prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue(null)
  prismaMock.waiverClaim.count.mockResolvedValue(2)
  prismaMock.$queryRaw.mockResolvedValue([])
  prismaMock.roster.findMany.mockResolvedValue([
    { id: 'r-me', platformUserId: 'me', faabRemaining: 40, waiverPriority: 3 },
    { id: 'r-them', platformUserId: 'them', faabRemaining: 40, waiverPriority: 1 },
    { id: 'r-other', platformUserId: 'other', faabRemaining: 90, waiverPriority: 7 },
  ])
  prismaMock.roster.findUnique.mockResolvedValue({ playerData: { players: ['p1'], starters: ['p1'] } })
})

describe('Claims queued', () => {
  it('does not claim "0 pending" on an imported league — it cannot see those claims at all', async () => {
    const data = await getWaiversData('L1', 'me')
    expect(data?.claimsQueued).toMatchObject({ available: false, reason: expect.stringContaining('Sleeper') })
    /* Not merely relabelled: the table that cannot hold a Sleeper claim is not even read. */
    expect(prismaMock.waiverClaim.count).not.toHaveBeenCalled()
  })

  it('counts only PENDING claims on a league AllFantasy runs', async () => {
    LEAGUE.platform = 'manual'
    const data = await getWaiversData('L1', 'me')
    expect(data?.claimsQueued).toEqual({ available: true, data: { count: 2, committed: null } })
    expect(prismaMock.waiverClaim.count.mock.calls[0][0].where).toMatchObject({ status: 'pending' })
  })
})

describe('FAAB tiebreak', () => {
  const faab = { waiverType: 'faab', faabBudget: 100, tiebreakRule: 'faab_highest' }

  it('does not print "Highest FAAB bid" as the answer to how EQUAL bids are split (imported)', async () => {
    prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue(faab)
    const data = await getWaiversData('L1', 'me')
    expect(data?.tiebreak).toMatchObject({ available: false, reason: expect.stringContaining('equal bids') })
  })

  it("states the native engine's own order — equal bids go to waiver priority", async () => {
    LEAGUE.platform = 'manual'
    prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue(faab)
    const data = await getWaiversData('L1', 'me')
    expect(data?.tiebreak).toEqual({ available: true, data: 'Highest bid wins · equal bids go to waiver priority' })
  })
})

describe('Your FAAB rank', () => {
  it('shares a rank on a tied budget rather than ordering the tie arbitrarily', async () => {
    prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'faab', faabBudget: 100 })
    const data = await getWaiversData('L1', 'me')
    /* 90 is first; the two 40s are both second. */
    expect(data?.budget).toMatchObject({ available: true, data: { faabRemaining: 40, rankByBudget: 2 } })
  })
})

describe('Waivers run — a Sleeper league', () => {
  it('shows the schedule OBSERVED from its own processed claims, in Pacific, and says what it rests on', async () => {
    prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'faab', processingDayOfWeek: 1, processingTimeUtc: '12:00' })
    observed.map = new Map([['L1', { schedule: { dayOfWeek: 3, time: '03:00', timeZone: 'America/Los_Angeles' }, agreeingRuns: 5, consideredRuns: 6, lastRunAt: 'x' }]])
    const data = await getWaiversData('L1', 'me')
    expect(data?.processTime).toEqual({
      available: true,
      data: {
        schedule: { dayOfWeek: 3, time: '03:00', timeZone: 'America/Los_Angeles' },
        dayLabel: 'Wednesday',
        timeLabel: '03:00 Pacific',
        observedRuns: 5,
        fromSleeperSetting: false,
      },
    })
  })

  it('never falls back to the stored bootstrap default when nothing has been observed yet', async () => {
    prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'faab', processingDayOfWeek: 1, processingTimeUtc: '12:00' })
    const data = await getWaiversData('L1', 'me')
    expect(data?.processTime).toMatchObject({ available: false, reason: expect.stringContaining('not been seen processing') })
  })

  it("falls back to Sleeper's own daily hour when nothing has been observed — and says so", async () => {
    prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'faab', processingDayOfWeek: 1, processingTimeUtc: '12:00' })
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'L1', raw: { daily_waivers: 1, daily_waivers_hour: 9, waiver_day_of_week: 2 } }])
    const data = await getWaiversData('L1', 'me')
    expect(data?.processTime).toEqual({
      available: true,
      data: {
        schedule: { dayOfWeek: null, time: '09:00', timeZone: 'America/Los_Angeles' },
        dayLabel: 'Every day',
        timeLabel: '09:00 Pacific',
        observedRuns: null,
        fromSleeperSetting: true,
      },
    })
  })

  it('a non-daily league on day value 2 runs Wednesday at its hour — the one measured value (S-05)', async () => {
    prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'faab', processingDayOfWeek: 1, processingTimeUtc: '12:00' })
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'L1', raw: { daily_waivers: 0, daily_waivers_hour: 0, waiver_day_of_week: 2 } }])
    const data = await getWaiversData('L1', 'me')
    expect(data?.processTime).toEqual({
      available: true,
      data: {
        schedule: { dayOfWeek: 3, time: '00:00', timeZone: 'America/Los_Angeles' },
        dayLabel: 'Wednesday',
        timeLabel: '00:00 Pacific',
        observedRuns: null,
        fromSleeperSetting: true,
      },
    })
  })

  it('does NOT invent a schedule for any other day value — that weekday is unresolved (S-05)', async () => {
    prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'faab', processingDayOfWeek: 1, processingTimeUtc: '12:00' })
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'L1', raw: { daily_waivers: 0, daily_waivers_hour: 0, waiver_day_of_week: 1 } }])
    const data = await getWaiversData('L1', 'me')
    expect(data?.processTime).toMatchObject({ available: false, reason: expect.stringContaining('not been seen processing') })
  })

  it('an observed schedule wins over the setting, and the setting is not even read', async () => {
    observed.map = new Map([['L1', { schedule: { dayOfWeek: null, time: '00:05', timeZone: 'America/Los_Angeles' }, agreeingRuns: 7, consideredRuns: 10, lastRunAt: 'x' }]])
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'L1', raw: { daily_waivers: 1, daily_waivers_hour: 9 } }])
    const data = await getWaiversData('L1', 'me')
    expect(data?.processTime).toMatchObject({ available: true, data: { timeLabel: '00:05 Pacific', observedRuns: 7, fromSleeperSetting: false } })
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('still reads it when the league has no ingested waiver settings row at all', async () => {
    observed.map = new Map([['L1', { schedule: { dayOfWeek: null, time: '01:00', timeZone: 'America/Los_Angeles' }, agreeingRuns: 9, consideredRuns: 10, lastRunAt: 'x' }]])
    const data = await getWaiversData('L1', 'me')
    expect(data?.processTime).toMatchObject({ available: true, data: { dayLabel: 'Every day', observedRuns: 9 } })
  })
})
