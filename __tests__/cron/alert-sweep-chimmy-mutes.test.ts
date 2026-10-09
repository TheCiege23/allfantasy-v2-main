import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  hydrate: vi.fn(),
  detect: vi.fn(),
  loadPrefs: vi.fn(),
  dispatch: vi.fn(),
  runLineupCheck: vi.fn(),
  runWaiverCheck: vi.fn(),
  runSportWaiverCheck: vi.fn(),
  recordSyncJobRun: vi.fn(),
  findFirst: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    // Outside any game window, so the live Sleeper fold returns before it fetches anything.
    sportsGame: { count: async () => 0 },
    webPushSubscription: { findMany: async () => [] },
    leagueTeam: { findMany: async () => [{ claimedByUserId: 'u1' }] },
    appUser: { count: async () => 1 },
    platformNotification: { findFirst: h.findFirst },
  },
}))
vi.mock('@/lib/autocoach/status-sources/SleeperStatusAdapter', () => ({ fetchSleeperStatuses: vi.fn(async () => ({})) }))
vi.mock('@/lib/chimmy-alerts/hydrateInjuredStarters', () => ({ hydrateInjuredStarters: h.hydrate }))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertDetectors', () => ({ detectInjuredStarterAlerts: h.detect }))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertPreferencesService', () => ({ loadChimmyAlertPreferences: h.loadPrefs }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: vi.fn(async () => []) }))
vi.mock('@/lib/notifications/pushGate', () => ({ decidePushForUser: vi.fn(async () => ({ allowed: false, reason: 'test' })) }))
vi.mock('@/lib/chimmy-alerts/runLineupCheck', () => ({ runLineupCheck: h.runLineupCheck }))
// Mocked, not left real: unmocked, it ran against the stub prisma above and failed into
// `{ reason: 'error' }` on every test — green, and exercising nothing.
vi.mock('@/lib/chimmy-alerts/runWaiverCheck', () => ({ runWaiverCheck: h.runWaiverCheck }))
vi.mock('@/lib/chimmy-alerts/runSportWaiverCheck', () => ({ runSportWaiverCheck: h.runSportWaiverCheck }))
// The followed-player free-agent phase (2026-10-08): mocked, so it never runs against the stub prisma above.
vi.mock('@/lib/follows/followFreeAgentDeps', () => ({ followFreeAgentDeps: {} }))
vi.mock('@/lib/follows/followFreeAgentCheck', () => ({ runFollowFreeAgentCheck: async () => ({ ran: false, reason: 'no_follows' }) }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  recordSyncJobRun: h.recordSyncJobRun,
}))

import { GET } from '@/app/api/cron/alert-sweep/route'

/**
 * The injured-starter sweep and Chimmy's two weekly checks share this route. Pinned: the Settings
 * panel's Chimmy "Lineup" mute reaches the sweep (it used to reach only the alert engine, which the
 * sweep does not run), and the lineup and waiver checks ride along without ever being able to break
 * the sweep — or each other.
 */

const alert = (leagueId: string, player: string, urgencySignal: number) => ({
  id: `a-${leagueId}`,
  class: 'lineup',
  type: 'injured_starter_before_lock',
  title: `${player} is Out`,
  message: `${player} starts for you in ${leagueId}.`,
  leagueId,
  urgencySignal,
  metadata: { playerName: player, designation: 'Out' },
})

const call = (qs: string) => GET(new NextRequest(`https://allfantasy.ai/api/cron/alert-sweep?${qs}`))

beforeEach(() => {
  vi.clearAllMocks()
  h.hydrate.mockResolvedValue({ injuredStarters: [{}], leaguesScanned: 2, feedStale: false })
  h.detect.mockReturnValue([alert('L1', 'Jayden Reed', 90), alert('L2', 'Tank Dell', 70)])
  h.loadPrefs.mockResolvedValue(null)
  h.findFirst.mockResolvedValue(null)
  h.dispatch.mockResolvedValue(undefined)
  h.runLineupCheck.mockResolvedValue({ ran: false, reason: 'early', week: null, mainSlate: null })
  h.runWaiverCheck.mockResolvedValue({ ran: false, reason: 'early', week: null, firstKickoff: null })
  h.runSportWaiverCheck.mockResolvedValue({ ran: false, reason: 'closed', day: '2026-09-29', sports: {} })
})

