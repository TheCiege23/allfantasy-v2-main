import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(), countLeagues: vi.fn(), countMembers: vi.fn(), create: vi.fn(), findNetwork: vi.fn(),
  ownedLeagues: vi.fn(), networks: vi.fn(), tasks: vi.fn(), history: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { count: mocks.countLeagues, findMany: mocks.ownedLeagues },
  commissionerNetworkMember: { count: mocks.countMembers },
  commissionerNetwork: { create: mocks.create, findFirst: mocks.findNetwork, findMany: mocks.networks },
  commissionerWorkspaceTask: { findMany: mocks.tasks },
  auditFeedEntry: { findMany: mocks.history },
} }))

import { GET, POST } from '@/app/api/commissioner/networks/route'

const request = (leagueIds: string[]) => new Request('http://localhost/api/commissioner/networks', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Circuit', leagueIds }),
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'owner-1' } })
  mocks.countLeagues.mockResolvedValue(2)
  mocks.countMembers.mockResolvedValue(0)
  mocks.create.mockResolvedValue({ id: 'network-1' })
  mocks.ownedLeagues.mockResolvedValue([])
  mocks.networks.mockResolvedValue([])
  mocks.tasks.mockResolvedValue([])
  mocks.history.mockResolvedValue([])
})

describe('commissioner network creation', () => {
  it('requires ownership of every member league', async () => {
    mocks.countLeagues.mockResolvedValue(1)
    const response = await POST(request(['league-a', 'league-b']))
    expect(response.status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('creates one host and named member leagues for the owner', async () => {
    const response = await POST(request(['league-a', 'league-b']))
    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: {
      ownerUserId: 'owner-1', name: 'Circuit', members: { create: [
        { leagueId: 'league-a', role: 'host' }, { leagueId: 'league-b', role: 'member' },
      ] },
    } }))
  })

  it('hides a transferred league and its work from the network read', async () => {
    mocks.ownedLeagues.mockResolvedValue([{ id: 'league-a', name: 'Owned', sport: 'NFL' }])
    mocks.networks.mockResolvedValue([{ id: 'network-1', name: 'Circuit', ownerUserId: 'owner-1', members: [
      { leagueId: 'league-a', role: 'host' }, { leagueId: 'league-transferred', role: 'member' },
    ] }])
    mocks.tasks.mockResolvedValue([{ id: 'task-1', leagueId: 'league-a', title: 'Review trade' }])
    const response = await GET()
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.networks[0].members).toHaveLength(1)
    expect(mocks.tasks).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ leagueId: { in: ['league-a'] } }) }))
  })
})
