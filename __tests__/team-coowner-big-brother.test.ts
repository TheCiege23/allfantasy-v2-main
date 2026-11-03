import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const h = vi.hoisted(() => ({ roster: vi.fn(), coOwner: vi.fn(), vote: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'co-user' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { roster: { findFirst: h.roster } } }))
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: h.coOwner }))
vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({ isBigBrotherLeague: vi.fn(async () => true) }))
vi.mock('@/lib/big-brother/BigBrotherVoteEngine', () => ({ submitEvictionVote: h.vote }))
import { POST } from '@/app/api/leagues/[leagueId]/big-brother/vote/route'
const request = () => new NextRequest('http://localhost/api/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cycleId: 'cycle', targetRosterId: 'target' }) })
describe('Big Brother co-owner voting', () => {
  beforeEach(() => { vi.clearAllMocks(); h.roster.mockResolvedValue(null); h.vote.mockResolvedValue({ ok: true }) })
  it('submits the accepted co-owner vote as the shared roster', async () => {
    h.coOwner.mockResolvedValue('shared-roster')
    const response = await POST(request(), { params: Promise.resolve({ leagueId: 'league' }) })
    expect(response.status).toBe(200)
    expect(h.vote).toHaveBeenCalledWith('cycle', 'shared-roster', 'target')
  })
  it('rejects a pending or revoked co-owner', async () => {
    h.coOwner.mockResolvedValue(null)
    const response = await POST(request(), { params: Promise.resolve({ leagueId: 'league' }) })
    expect(response.status).toBe(403)
    expect(h.vote).not.toHaveBeenCalled()
  })
})
