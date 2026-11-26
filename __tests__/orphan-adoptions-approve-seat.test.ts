import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Approving an orphan adoption must go through the one seat-assignment path (assignLeagueSeat), which
 * moves Roster, LeagueTeam AND RedraftRoster.ownerId. The route used to write Roster + LeagueTeam by
 * hand, so an adopted native redraft team stayed owned by its orphan key for the rest of the season.
 */

const h = vi.hoisted(() => {
  const request = {
    id: 'req-1',
    rosterId: 'roster-1',
    userId: 'adopter',
    requesterName: 'Adopter',
    status: 'pending',
    createdAt: '2026-11-25T00:00:00.000Z',
  }
  const tx = {
    league: { findUnique: vi.fn(async () => ({ id: 'L1', settings: { orphanAdoptionRequests: [request] } })), update: vi.fn() },
    roster: { findFirst: vi.fn(async () => ({ id: 'roster-1', platformUserId: 'orphan-roster-1' })), update: vi.fn() },
    leagueTeam: { updateMany: vi.fn() },
  }
  return { tx, assignLeagueSeat: vi.fn() }
})

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/commissionerAccess', () => ({ commissionerAccessResponse: vi.fn(async () => null) }))
vi.mock('@/lib/discovery-analytics/server', () => ({ trackDiscoveryOrphanAdoption: vi.fn() }))
vi.mock('@/lib/orphan-marketplace', () => ({
  getOrphanAdoptionRequests: (settings: { orphanAdoptionRequests: unknown[] }) => [...settings.orphanAdoptionRequests],
  withOrphanAdoptionRequests: (_s: unknown, requests: unknown[]) => ({ orphanAdoptionRequests: requests }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn(h.tx) } }))
vi.mock('@/lib/league/leagueSeats', () => ({ assignLeagueSeat: h.assignLeagueSeat }))

import { PATCH } from '@/app/api/commissioner/leagues/[leagueId]/orphan-adoptions/route'

function patch(body: Record<string, unknown>) {
  return PATCH({ json: async () => body } as never, { params: Promise.resolve({ leagueId: 'L1' }) })
}

beforeEach(() => {
  h.assignLeagueSeat.mockReset()
  h.tx.roster.update.mockClear()
  h.tx.leagueTeam.updateMany.mockClear()
})

describe('approving an orphan adoption', () => {
  it('hands the seat over through assignLeagueSeat, not hand-written roster updates', async () => {
    h.assignLeagueSeat.mockResolvedValue({ ok: true, rosterId: 'roster-1', teamNumber: 3, alreadyHeld: false })
    const res = await patch({ requestId: 'req-1', decision: 'approve' })
    expect(res.status).toBe(200)
    expect(h.assignLeagueSeat).toHaveBeenCalledWith(h.tx, { leagueId: 'L1', rosterId: 'roster-1', userId: 'adopter' })
    expect(h.tx.roster.update).not.toHaveBeenCalled()
    expect(h.tx.leagueTeam.updateMany).not.toHaveBeenCalled()
  })

  it('refuses with 409 when the adopter already holds a team', async () => {
    h.assignLeagueSeat.mockResolvedValue({ ok: false, code: 'ALREADY_HOLDS_ROSTER', message: 'You already hold a team in this league.' })
    const res = await patch({ requestId: 'req-1', decision: 'approve' })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('Requester already manages a team in this league.')
  })
})