describe('alert sweep — Chimmy alert controls', () => {
  it('says every flagged player when nothing is muted, most urgent first (the game-day digest)', async () => {
    const body = await (await call('userId=u1')).json()
    // One in-app row per player since the digest (2026-10-08); the phone gets one push for both.
    expect(h.dispatch).toHaveBeenCalledTimes(2)
    expect(h.dispatch.mock.calls[0]![0]).toMatchObject({ title: 'Jayden Reed is Out', leagueId: 'L1' })
    expect(h.dispatch.mock.calls[1]![0]).toMatchObject({ title: 'Tank Dell is Out', leagueId: 'L2' })
    expect(body.usersMutedByChimmy).toBe(0)
  })

  it('🛑 sends nothing to a manager who muted Chimmy lineup alerts', async () => {
    h.loadPrefs.mockResolvedValue({ mutedClasses: ['lineup'] })
    const body = await (await call('userId=u1')).json()
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(body.usersMutedByChimmy).toBe(1)
  })

  it('a muted league silences only that league — the next alert still goes', async () => {
    h.loadPrefs.mockResolvedValue({ leaguePrefs: [{ leagueId: 'L1', disabled: true }] })
    await call('userId=u1')
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0]![0]).toMatchObject({ title: 'Tank Dell is Out', leagueId: 'L2' })
  })

  it('a preferences read that fails mutes nothing', async () => {
    h.loadPrefs.mockRejectedValue(new Error('db down'))
    await call('userId=u1')
    expect(h.dispatch).toHaveBeenCalledTimes(2)
  })
})

describe('alert sweep — the lineup check rides along', () => {
  it('runs it with the sweep’s own dry-run and user scope, and reports it', async () => {
    const body = await (await call('userId=u1&dryRun=1')).json()
    expect(h.runLineupCheck).toHaveBeenCalledWith({ dryRun: true, force: false, userId: 'u1', budgetMs: expect.any(Number) })
    const budget = h.runLineupCheck.mock.calls[0]![0].budgetMs as number
    // A fast sweep leaves the check its full share, never more.
    expect(budget).toBeGreaterThan(80_000)
    expect(budget).toBeLessThanOrEqual(90_000)
    expect(body.lineupCheck).toEqual({ ran: false, reason: 'early', week: null, mainSlate: null })
  })

  it('gets no budget after a sweep that used the run up — it starts nobody rather than overrun', async () => {
    let clock = 1_000_000
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    h.hydrate.mockImplementation(async () => {
      clock += 250_000 // the injured-starter sweep takes 250s this time
      return { injuredStarters: [], leaguesScanned: 0, feedStale: false }
    })
    await call('userId=u1')
    spy.mockRestore()
    expect(h.runLineupCheck.mock.calls[0]![0].budgetMs).toBe(0)
  })

  it('can be forced for a verification, or switched off for a run', async () => {
    await call('userId=u1&lineupCheck=force')
    expect(h.runLineupCheck).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }))
    h.runLineupCheck.mockClear()
    const body = await (await call('userId=u1&lineupCheck=off')).json()
    expect(h.runLineupCheck).not.toHaveBeenCalled()
    expect(body.lineupCheck).toEqual({ ran: false, reason: 'disabled' })
  })

  it('🛑 a lineup check that throws never fails the injured-starter sweep', async () => {
    h.runLineupCheck.mockRejectedValue(new Error('optimizer exploded'))
    const res = await call('userId=u1')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(h.dispatch).toHaveBeenCalledTimes(2)
    expect(body.lineupCheck).toEqual({ ran: false, reason: 'error', error: 'optimizer exploded' })
  })

  it('records its own heartbeat only on a scheduled run that actually checked lineups', async () => {
    const ran = {
      ran: true,
      dryRun: false,
      week: { season: '2026', week: 3 },
      mainSlate: '2026-09-27T17:00:00.000Z',
      users: 4,
      outcomes: { sent: 2, clean: 2 },
      notReached: 0,
      leaguesChecked: 9,
      previews: [],
      errors: [],
    }
    h.runLineupCheck.mockResolvedValue(ran)
    await call('')
    expect(h.recordSyncJobRun).toHaveBeenCalledTimes(1)
    expect(h.recordSyncJobRun.mock.calls[0]![0]).toMatchObject({ jobName: 'cron-chimmy-lineup-check' })
    expect(h.recordSyncJobRun.mock.calls[0]![1]).toMatchObject({ rowsRead: 9, rowsWritten: 2, status: 'success' })

    // A verification by hand, or a quiet Tuesday, writes nothing.
    h.recordSyncJobRun.mockClear()
    await call('userId=u1')
    h.runLineupCheck.mockResolvedValue({ ran: false, reason: 'early', week: null, mainSlate: null })
    await call('')
    expect(h.recordSyncJobRun).not.toHaveBeenCalled()
  })
})

