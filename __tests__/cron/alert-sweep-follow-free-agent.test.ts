import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  runFollow: vi.fn(),
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
vi.mock('@/lib/chimmy-alerts/hydrateInjuredStarters', () => ({
  hydrateInjuredStarters: vi.fn(async () => ({ injuredStarters: [], leaguesScanned: 0, feedStale: false })),
}))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertDetectors', () => ({ detectInjuredStarterAlerts: vi.fn(() => []) }))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertPreferencesService', () => ({ loadChimmyAlertPreferences: vi.fn(async () => null) }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: vi.fn(async () => []) }))
vi.mock('@/lib/notifications/pushGate', () => ({ decidePushForUser: vi.fn(async () => ({ allowed: false, reason: 'test' })) }))
vi.mock('@/lib/chimmy-alerts/injuryFanOut', () => ({ buildFanOutLeagues: vi.fn(async () => []) }))
vi.mock('@/lib/chimmy-alerts/runLineupCheck', () => ({ runLineupCheck: vi.fn(async () => ({ ran: false, reason: 'early', week: null, mainSlate: null })) }))
vi.mock('@/lib/chimmy-alerts/runWaiverCheck', () => ({ runWaiverCheck: vi.fn(async () => ({ ran: false, reason: 'early', week: null, firstKickoff: null })) }))
vi.mock('@/lib/chimmy-alerts/runSportWaiverCheck', () => ({
  runSportWaiverCheck: vi.fn(async () => ({ ran: false, reason: 'closed', day: '2026-10-08', sports: {} })),
}))
vi.mock('@/lib/follows/followFreeAgentDeps', () => ({ followFreeAgentDeps: { marker: 'db-deps' } }))
vi.mock('@/lib/follows/followFreeAgentCheck', () => ({ runFollowFreeAgentCheck: h.runFollow }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  recordSyncJobRun: h.recordSyncJobRun,
}))

import { GET } from '@/app/api/cron/alert-sweep/route'

/**
 * The followed-player free-agent check rides every sweep (2026-10-08): it is handed the sweep's own
 * dry-run and user scope plus the DB-backed deps, its result is reported, and its heartbeat is
 * written only on a scheduled run that ran.
 */

const call = async (qs = '') => (await GET(new NextRequest(`https://example.test/api/cron/alert-sweep?${qs}`))).json()

const RAN = { ran: true, dryRun: false, users: 3, followsChecked: 9, seeded: 2, alerts: 1, deduped: 0, notReached: 0, errors: [] }

beforeEach(() => {
  vi.clearAllMocks()
  h.runFollow.mockResolvedValue(RAN)
})

describe('alert sweep — followed-player free-agent check', () => {
  it('runs on a scheduled sweep with the DB deps, reports, and records its heartbeat', async () => {
    const body = await call()
    expect(h.runFollow).toHaveBeenCalledWith({ dryRun: false, userId: null, budgetMs: expect.any(Number) }, { marker: 'db-deps' })
    expect(body.followFreeAgent).toEqual(RAN)
    expect(h.recordSyncJobRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: 'cron-follow-free-agent' }),
      expect.objectContaining({ rowsRead: 9, rowsWritten: 1, status: 'success' }),
      expect.any(Number),
    )
  })

  it('a hand-run verification passes its scope through and records nothing', async () => {
    await call('dryRun=1&userId=u9')
    expect(h.runFollow).toHaveBeenCalledWith({ dryRun: true, userId: 'u9', budgetMs: expect.any(Number) }, { marker: 'db-deps' })
    expect(h.recordSyncJobRun).not.toHaveBeenCalledWith(expect.objectContaining({ jobName: 'cron-follow-free-agent' }), expect.anything(), expect.anything())
  })

  it('followFree=off skips it', async () => {
    const body = await call('followFree=off')
    expect(h.runFollow).not.toHaveBeenCalled()
    expect(body.followFreeAgent).toEqual({ ran: false, reason: 'disabled' })
  })

  it('🛑 a check that throws never fails the sweep', async () => {
    h.runFollow.mockRejectedValue(new Error('roster read exploded'))
    const body = await call()
    expect(body.ok).toBe(true)
    expect(body.followFreeAgent).toEqual({ ran: false, reason: 'error', error: 'roster read exploded' })
  })
})
