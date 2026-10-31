/**
 * The routes around Chimmy as a manager: assigning a real manager takes Chimmy off at once, and both
 * "Assign AI manager" buttons hand the team to Chimmy for the season through the one switch — the
 * orphan-teams one no longer rewrites the owner to `ai-manager-…`, which the draft stopped recognising.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  apply: vi.fn(async () => ({ ok: true, managed: true, style: 'dynasty_owner' }) as Record<string, unknown>),
  endForNewOwners: vi.fn(async () => ['r1']),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn(async () => {}) }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn(async () => 'commissioner') }))
vi.mock('@/lib/league/tournamentCoCommissioners', () => ({ tournamentCoCommissionerIds: vi.fn(async () => new Set()) }))
vi.mock('@/lib/discovery-analytics/server', () => ({ trackDiscoveryOrphanAdoption: vi.fn(async () => {}) }))
vi.mock('@/lib/league/leagueSeats', () => ({ assignLeagueSeat: vi.fn(async () => ({ ok: true })), releaseLeagueSeat: vi.fn() }))
vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ applyChimmyAutopilot: h.apply, endManagedForNewOwners: h.endForNewOwners }))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({ getOrphanRosterIdsForLeague: vi.fn(async () => ['r1']), isOrphanPlatformUserId: (id: string) => id.startsWith('orphan-') }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
    league: { findUnique: vi.fn(async () => ({ name: 'Blah League' })) },
    roster: {
      findFirst: vi.fn(async () => ({ id: 'r1', platformUserId: 'orphan-r1', settings: {} })),
      update: vi.fn(async (args: Record<string, unknown>) => { h.updates.push(args); return {} }),
    },
    leagueTeam: { updateMany: vi.fn(async () => ({ count: 1 })) },
    findLeagueListing: { updateMany: vi.fn(async () => ({ count: 1 })) },
  },
}))

import { PATCH as assignManager } from '@/app/api/commissioner/leagues/[leagueId]/managers/route'
import { POST as orphanAssignAi } from '@/app/api/leagues/[leagueId]/orphaned-teams/assign-ai/route'

const req = (body: unknown) => new Request('https://x', { method: 'POST', body: JSON.stringify(body) }) as never
const params = { params: Promise.resolve({ leagueId: 'L' }) }

beforeEach(() => {
  h.updates = []
  h.apply.mockClear()
  h.endForNewOwners.mockClear()
})

describe('Chimmy hand-back and hand-over routes', () => {
  it('assigning a real manager to a team ends Chimmy at once', async () => {
    const res = await assignManager(req({ rosterId: 'r1', userId: 'new-person' }), params)
    expect(res.status).toBe(200)
    expect(h.endForNewOwners).toHaveBeenCalledWith('L', 'commish', 'Blah League')
  })

  it('the orphan-teams "Assign AI" hands the seat to Chimmy and keeps it an empty seat', async () => {
    const res = await orphanAssignAi(req({ rosterId: 'r1' }), { params: Promise.resolve({ leagueId: 'L' }) })
    expect(res.status).toBe(200)
    expect(h.apply).toHaveBeenCalledWith('L', 'commish', 'r1', undefined)
    expect(JSON.stringify(h.updates)).not.toContain('ai-manager-')
    expect(h.updates[0]).toMatchObject({ where: { id: 'r1' } })
    expect((h.updates[0].data as Record<string, unknown>).platformUserId).toBeUndefined()
  })

  it('the orphan-teams "Assign AI" refuses past the limit and changes nothing', async () => {
    h.apply.mockResolvedValueOnce({ ok: false, status: 409, error: 'Chimmy can run up to 4 teams in a league.' })
    const res = await orphanAssignAi(req({ rosterId: 'r1' }), { params: Promise.resolve({ leagueId: 'L' }) })
    expect(res.status).toBe(409)
    expect(h.updates).toEqual([])
  })
})
