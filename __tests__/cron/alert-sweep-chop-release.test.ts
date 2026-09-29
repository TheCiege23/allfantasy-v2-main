import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  hydrate: vi.fn(),
  detect: vi.fn(),
  dispatch: vi.fn(),
  runLineupCheck: vi.fn(),
  runWaiverCheck: vi.fn(),
  runChop: vi.fn(),
  recordSyncJobRun: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { count: async () => 0 },
    webPushSubscription: { findMany: async () => [] },
    leagueTeam: { findMany: async () => [{ claimedByUserId: 'u1' }] },
    appUser: { count: async () => 1 },
    platformNotification: { findFirst: async () => null },
  },
}))
vi.mock('@/lib/autocoach/status-sources/SleeperStatusAdapter', () => ({ fetchSleeperStatuses: vi.fn(async () => ({})) }))
vi.mock('@/lib/chimmy-alerts/hydrateInjuredStarters', () => ({ hydrateInjuredStarters: h.hydrate }))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertDetectors', () => ({ detectInjuredStarterAlerts: h.detect }))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertPreferencesService', () => ({ loadChimmyAlertPreferences: vi.fn(async () => null) }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: vi.fn(async () => []) }))
vi.mock('@/lib/notifications/pushGate', () => ({ decidePushForUser: vi.fn(async () => ({ allowed: false, reason: 'test' })) }))
vi.mock('@/lib/chimmy-alerts/injuryFanOut', () => ({ buildFanOutLeagues: vi.fn(async () => []) }))
vi.mock('@/lib/chimmy-alerts/runLineupCheck', () => ({ runLineupCheck: h.runLineupCheck }))
vi.mock('@/lib/chimmy-alerts/runWaiverCheck', () => ({ runWaiverCheck: h.runWaiverCheck }))
vi.mock('@/lib/chimmy-alerts/runChopReleaseCheck', () => ({ runChopReleaseCheck: h.runChop }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  recordSyncJobRun: h.recordSyncJobRun,
}))

import { GET } from '@/app/api/cron/alert-sweep/route'

/**
 * The chop-release alert in the sweep: shipped OFF. With the flag unset the runner is never even
 * loaded; with it set, it runs once per sweep and its heartbeat is recorded only when it found a chop.
 */

const call = async (qs = '') => (await GET(new NextRequest(`https://example.test/api/cron/alert-sweep?${qs}`))).json()

const RAN = {
  ran: true,
  dryRun: false,
  leagues: 2,
  seeded: 0,
  resets: 0,
  chops: [{ leagueId: 'L1', season: 2026, week: 5, teams: ['Gamma Squad'], released: 14 }],
  outcomes: { sent: 3 },
  noWeek: 0,
  budgetStopped: false,
  previews: [],
  errors: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  h.hydrate.mockResolvedValue({ injuredStarters: [], leaguesScanned: 0, feedStale: false })
  h.detect.mockReturnValue([])
  h.runLineupCheck.mockResolvedValue({ ran: false, reason: 'early', week: null, mainSlate: null })
  h.runWaiverCheck.mockResolvedValue({ ran: false, reason: 'early', week: null, firstKickoff: null })
  h.runChop.mockResolvedValue(RAN)
})

describe('alert sweep — chop-release alert', () => {
  it('🛑 flag unset: reported disabled, the runner never called, nothing dispatched', async () => {
    const body = await call()
    expect(body.chopRelease).toEqual({ ran: false, reason: 'disabled' })
    expect(h.runChop).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.recordSyncJobRun.mock.calls.map((c) => c[0].jobName)).not.toContain('cron-chimmy-chop-release')
  })

  it('any value but "1" is off', async () => {
    vi.stubEnv('CHOP_RELEASE_ALERTS_ENABLED', 'true')
    expect((await call()).chopRelease).toEqual({ ran: false, reason: 'disabled' })
    expect(h.runChop).not.toHaveBeenCalled()
  })

  it('flag on: runs once per sweep and records its heartbeat when it found a chop', async () => {
    vi.stubEnv('CHOP_RELEASE_ALERTS_ENABLED', '1')
    const body = await call()
    expect(h.runChop).toHaveBeenCalledTimes(1)
    expect(h.runChop.mock.calls[0]![0]).toMatchObject({ dryRun: false, force: false, userId: null })
    expect(body.chopRelease).toMatchObject({ ran: true, outcomes: { sent: 3 } })
    const hb = h.recordSyncJobRun.mock.calls.find((c) => c[0].jobName === 'cron-chimmy-chop-release')
    expect(hb?.[1]).toMatchObject({ rowsRead: 2, rowsWritten: 3, status: 'success' })
  })

  it('flag on, but chopRelease=off for this run: skipped', async () => {
    vi.stubEnv('CHOP_RELEASE_ALERTS_ENABLED', '1')
    expect((await call('chopRelease=off')).chopRelease).toEqual({ ran: false, reason: 'disabled' })
    expect(h.runChop).not.toHaveBeenCalled()
  })

  it('flag on, dry run: passed through, and no heartbeat is written', async () => {
    vi.stubEnv('CHOP_RELEASE_ALERTS_ENABLED', '1')
    await call('dryRun=1')
    expect(h.runChop.mock.calls[0]![0]).toMatchObject({ dryRun: true })
    expect(h.recordSyncJobRun).not.toHaveBeenCalled()
  })

  it('a runner that throws never fails the sweep', async () => {
    vi.stubEnv('CHOP_RELEASE_ALERTS_ENABLED', '1')
    h.runChop.mockRejectedValue(new Error('boom'))
    const res = await GET(new NextRequest('https://example.test/api/cron/alert-sweep'))
    expect(res.status).toBe(200)
    expect((await res.json()).chopRelease).toMatchObject({ ran: false, reason: 'error', error: 'boom' })
  })
})
