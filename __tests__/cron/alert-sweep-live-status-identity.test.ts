import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import {
  planLiveFold,
  sleeperIdentities,
  type SleeperIdentityRow,
} from '@/lib/chimmy-alerts/liveStatusFold'

/*
 * The game-window Sleeper fold named the wrong player (founder-reported 2026-10-11).
 *
 * Sleeper said player 8394 is Out. The fold looked 8394 up as a bare
 * `SportsPlayer.externalId`, found Rolling Insights' player 8394 — Rome Odunze —
 * and wrote "Rome Odunze · Out". Sleeper's 8394 is Percy Butler. Every live row on
 * file was misnamed the same way (50 of 50). These rows are the measured ones.
 */

const PLAYERS: Array<SleeperIdentityRow & { sport: string }> = [
  // Rolling Insights' own id space: 8394 is Odunze there.
  { sport: 'NFL', source: 'rolling_insights', externalId: '8394', sleeperId: '11620', name: 'Rome Odunze', team: 'Chicago Bears', position: 'WR' },
  { sport: 'NFL', source: 'sleeper', externalId: 'sleeper:11620', sleeperId: '11620', name: 'Rome Odunze', team: 'Chicago Bears', position: 'WR' },
  { sport: 'NFL', source: 'sleeper', externalId: 'sleeper:8394', sleeperId: '8394', name: 'Percy Butler', team: 'Washington Commanders', position: 'DB' },
  // Lamar Jackson's Out was filed under Amani Hooker, RI's 4881.
  { sport: 'NFL', source: 'rolling_insights', externalId: '4881', sleeperId: null, name: 'Amani Hooker', team: 'Tennessee Titans', position: 'DB' },
  { sport: 'NFL', source: 'sleeper', externalId: 'sleeper:4881', sleeperId: '4881', name: 'Lamar Jackson', team: 'Baltimore Ravens', position: 'QB' },
]

describe('sleeperIdentities', () => {
  it('🛑 a Sleeper id is never read as another provider\'s externalId', () => {
    const ids = sleeperIdentities(['8394', '4881'], PLAYERS)
    expect(ids.get('8394')?.name).toBe('Percy Butler')
    expect(ids.get('4881')?.name).toBe('Lamar Jackson')
  })

  it('reads a non-Sleeper row only through its sleeperId column', () => {
    const riOnly = PLAYERS.filter((r) => r.source === 'rolling_insights')
    expect(sleeperIdentities(['11620'], riOnly).get('11620')?.name).toBe('Rome Odunze')
    // RI 8394 carries sleeperId 11620, so it says nothing about Sleeper 8394.
    expect(sleeperIdentities(['8394'], riOnly).has('8394')).toBe(false)
  })

  it("Sleeper's own row wins over a provider row that disagrees", () => {
    const rows: SleeperIdentityRow[] = [
      { source: 'thesportsdb', externalId: 'tsdb_1', sleeperId: '8394', name: 'Someone Else', team: null, position: null },
      { source: 'sleeper', externalId: 'sleeper:8394', sleeperId: '8394', name: 'Percy Butler', team: 'Washington Commanders', position: 'DB' },
    ]
    expect(sleeperIdentities(['8394'], rows).get('8394')?.name).toBe('Percy Butler')
  })

  it('refuses an id whose provider rows disagree and no Sleeper row settles it', () => {
    const rows: SleeperIdentityRow[] = [
      { source: 'thesportsdb', externalId: 'tsdb_1', sleeperId: '777', name: 'Player One', team: null, position: null },
      { source: 'rolling_insights', externalId: '9', sleeperId: '777', name: 'Player Two', team: null, position: null },
    ]
    expect(sleeperIdentities(['777'], rows).has('777')).toBe(false)
    // …and accepts them when they agree.
    rows[1]!.name = 'player one '
    expect(sleeperIdentities(['777'], rows).get('777')?.name).toBe('Player One')
  })

  it('skips nameless rows and ids nobody asked about', () => {
    const rows: SleeperIdentityRow[] = [
      { source: 'sleeper', externalId: 'sleeper:1', sleeperId: '1', name: '  ', team: null, position: null },
      { source: 'sleeper', externalId: 'sleeper:2', sleeperId: '2', name: 'Not Asked', team: null, position: null },
    ]
    expect([...sleeperIdentities(['1'], rows).keys()]).toEqual([])
  })
})

describe('planLiveFold', () => {
  const URGENT = new Set(['out', 'doubtful'])
  const who = (name: string, team: string | null) => ({ name, team, position: null })

  it('keeps Out/Doubtful for named ids only, trimming the word', () => {
    const plan = planLiveFold(
      new Map([['1', ' Out '], ['2', 'Questionable'], ['3', 'Doubtful'], ['4', 'Out']]),
      new Map([['1', who('A', 'X')], ['2', who('B', 'X')], ['3', who('C', 'X')]]),
      URGENT,
      400,
    )
    expect(plan.map((r) => [r.sleeperId, r.status, r.name])).toEqual([
      ['1', 'Out', 'A'],
      ['3', 'Doubtful', 'C'],
    ])
  })

  it('caps AFTER naming, players with a team first, so stale retired ids cannot spend the budget', () => {
    const plan = planLiveFold(
      new Map([['10', 'Out'], ['11', 'Out'], ['99999', 'Out']]),
      new Map([['10', who('Retired One', null)], ['11', who('Retired Two', null)], ['99999', who('Rookie', 'Chicago Bears')]]),
      URGENT,
      2,
    )
    expect(plan.map((r) => r.name)).toEqual(['Rookie', 'Retired One'])
  })
})

