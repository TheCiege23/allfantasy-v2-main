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
  fanOut: vi.fn(),
  teamSweep: vi.fn(),
  outcome: vi.fn(),
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
vi.mock('@/lib/chimmy-alerts/injuryFanOut', () => ({ buildFanOutLeagues: h.fanOut }))
vi.mock('@/lib/chimmy-alerts/runLineupCheck', () => ({ runLineupCheck: h.runLineupCheck }))
// Mocked, not left real: unmocked, it ran against the stub prisma above and failed into
// `{ reason: 'error' }` on every test — green, and exercising nothing.
vi.mock('@/lib/chimmy-alerts/runWaiverCheck', () => ({ runWaiverCheck: h.runWaiverCheck }))
vi.mock('@/lib/chimmy-alerts/runSportWaiverCheck', () => ({ runSportWaiverCheck: h.runSportWaiverCheck }))
// The followed-player free-agent phase (2026-10-08): mocked, so it never runs against the stub prisma above.
vi.mock('@/lib/follows/followFreeAgentDeps', () => ({ followFreeAgentDeps: {} }))
vi.mock('@/lib/follows/followFreeAgentCheck', () => ({ runFollowFreeAgentCheck: async () => ({ ran: false, reason: 'no_follows' }) }))
vi.mock('@/lib/core-app/teamWorkspaceSweep',()=>({runTeamWorkspaceSweep:h.teamSweep}))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>, summarize: (result: unknown) => unknown) => {const result=await fn();h.outcome(summarize(result));return result},
  recordSyncJobRun: h.recordSyncJobRun,
}))

import { GET } from '@/app/api/cron/alert-sweep/route'

/**
 * The injury fan-out in the sweep: ONE message per player covering every league he starts in, and
 * the first player not yet sent today — not only the most urgent one, which starved the rest.
 */

const alert = (leagueId: string, player: string, urgencySignal: number) => ({
  id: `a-${leagueId}-${player}`,
  class: 'lineup',
  type: 'injured_starter_before_lock',
  title: `${player} is Out and still starting`,
  message: `${player} starts for you in ${leagueId}.`,
  leagueId,
  urgencySignal,
  metadata: { playerName: player, designation: 'Out', minutesToLock: 45 },
})

const call = (qs: string) => GET(new NextRequest(`https://allfantasy.ai/api/cron/alert-sweep?${qs}`))

beforeEach(() => {
  vi.clearAllMocks()
  h.teamSweep.mockResolvedValue({nativeLeagues:0,swaps:0,alertsEvaluated:0,errors:0,budgetStopped:false,deliveryReceiptsChecked:0})
  h.hydrate.mockResolvedValue({ injuredStarters: [{}], leaguesScanned: 3, feedStale: false })
  h.loadPrefs.mockResolvedValue(null)
  h.findFirst.mockResolvedValue(null)
  h.dispatch.mockResolvedValue(undefined)
  h.fanOut.mockResolvedValue([])
  h.runLineupCheck.mockResolvedValue({ ran: false, reason: 'early', week: null, mainSlate: null })
  h.runWaiverCheck.mockResolvedValue({ ran: false, reason: 'early', week: null, firstKickoff: null })
  h.runSportWaiverCheck.mockResolvedValue({ ran: false, reason: 'closed', day: '2026-09-29', sports: {} })
})

describe('alert sweep — injury fan-out', () => {
  it('one player in two leagues is ONE message naming both, with the backup and fix link per league', async () => {
    h.detect.mockReturnValue([alert('L1', 'Tank Dell', 90), alert('L2', 'Tank Dell', 80)])
    h.fanOut.mockResolvedValue([
      { leagueId: 'L1', leagueName: 'KBFL', startName: 'Nico Collins', fixHref: 'https://sleeper.com/leagues/1/team', fixLabel: 'Open in Sleeper' },
      { leagueId: 'L2', leagueName: 'Home League', startName: null, fixHref: '/league/L2?view=team', fixLabel: 'Lineup' },
    ])
    await call('userId=u1')
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    const sent = h.dispatch.mock.calls[0]![0]
    expect(sent.title).toBe('Tank Dell is Out — still starting in 2 of your leagues')
    expect(sent.body).toContain('KBFL: start Nico Collins.')
    expect(sent.body).toContain('Home League: no bench player can come in for him.')
    expect(sent.emailOverride.html).toContain('Fix your lineup in KBFL')
    expect(h.fanOut.mock.calls[0]![1].map((a: { leagueId: string }) => a.leagueId)).toEqual(['L1', 'L2'])
  })

  it('🛑 the most urgent player already sent today does not starve the next one', async () => {
    h.detect.mockReturnValue([alert('L1', 'Jayden Reed', 95), alert('L2', 'Tank Dell', 70)])
    h.findFirst.mockImplementation(async ({ where }: { where: { sourceKey: string } }) =>
      where.sourceKey.includes('jayden-reed') ? { id: 'sent-earlier' } : null,
    )
    await call('userId=u1')
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0]![0].title).toBe('Tank Dell is Out and still starting')
  })

  it('every player already sent today: nothing goes out', async () => {
    h.detect.mockReturnValue([alert('L1', 'Jayden Reed', 95), alert('L2', 'Tank Dell', 70)])
    h.findFirst.mockResolvedValue({ id: 'sent-earlier' })
    await call('userId=u1')
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.fanOut).not.toHaveBeenCalled()
  })

  it('the per-league lookup failing still sends the detector message', async () => {
    h.detect.mockReturnValue([alert('L1', 'Tank Dell', 90)])
    h.fanOut.mockRejectedValue(new Error('impact read failed'))
    await call('userId=u1')
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0]![0]).toMatchObject({ title: 'Tank Dell is Out and still starting', body: 'Tank Dell starts for you in L1.' })
  })
})

it.each([[0,'success'],[1,'partial']])('persists Team sweep counters and marks %i internal errors as %s',async(errors,status)=>{
 vi.stubEnv('VAPID_PUBLIC_KEY','test-public')
 vi.stubEnv('VAPID_PRIVATE_KEY','test-private')
 h.detect.mockReturnValue([])
 h.teamSweep.mockResolvedValue({nativeLeagues:2,swaps:1,alertsEvaluated:3,errors,budgetStopped:true,deliveryReceiptsChecked:4,userId:'private-user'})
 try{
  const response=await call('')
  expect(response.status).toBe(200)
  expect(h.outcome).toHaveBeenCalledWith(expect.objectContaining({status,metadata:{teamWorkspace:{nativeLeagues:2,swaps:1,alertsEvaluated:3,errors,budgetStopped:true,deliveryReceiptsChecked:4}}}))
  expect(JSON.stringify(h.outcome.mock.calls)).not.toContain('private-user')
 }finally{vi.unstubAllEnvs()}
})
