import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  hydrate: vi.fn(),
  detect: vi.fn(),
  dispatch: vi.fn(),
  runLineupCheck: vi.fn(),
  runWaiverCheck: vi.fn(),
  runSportWaiverCheck: vi.fn(),
  runChop: vi.fn(),
  recordSyncJobRun: vi.fn(),
  runScheduled: vi.fn(),
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
vi.mock('@/lib/chimmy-alerts/runSportWaiverCheck', () => ({ runSportWaiverCheck: h.runSportWaiverCheck }))
// The followed-player free-agent phase (2026-10-08): mocked, so it never runs against the stub prisma above.
vi.mock('@/lib/follows/followFreeAgentDeps', () => ({ followFreeAgentDeps: {} }))
vi.mock('@/lib/follows/followFreeAgentCheck', () => ({ runFollowFreeAgentCheck: async () => ({ ran: false, reason: 'no_follows' }) }))
vi.mock('@/lib/chimmy-alerts/runChopReleaseCheck', () => ({ runChopReleaseCheck: h.runChop }))
vi.mock('@/lib/commissioner/scheduledAnnouncementService', () => ({ runScheduledAnnouncements: h.runScheduled }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  recordSyncJobRun: h.recordSyncJobRun,
}))

import { GET } from '@/app/api/cron/alert-sweep/route'

/**
 * Scheduled league announcements ride the 15-minute alert sweep: no flag (a commissioner pressed
 * Schedule), skippable per run, never on a single-user verification run, and a heartbeat only when a
 * post moved.
 */

const call = async (qs = '') => (await GET(new NextRequest(`https://example.test/api/cron/alert-sweep?${qs}`))).json()
const RUN = { ran: true, leagues: 3, sent: 2, failed: 0, refused: 1, staleFailed: 0, budgetStopped: false, errors: [] }

beforeEach(() => {
  vi.clearAllMocks()
  h.hydrate.mockResolvedValue({ injuredStarters: [], leaguesScanned: 0, feedStale: false })
  h.detect.mockReturnValue([])
  h.runLineupCheck.mockResolvedValue({ ran: false, reason: 'early', week: null, mainSlate: null })
  h.runWaiverCheck.mockResolvedValue({ ran: false, reason: 'early', week: null, firstKickoff: null })
  h.runSportWaiverCheck.mockResolvedValue({ ran: false, reason: 'closed', day: '2026-09-29', sports: {} })
  h.runScheduled.mockResolvedValue(RUN)
})

describe('alert sweep — scheduled announcements', () => {
  it('runs every sweep with no flag, and records a heartbeat when posts moved', async () => {
    const body = await call()
    expect(h.runScheduled).toHaveBeenCalledTimes(1)
    expect(h.runScheduled.mock.calls[0]![0]).toMatchObject({ dryRun: false })
    expect(body.scheduledAnnouncements).toMatchObject({ ran: true, sent: 2 })
    const hb = h.recordSyncJobRun.mock.calls.find((c) => c[0].jobName === 'cron-scheduled-announcements')
    expect(hb?.[1]).toMatchObject({ rowsRead: 3, rowsWritten: 2, rowsSkipped: 1, status: 'success' })
  })

  it('a quiet run writes no heartbeat', async () => {
    h.runScheduled.mockResolvedValue({ ...RUN, sent: 0, refused: 0 })
    await call()
    expect(h.recordSyncJobRun.mock.calls.map((c) => c[0].jobName)).not.toContain('cron-scheduled-announcements')
  })

  it('scheduledAnnouncements=off skips it; a single-user run never posts', async () => {
    expect((await call('scheduledAnnouncements=off')).scheduledAnnouncements).toEqual({ ran: false, reason: 'disabled' })
    expect((await call('userId=u1')).scheduledAnnouncements).toEqual({ ran: false, reason: 'disabled' })
    expect(h.runScheduled).not.toHaveBeenCalled()
  })

  it('dry run is passed through and writes no heartbeat; a throw never fails the sweep', async () => {
    await call('dryRun=1')
    expect(h.runScheduled.mock.calls[0]![0]).toMatchObject({ dryRun: true })
    expect(h.recordSyncJobRun).not.toHaveBeenCalled()
    h.runScheduled.mockRejectedValue(new Error('boom'))
    const body = await call()
    expect(body.ok).toBe(true)
    expect(body.scheduledAnnouncements).toEqual({ ran: false, reason: 'error', error: 'boom' })
  })
})
