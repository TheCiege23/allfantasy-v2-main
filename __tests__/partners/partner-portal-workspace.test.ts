import { describe, expect, it, vi } from 'vitest'
import { buildPortalSources, loadPortalView, type BindingRow, type LeagueFacts, type PortalDeps } from '@/lib/partner-portal/workspace'

/**
 * The signed-in partner portal's read path (owner's decisions 2026-11-17). The safety argument: league ids come
 * ONLY out of the RLS-filtered bindings read, never from the caller; no membership is never a fallback tenant.
 */

const NOW = new Date('2026-11-17T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

const binding = (id: string, leagueId: string, provider = 'sleeper', over: Partial<BindingRow> = {}): BindingRow => ({
  id,
  leagueId,
  provider,
  status: 'OK',
  consecutiveFailures: 0,
  lastSyncedAt: daysAgo(0.01),
  lastErrorAt: null,
  lastErrorSummary: null,
  ...over,
})

const facts: LeagueFacts = {
  leagues: [
    { id: 'L-hot', name: 'Harbor City', sport: 'NFL' },
    { id: 'L-cold', name: 'Blue Ridge', sport: 'NFL' },
  ],
  snapshots: [
    { leagueId: 'L-hot', lastActivityAt: daysAgo(1), totalEvents: 900, openTradeProposals: 0 },
    { leagueId: 'L-cold', lastActivityAt: daysAgo(20), totalEvents: 300, openTradeProposals: 2 },
  ],
  managers: [
    ...Array.from({ length: 10 }, (_, i) => ({ leagueId: 'L-hot', managerKey: `h${i}`, lastActiveAt: daysAgo(2) })),
    ...Array.from({ length: 10 }, (_, i) => ({ leagueId: 'L-cold', managerKey: `c${i}`, lastActiveAt: daysAgo(i < 3 ? 5 : 30) })),
  ],
}

function deps(over: Partial<PortalDeps> = {}): PortalDeps & { readLeagueFacts: ReturnType<typeof vi.fn> } {
  return {
    resolveTenantsForUser: vi.fn(async () => [{ tenantId: 't-acme', role: 'TENANT_ADMIN' as const }]),
    authorizeRead: vi.fn(async () => true),
    readWorkspace: vi.fn(async () => ({ name: 'Acme Fantasy', bindings: [binding('b1', 'L-hot'), binding('b2', 'L-cold')] })),
    readLeagueFacts: vi.fn(async () => facts),
    now: () => NOW,
    ...over,
  } as PortalDeps & { readLeagueFacts: ReturnType<typeof vi.fn> }
}

const user = { id: 'u1', label: 'Sam' }

describe('loadPortalView', () => {
  it('🛑 no membership is "not a member" — never a fallback workspace, and nothing else is read', async () => {
    const d = deps({ resolveTenantsForUser: vi.fn(async () => []) })
    expect(await loadPortalView(user, d)).toEqual({ kind: 'not_member' })
    expect(d.authorizeRead).not.toHaveBeenCalled()
    expect(d.readWorkspace).not.toHaveBeenCalled()
    expect(d.readLeagueFacts).not.toHaveBeenCalled()
  })

  it('the tenancy layer being unreachable (no COMMISH_APP_URL, isolation refused) is a calm "unavailable"', async () => {
    const d = deps({ resolveTenantsForUser: vi.fn(async () => { throw new Error('isolation assertion failed') }) })
    expect(await loadPortalView(user, d)).toEqual({ kind: 'unavailable' })
    const d2 = deps({ readWorkspace: vi.fn(async () => { throw new Error('withTenant refused') }) })
    expect(await loadPortalView(user, d2)).toEqual({ kind: 'unavailable' })
  })

  it('a role the matrix refuses reads nothing', async () => {
    const d = deps({ authorizeRead: vi.fn(async () => false) })
    expect(await loadPortalView(user, d)).toEqual({ kind: 'forbidden' })
    expect(d.readWorkspace).not.toHaveBeenCalled()
  })

  it('🛑 league facts are read ONLY for leagues bound in the workspace, de-duplicated', async () => {
    const d = deps({
      readWorkspace: vi.fn(async () => ({ name: 'Acme', bindings: [binding('b1', 'L-hot'), binding('b2', 'L-hot', 'yahoo'), binding('b3', 'L-cold')] })),
    })
    const v = await loadPortalView(user, d)
    expect(d.readLeagueFacts).toHaveBeenCalledTimes(1)
    expect(d.readLeagueFacts.mock.calls[0]![0]).toEqual(['L-hot', 'L-cold'])
    expect(v.kind === 'ok' && v.leagues.map((l) => l.leagueId)).toEqual(['L-cold', 'L-hot'])
  })

  it('no linked leagues reads no league facts at all', async () => {
    const d = deps({ readWorkspace: vi.fn(async () => ({ name: 'Acme', bindings: [] })) })
    const v = await loadPortalView(user, d)
    expect(v.kind === 'ok' && v.leagues).toEqual([])
    expect(d.readLeagueFacts).not.toHaveBeenCalled()
  })

  it('health, status and action items come from the same functions the v1 API uses; worst first', async () => {
    const v = await loadPortalView(user, deps())
    expect(v.kind).toBe('ok')
    if (v.kind !== 'ok') return
    const [cold, hot] = v.leagues
    // Cold: last activity 20 days ago (recency 0) and 3 of 10 managers active (round(0.3*40)=12).
    expect(cold).toMatchObject({ name: 'Blue Ridge', healthScore: 12, status: 'stale', activeManagers: 3, totalManagers: 10, daysSinceLastActivity: 20 })
    expect(cold!.actionItems.map((i) => i.kind)).toEqual(['pending_trades', 'stale_league', 'inactive_managers'])
    // Hot: active yesterday (60) and every manager active (40).
    expect(hot).toMatchObject({ name: 'Harbor City', healthScore: 100, status: 'healthy' })
    expect(v.summary).toMatchObject({ leagues: 2, managers: 20, activeManagers: 13, activePct: 65, needsAttention: 1 })
    expect(v.workspaceName).toBe('Acme Fantasy')
    expect(v.otherWorkspaces).toBe(0)
  })

  it('a second membership is reported, and the FIRST is shown (never a merge across workspaces)', async () => {
    const d = deps({
      resolveTenantsForUser: vi.fn(async () => [
        { tenantId: 't-acme', role: 'TENANT_SUPPORT' as const },
        { tenantId: 't-other', role: 'TENANT_OWNER' as const },
      ]),
    })
    const v = await loadPortalView(user, d)
    expect(d.readWorkspace).toHaveBeenCalledWith('t-acme')
    expect(v.kind === 'ok' && v.otherWorkspaces).toBe(1)
  })
})

describe('buildPortalSources', () => {
  it('a source is as fresh as its stalest league, and never-synced leagues are counted, not averaged away', () => {
    const rows = buildPortalSources(
      [
        binding('b1', 'L1', 'sleeper', { lastSyncedAt: daysAgo(0.1) }),
        binding('b2', 'L2', 'sleeper', { lastSyncedAt: daysAgo(2) }),
        binding('b3', 'L3', 'sleeper', { lastSyncedAt: null, status: 'IDLE' }),
        binding('b4', 'L4', 'espn', { lastSyncedAt: daysAgo(0.5) }),
      ],
      NOW,
    )
    expect(rows.map((r) => [r.provider, r.leagues, r.neverSynced])).toEqual([
      ['sleeper', 3, 1],
      ['espn', 1, 0],
    ])
    expect(rows[0]!.lastSyncedAt).toBe(daysAgo(2).toISOString())
  })
})