/* ── The route, end to end, against a fake that applies the WHERE it is given ── */

const h = vi.hoisted(() => ({
  statuses: new Map<string, string>(),
  players: [] as Array<Record<string, unknown>>,
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}))

type Where = Record<string, unknown> & { OR?: Where[] }
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((w) => matches(row, w))
    if (cond && typeof cond === 'object' && 'in' in cond) return (cond as { in: unknown[] }).in.includes(row[key])
    return row[key] === cond
  })
}

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { count: async () => 1 },
    sportsPlayer: { findMany: async ({ where }: { where: Where }) => h.players.filter((r) => matches(r, where)) },
    sportsInjury: { deleteMany: h.deleteMany, findMany: async () => [], upsert: h.upsert },
    webPushSubscription: { findMany: async () => [] },
    leagueTeam: { findMany: async () => [] },
    appUser: { count: async () => 0 },
    platformNotification: { findFirst: async () => null },
  },
}))
vi.mock('@/lib/autocoach/status-sources/SleeperStatusAdapter', () => ({ fetchSleeperStatuses: async () => h.statuses }))
vi.mock('@/lib/chimmy-alerts/hydrateInjuredStarters', () => ({ hydrateInjuredStarters: async () => ({ injuredStarters: [], leaguesScanned: 0, feedStale: false }) }))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertDetectors', () => ({ detectInjuredStarterAlerts: () => [] }))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertPreferencesService', () => ({ loadChimmyAlertPreferences: async () => null }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: async () => undefined }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: async () => [] }))
vi.mock('@/lib/notifications/pushGate', () => ({ decidePushForUser: async () => ({ allowed: false, reason: 'test' }) }))
vi.mock('@/lib/chimmy-alerts/injuryFanOut', () => ({ buildFanOutLeagues: async () => [] }))
vi.mock('@/lib/chimmy-alerts/runLineupCheck', () => ({ runLineupCheck: async () => ({ ran: false, reason: 'early', week: null, mainSlate: null }) }))
vi.mock('@/lib/chimmy-alerts/runWaiverCheck', () => ({ runWaiverCheck: async () => ({ ran: false, reason: 'early', week: null, firstKickoff: null }) }))
vi.mock('@/lib/chimmy-alerts/runSportWaiverCheck', () => ({ runSportWaiverCheck: async () => ({ ran: false, reason: 'closed', day: '2026-10-11', sports: {} }) }))
vi.mock('@/lib/follows/followFreeAgentDeps', () => ({ followFreeAgentDeps: {} }))
vi.mock('@/lib/follows/followFreeAgentCheck', () => ({ runFollowFreeAgentCheck: async () => ({ ran: false, reason: 'no_follows' }) }))
vi.mock('@/lib/core-app/teamWorkspaceSweep', () => ({
  runTeamWorkspaceSweep: async () => ({ nativeLeagues: 0, swaps: 0, alertsEvaluated: 0, errors: 0, budgetStopped: false, deliveryReceiptsChecked: 0 }),
}))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  recordSyncJobRun: async () => undefined,
}))

import { GET } from '@/app/api/cron/alert-sweep/route'

describe('alert sweep — live Sleeper fold names the player Sleeper meant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.players = PLAYERS
    h.statuses = new Map([['8394', 'Out'], ['4881', 'Out'], ['11620', 'Active']])
  })

  it('🛑 Sleeper 8394 Out is written as Percy Butler, and nothing is written for Rome Odunze', async () => {
    await GET(new NextRequest('https://allfantasy.ai/api/cron/alert-sweep'))
    const written = h.upsert.mock.calls.map((c) => [c[0].create.externalId, c[0].create.playerName, c[0].update.playerName])
    expect(written).toEqual(
      expect.arrayContaining([
        ['8394', 'Percy Butler', 'Percy Butler'],
        ['4881', 'Lamar Jackson', 'Lamar Jackson'],
      ]),
    )
    expect(written.flat()).not.toContain('Rome Odunze')
    expect(written.flat()).not.toContain('Amani Hooker')
  })

  it('clears every live row the pass does not rewrite — including an id it can no longer name', async () => {
    h.players = PLAYERS.filter((r) => r.externalId !== 'sleeper:4881')
    await GET(new NextRequest('https://allfantasy.ai/api/cron/alert-sweep'))
    expect(h.deleteMany).toHaveBeenCalledWith({
      where: { sport: 'NFL', source: 'sleeper_live', externalId: { notIn: ['8394'] } },
    })
  })
})
