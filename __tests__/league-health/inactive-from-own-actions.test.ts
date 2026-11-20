// @vitest-environment node
/**
 * A native league's "inactive" reads the MANAGER's own last action, not `Roster.updatedAt` (2026-11-20).
 *
 * `updatedAt` moves on every system write — autopilot included — so a manager who walked away kept looking
 * active for as long as AllFantasy kept managing their team. Pinned here:
 *   - only the team's own manager's saves count; a commissioner's override does not;
 *   - autopilot's claims (filed under the owner's id) are excluded in the SQL;
 *   - nothing on record is "not inactive", never "inactive";
 *   - imported leagues keep the synced timestamp;
 *   - the per-manager table and the hub's league count agree.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)

const h = vi.hoisted(() => ({
  platform: 'allfantasy' as string,
  saves: [] as Array<{ rosterId: string; actorUserId: string | null; _max: { createdAt: Date | null } }>,
  claims: [] as Array<{ rosterId: string; actorUserId: string | null; at: Date | null }>,
  claimSql: [] as string[],
  rosters: [] as Array<Record<string, unknown>>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const g = (rows: () => unknown[]) => ({ groupBy: async () => rows() })
  return {
    prisma: {
      league: {
        findUnique: async () => ({ starters: null, platform: h.platform }),
        findMany: async () => [{ id: 'L1', platform: h.platform, sport: 'NFL', season: 2026, settings: {}, rosters: h.rosters }],
      },
      roster: { findMany: async () => h.rosters },
      leagueTeam: { findMany: async () => [] },
      waiverClaim: g(() => []),
      waiverTransaction: g(() => []),
      afLeagueTrade: g(() => []),
      redraftWaiverClaim: g(() => []),
      redraftTradeProposal: g(() => []),
      afRosterMoveHistory: g(() => h.saves),
      redraftRosterMoveHistory: g(() => []),
      $queryRaw: async (q: Prisma.Sql) => {
        h.claimSql.push(q.strings.join('?'))
        return h.claims
      },
    },
  }
})

import { foldOwnerLastActions, loadOwnerLastActions } from '@/lib/commissioner-hub/ownerLastAction'
import { getLeagueManagerHealth } from '@/lib/commissioner-hub/managerHealth'

beforeEach(() => {
  h.platform = 'allfantasy'
  h.saves = []
  h.claims = []
  h.claimSql = []
  // Both rosters were written by the system yesterday: by `updatedAt`, nobody is inactive.
  h.rosters = [
    { id: 'r1', leagueId: 'L1', platformUserId: 'u1', managerUserId: null, playerData: {}, updatedAt: ago(1), redraftRosterId: null, faabRemaining: null },
    { id: 'r2', leagueId: 'L1', platformUserId: 'u2', managerUserId: null, playerData: {}, updatedAt: ago(1), redraftRosterId: null, faabRemaining: null },
  ]
})

describe('foldOwnerLastActions', () => {
  const rosters = [
    { id: 'r1', leagueId: 'L1', platformUserId: 'u1', managerUserId: 'm1', redraftRosterId: 'rr1' },
    { id: 'r2', leagueId: 'L1', platformUserId: 'u2' },
  ]

  it("counts the owner's and the running manager's own actions, latest first, and nobody else's", () => {
    const out = foldOwnerLastActions(rosters, {
      byActor: [
        { rosterId: 'r1', actorUserId: 'u1', at: ago(20) },
        { rosterId: 'r1', actorUserId: 'commish', at: ago(1) }, // a commissioner override is not the manager
        { rosterId: 'r2', actorUserId: 'u1', at: ago(1) }, // another team's manager
      ],
      byRedraftActor: [{ rosterId: 'rr1', actorUserId: 'm1', at: ago(10) }],
      owned: [],
      ownedRedraft: [],
    })
    expect(Math.round((Date.now() - out.get('r1')!.getTime()) / DAY)).toBe(10)
    expect(out.get('r2')).toBeNull()
  })

  it('counts owner-gated rows (trade proposals, redraft claims) for the team, and nothing is null', () => {
    const out = foldOwnerLastActions(rosters, {
      byActor: [],
      byRedraftActor: [],
      owned: [{ rosterId: 'r2', actorUserId: null, at: ago(3) }],
      ownedRedraft: [{ rosterId: 'rr1', actorUserId: null, at: ago(5) }],
    })
    expect(Math.round((Date.now() - out.get('r1')!.getTime()) / DAY)).toBe(5)
    expect(Math.round((Date.now() - out.get('r2')!.getTime()) / DAY)).toBe(3)
  })
})

describe('loadOwnerLastActions', () => {
  it("leaves autopilot's claims out in the SQL — they carry the owner's id", async () => {
    await loadOwnerLastActions([{ id: 'r1', leagueId: 'L1', platformUserId: 'u1' }])
    expect(h.claimSql[0]).toMatch(/COALESCE\(metadata->>'source', ''\) <> 'chimmy_autopilot'/)
  })
})

describe('the commissioner view of a native league', () => {
  it('a manager whose own last save was 20 days ago is inactive, however recently the system wrote', async () => {
    h.saves = [
      { rosterId: 'r1', actorUserId: 'u1', _max: { createdAt: ago(20) } },
      { rosterId: 'r2', actorUserId: 'u2', _max: { createdAt: ago(2) } },
    ]
    const out = await getLeagueManagerHealth('L1')
    expect(out.rows.find((r) => r.rosterId === 'r1')!.status).toBe('inactive')
    expect(out.rows.find((r) => r.rosterId === 'r2')!.status).toBe('active')
    expect(out.inactiveCount).toBe(1)
  })

  it('a manager with nothing on record is not called inactive', async () => {
    const out = await getLeagueManagerHealth('L1')
    for (const r of out.rows) {
      expect(r.status).not.toBe('inactive')
      expect(r.lastActionAt).toBeNull()
    }
  })

  it('an imported league keeps the synced timestamp', async () => {
    h.platform = 'sleeper'
    h.saves = [{ rosterId: 'r1', actorUserId: 'u1', _max: { createdAt: ago(20) } }]
    h.rosters = h.rosters.map((r) => (r.id === 'r1' ? { ...r, updatedAt: ago(30) } : r))
    const out = await getLeagueManagerHealth('L1')
    const r1 = out.rows.find((r) => r.rosterId === 'r1')!
    expect(r1.status).toBe('inactive')
    expect(Math.round((Date.now() - Date.parse(r1.lastActionAt!)) / DAY)).toBe(30)
  })
})

describe('the hub headline agrees with the table', () => {
  it('counts the same managers inactive from the same clock, and leaves imported leagues alone', async () => {
    const { buildCommissionerHealthSnapshot, nativeActionRosters, withOwnerActionClock } = await import('@/lib/commissioner-hub/commissionerHubHealth')
    h.saves = [
      { rosterId: 'r1', actorUserId: 'u1', _max: { createdAt: ago(20) } },
      { rosterId: 'r2', actorUserId: 'u2', _max: { createdAt: ago(2) } },
    ]
    const native = { id: 'L1', platform: 'allfantasy', sport: 'NFL', rosters: h.rosters as never }
    const imported = { id: 'L2', platform: 'sleeper', sport: 'NFL', rosters: h.rosters as never }
    const rosters = nativeActionRosters([native, imported])
    // Only the native league's rosters are read on the new clock.
    expect(rosters.map((r) => r.leagueId)).toEqual(['L1', 'L1'])
    const clocked = withOwnerActionClock([native, imported], await loadOwnerLastActions(rosters))

    const hub = buildCommissionerHealthSnapshot({ league: clocked[0]!, now: new Date(), source: 'database' })
    const table = await getLeagueManagerHealth('L1')
    expect(hub.metrics.inactiveTeams).toBe(1)
    expect(hub.metrics.inactiveTeams).toBe(table.inactiveCount)
    // The imported league is untouched: both rosters were synced yesterday.
    expect(clocked[1]).toBe(imported)
    // A failed read changes nothing rather than calling everyone active.
    expect(withOwnerActionClock([native], null)[0]).toBe(native)
  })
})