describe('alert sweep — the waiver check rides along too', () => {
  const ranWaivers = {
    ran: true,
    dryRun: false,
    week: { season: '2026', week: 4 },
    firstKickoff: '2026-10-02T00:15:00.000Z',
    users: 5,
    outcomes: { sent: 3, no_picks: 2 },
    notReached: 0,
    picks: 4,
    previews: [],
    errors: [],
  }

  it('runs after the lineup check with the same scope, and reports under `waiverCheck`', async () => {
    const body = await (await call('userId=u1&dryRun=1')).json()
    expect(h.runWaiverCheck).toHaveBeenCalledWith({ dryRun: true, force: false, userId: 'u1', budgetMs: expect.any(Number) })
    expect(h.runWaiverCheck.mock.calls[0]![0].budgetMs).toBeLessThanOrEqual(90_000)
    expect(h.runLineupCheck.mock.invocationCallOrder[0]!).toBeLessThan(h.runWaiverCheck.mock.invocationCallOrder[0]!)
    expect(body.waiverCheck).toEqual({ ran: false, reason: 'early', week: null, firstKickoff: null })
  })

  it('has its own force and off switches, independent of the lineup check', async () => {
    await call('userId=u1&waiverCheck=force')
    expect(h.runWaiverCheck).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }))
    expect(h.runLineupCheck).toHaveBeenLastCalledWith(expect.objectContaining({ force: false }))
    h.runWaiverCheck.mockClear()
    h.runLineupCheck.mockClear()
    const body = await (await call('userId=u1&waiverCheck=off')).json()
    expect(h.runWaiverCheck).not.toHaveBeenCalled()
    expect(h.runLineupCheck).toHaveBeenCalledTimes(1)
    expect(body.waiverCheck).toEqual({ ran: false, reason: 'disabled' })
  })

  it('🛑 a lineup check that throws does not stop the waiver check, and vice versa', async () => {
    h.runLineupCheck.mockRejectedValue(new Error('optimizer exploded'))
    h.runWaiverCheck.mockResolvedValue(ranWaivers)
    let body = await (await call('userId=u1')).json()
    expect(body.lineupCheck).toMatchObject({ ran: false, reason: 'error' })
    expect(body.waiverCheck).toEqual(ranWaivers)

    h.runLineupCheck.mockResolvedValue({ ran: false, reason: 'early', week: null, mainSlate: null })
    h.runWaiverCheck.mockRejectedValue(new Error('board exploded'))
    const res = await call('userId=u1')
    body = await res.json()
    expect(res.status).toBe(200)
    expect(h.dispatch).toHaveBeenCalled()
    expect(body.waiverCheck).toEqual({ ran: false, reason: 'error', error: 'board exploded' })
  })

  it('records `cron-chimmy-waiver-check` only on a scheduled run that ran for users', async () => {
    h.runWaiverCheck.mockResolvedValue(ranWaivers)
    await call('')
    expect(h.recordSyncJobRun).toHaveBeenCalledTimes(1)
    expect(h.recordSyncJobRun.mock.calls[0]![0]).toMatchObject({ jobName: 'cron-chimmy-waiver-check' })
    expect(h.recordSyncJobRun.mock.calls[0]![1]).toMatchObject({
      rowsRead: 5,
      rowsWritten: 3,
      status: 'success',
      metadata: expect.objectContaining({ picks: 4 }),
    })

    h.recordSyncJobRun.mockClear()
    await call('userId=u1')
    await call('dryRun=1')
    await call('waiverCheck=force')
    expect(h.recordSyncJobRun).not.toHaveBeenCalled()
  })
})

