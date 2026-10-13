/**
 * Commish tools: Edit Waiver (FAAB + claim priority) and Transfer commish.
 *
 * Edit Waiver writes the two Roster columns the claim engine reads, so priorities must stay a
 * permutation of 1..N. Transfer must move the `isCommissioner` team flag WITH `League.userId` —
 * `getLeagueRole` honours either, so moving only the owner left the old head with full powers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    session: 'u-head' as string | null,
    role: 'commissioner' as string | null,
    headOk: true,
    league: { id: 'L1', userId: 'u-head', waiverBudget: 100 },
    rosters: [] as Array<{ id: string; platformUserId: string; faabRemaining: number | null; waiverPriority: number | null }>,
    teams: [] as Array<{ claimedByUserId: string; isCommissioner: boolean; isCoCommissioner: boolean }>,
    audit: [] as Array<Record<string, unknown>>,
  }
  const prisma = {
    league: {
      findUnique: vi.fn(async () => ({ ...state.league })),
      update: vi.fn(async ({ data }: { data: { userId: string } }) => Object.assign(state.league, data)),
    },
    roster: {
      findMany: vi.fn(async ({ where }: { where: { NOT?: { platformUserId: string } } }) =>
        state.rosters.filter((r) => r.platformUserId !== where.NOT?.platformUserId).map((r) => ({ ...r })),
      ),
      findFirst: vi.fn(async ({ where }: { where: { platformUserId: string } }) =>
        state.rosters.find((r) => r.platformUserId === where.platformUserId) ?? null,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, number> }) =>
        Object.assign(state.rosters.find((r) => r.id === where.id)!, data),
      ),
    },
    leagueTeam: {
      updateMany: vi.fn(async ({ where, data }: { where: { claimedByUserId: string | { in: string[] } }; data: Record<string, boolean> }) => {
        const match = (id: string) => (typeof where.claimedByUserId === 'string' ? id === where.claimedByUserId : where.claimedByUserId.in.includes(id))
        for (const t of state.teams) if (match(t.claimedByUserId)) Object.assign(t, data)
        return { count: 1 }
      }),
    },
    appUser: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, displayName: id === 'u-b' ? 'Bee' : null, username: id })),
      ),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  return { state, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => (h.state.session ? { user: { id: h.state.session } } : null)) }))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: vi.fn(async () => h.state.role),
  isCommissionerRole: (r: string | null) => r === 'commissioner' || r === 'co_commissioner',
}))
vi.mock('@/lib/commissioner/permissions', () => ({
  assertCommissioner: vi.fn(async () => {
    if (!h.state.headOk) throw new Error('Forbidden')
  }),
}))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({
  buildRosterLabelMap: vi.fn(async () => new Map(h.state.rosters.map((r) => [r.id, `Team ${r.platformUserId}`]))),
}))
vi.mock('@/server/services/auditService', () => ({
  logAction: vi.fn(async (input: Record<string, unknown>) => {
    h.state.audit.push(input)
    return { id: 'a1' }
  }),
}))

import { validateWaiverUpdates } from '@/app/api/leagues/[leagueId]/commish-waivers/handler'

const params = { params: { leagueId: 'L1' } }
const req = (method: string, body?: unknown) =>
  new Request('http://localhost/x', { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }) as never

beforeEach(() => {
  h.state.session = 'u-head'
  h.state.role = 'commissioner'
  h.state.headOk = true
  h.state.league = { id: 'L1', userId: 'u-head', waiverBudget: 100 }
  h.state.rosters = [
    { id: 'r1', platformUserId: 'u-head', faabRemaining: 100, waiverPriority: 1 },
    { id: 'r2', platformUserId: 'u-b', faabRemaining: 80, waiverPriority: 2 },
    { id: 'r3', platformUserId: 'u-c', faabRemaining: 50, waiverPriority: 3 },
  ]
  h.state.teams = [
    { claimedByUserId: 'u-head', isCommissioner: true, isCoCommissioner: false },
    { claimedByUserId: 'u-b', isCommissioner: false, isCoCommissioner: true },
  ]
  h.state.audit = []
})

describe('validateWaiverUpdates', () => {
  const cur = [
    { id: 'r1', waiverPriority: 1 },
    { id: 'r2', waiverPriority: 2 },
    { id: 'r3', waiverPriority: 3 },
  ]
  it('accepts a swap and a FAAB edit inside the budget', () => {
    expect(validateWaiverUpdates([{ rosterId: 'r1', waiverPriority: 2 }, { rosterId: 'r2', waiverPriority: 1, faabRemaining: 100 }], cur, 100)).toBeNull()
  })
  it.each([
    [[{ rosterId: 'r1', waiverPriority: 2 }], 'exactly once'], // leaves two teams at 2
    [[{ rosterId: 'r1', waiverPriority: 4 }], 'exactly once'], // out of 1..N
    [[{ rosterId: 'r1', faabRemaining: 101 }], 'budget'],
    [[{ rosterId: 'r1', faabRemaining: -1 }], '0 or more'],
    [[{ rosterId: 'zz', faabRemaining: 1 }], 'Unknown team'],
    [[{ rosterId: 'r1', faabRemaining: 1 }, { rosterId: 'r1', faabRemaining: 2 }], 'twice'],
  ])('refuses %j', (updates, msg) => {
    expect(validateWaiverUpdates(updates, cur, 100)).toContain(msg)
  })
})

describe('Edit Waiver route', () => {
  it('refuses a member', async () => {
    h.state.role = 'member'
    const { PATCH } = await import('@/app/api/leagues/[leagueId]/commish-waivers/handler')
    expect((await PATCH(req('PATCH', { updates: [{ rosterId: 'r1', faabRemaining: 1 }] }), params)).status).toBe(403)
    expect(h.state.rosters[0]!.faabRemaining).toBe(100)
  })

  it('lets a co-commish swap priorities, writes the engine columns and audits before/after', async () => {
    h.state.role = 'co_commissioner'
    const { PATCH } = await import('@/app/api/leagues/[leagueId]/commish-waivers/handler')
    const res = await PATCH(req('PATCH', { updates: [{ rosterId: 'r1', waiverPriority: 3 }, { rosterId: 'r3', waiverPriority: 1 }] }), params)
    expect(res.status).toBe(200)
    expect(h.state.rosters.map((r) => r.waiverPriority)).toEqual([3, 2, 1])
    expect(h.state.audit[0]).toMatchObject({ actionType: 'commish_edit_waivers', beforeState: [{ rosterId: 'r1', waiverPriority: 1 }, { rosterId: 'r3', waiverPriority: 3 }] })
    expect((await res.json()).teams[0]).toMatchObject({ rosterId: 'r3', waiverPriority: 1 })
  })

  it('refuses a priority edit that breaks the 1..N order, writing nothing', async () => {
    const { PATCH } = await import('@/app/api/leagues/[leagueId]/commish-waivers/handler')
    expect((await PATCH(req('PATCH', { updates: [{ rosterId: 'r1', waiverPriority: 2 }] }), params)).status).toBe(400)
    expect(h.state.rosters.map((r) => r.waiverPriority)).toEqual([1, 2, 3])
  })
})

describe('Transfer commish route', () => {
  it('lists other managers with a roster, by name, never the caller', async () => {
    const { GET } = await import('@/app/api/commissioner/leagues/[leagueId]/transfer/route')
    const body = await (await GET(req('GET'), { params: Promise.resolve({ leagueId: 'L1' }) })).json()
    expect(body.candidates).toEqual([
      { userId: 'u-c', name: '@u-c' },
      { userId: 'u-b', name: 'Bee' },
    ].sort((a, b) => a.name.localeCompare(b.name)))
  })

  it('moves the commish team flag WITH the owner, so the old head loses the role', async () => {
    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/transfer/route')
    const res = await POST(req('POST', { newCommissionerUserId: 'u-b', confirm: true }), { params: Promise.resolve({ leagueId: 'L1' }) })
    expect(res.status).toBe(200)
    expect(h.state.league.userId).toBe('u-b')
    expect(h.state.teams).toEqual([
      { claimedByUserId: 'u-head', isCommissioner: false, isCoCommissioner: false },
      { claimedByUserId: 'u-b', isCommissioner: true, isCoCommissioner: false },
    ])
    expect(h.state.audit[0]).toMatchObject({ actionType: 'commish_transfer', afterState: { headCommishUserId: 'u-b' } })
  })

  it('refuses a co-commish (head only) and requires confirmation', async () => {
    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/transfer/route')
    expect((await POST(req('POST', { newCommissionerUserId: 'u-b' }), { params: Promise.resolve({ leagueId: 'L1' }) })).status).toBe(400)
    h.state.headOk = false
    expect((await POST(req('POST', { newCommissionerUserId: 'u-b', confirm: true }), { params: Promise.resolve({ leagueId: 'L1' }) })).status).toBe(403)
    expect(h.state.league.userId).toBe('u-head')
  })
})
