import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const h = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), league: vi.fn(), contest: vi.fn(), advance: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.league }, bestBallContest: { findFirst: h.contest } } }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerOnly: h.permission }))
vi.mock('@/lib/bestball/contestEngine', () => ({ advancePodWinners: h.advance }))
import { POST } from '@/app/api/bestball/contest/advance/route'
const request = (roundNumber: unknown = 1) => new NextRequest('http://localhost/api/bestball/contest/advance', { method: 'POST', body: JSON.stringify({ contestId: 'contest-a', leagueId: 'league-a', roundNumber }) })
beforeEach(() => {
  vi.resetAllMocks()
  h.session.mockResolvedValue({ user: { id: 'commissioner' } })
  h.permission.mockResolvedValue(undefined)
  h.league.mockResolvedValue({ bbContestId: 'contest-a', bbTiebreaker: 'max_week' })
  h.contest.mockResolvedValue({ id: 'contest-a' })
  h.advance.mockResolvedValue(undefined)
})
describe('commissioner best-ball advancement boundary', () => {
  it('requires the contest to belong to the authorized league', async () => {
    h.league.mockResolvedValue({ bbContestId: 'different-contest' })
    expect((await POST(request())).status).toBe(403)
    expect(h.advance).not.toHaveBeenCalled()
  })
  it('uses the saved tie choice when advancing the linked contest', async () => {
    expect((await POST(request())).status).toBe(200)
    expect(h.advance).toHaveBeenCalledWith('contest-a', 1, 'max_week')
  })
  it.each([0, -1, 1.5, '2'])('refuses invalid round %s before mutation', async round => {
    expect((await POST(request(round))).status).toBe(400)
    expect(h.advance).not.toHaveBeenCalled()
  })
  it('reports incomplete scoring without claiming advancement succeeded', async () => {
    h.advance.mockRejectedValue(new Error('Round scoring is incomplete'))
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('Round scoring is incomplete')
  })
})