describe('alert sweep — the other sports’ waiver check', () => {
  const ranSports = {
    ran: true as const,
    dryRun: false,
    day: '2026-11-10',
    sports: { NBA: 'open', NHL: 'no_games', NCAAF: 'not_today', NCAAB: 'open', MLB: 'out_of_season' },
    openSports: ['NBA', 'NCAAB'],
    users: 4,
    outcomes: { sent: 2, no_picks: 2 },
    notReached: 0,
    picks: 3,
    previews: [],
    errors: [],
  }

  it('runs after the NFL waiver check with the same scope, and reports under `sportWaiverCheck`', async () => {
    const body = await (await call('userId=u1&dryRun=1')).json()
    expect(h.runSportWaiverCheck).toHaveBeenCalledWith({ dryRun: true, force: false, userId: 'u1', budgetMs: expect.any(Number) })
    expect(h.runSportWaiverCheck.mock.calls[0]![0].budgetMs).toBeLessThanOrEqual(90_000)
    expect(h.runWaiverCheck.mock.invocationCallOrder[0]!).toBeLessThan(h.runSportWaiverCheck.mock.invocationCallOrder[0]!)
    expect(body.sportWaiverCheck).toEqual({ ran: false, reason: 'closed', day: '2026-09-29', sports: {} })
  })

  it('has its own force and off switches, independent of the NFL waiver check', async () => {
    await call('userId=u1&sportWaiverCheck=force')
    expect(h.runSportWaiverCheck).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }))
    expect(h.runWaiverCheck).toHaveBeenLastCalledWith(expect.objectContaining({ force: false }))
    h.runSportWaiverCheck.mockClear()
    h.runWaiverCheck.mockClear()
    const body = await (await call('userId=u1&sportWaiverCheck=off')).json()
    expect(h.runSportWaiverCheck).not.toHaveBeenCalled()
    expect(h.runWaiverCheck).toHaveBeenCalledTimes(1)
    expect(body.sportWaiverCheck).toEqual({ ran: false, reason: 'disabled' })
  })

  it('🛑 throwing cannot fail the sweep or the NFL check', async () => {
    h.runSportWaiverCheck.mockRejectedValue(new Error('sections exploded'))
    const res = await call('userId=u1')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(h.dispatch).toHaveBeenCalled()
    expect(body.waiverCheck).toEqual({ ran: false, reason: 'early', week: null, firstKickoff: null })
    expect(body.sportWaiverCheck).toEqual({ ran: false, reason: 'error', error: 'sections exploded' })
  })

  it('records `cron-chimmy-sport-waiver-check` (no single sport) only on a scheduled run that ran for users', async () => {
    h.runSportWaiverCheck.mockResolvedValue(ranSports)
    await call('')
    expect(h.recordSyncJobRun).toHaveBeenCalledTimes(1)
    expect(h.recordSyncJobRun.mock.calls[0]![0]).toEqual({ jobName: 'cron-chimmy-sport-waiver-check', sport: null, trigger: 'cron' })
    expect(h.recordSyncJobRun.mock.calls[0]![1]).toMatchObject({
      rowsRead: 4,
      rowsWritten: 2,
      status: 'success',
      metadata: expect.objectContaining({ day: '2026-11-10', openSports: ['NBA', 'NCAAB'], picks: 3 }),
    })

    h.recordSyncJobRun.mockClear()
    await call('userId=u1')
    await call('dryRun=1')
    await call('sportWaiverCheck=force')
    expect(h.recordSyncJobRun).not.toHaveBeenCalled()
  })

  it('the NFL checks still record under sport NFL', async () => {
    h.runWaiverCheck.mockResolvedValue({
      ran: true,
      dryRun: false,
      week: { season: '2026', week: 4 },
      firstKickoff: '2026-10-02T00:15:00.000Z',
      users: 1,
      outcomes: { sent: 1 },
      notReached: 0,
      picks: 1,
      previews: [],
      errors: [],
    })
    await call('')
    expect(h.recordSyncJobRun.mock.calls[0]![0]).toEqual({ jobName: 'cron-chimmy-waiver-check', sport: 'NFL', trigger: 'cron' })
  })
})
