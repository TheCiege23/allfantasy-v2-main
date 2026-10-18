// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  session: vi.fn(), commissioner: vi.fn(), hostGuard: vi.fn(), finish: vi.fn(),
  db: {
    league: { findUnique: vi.fn() },
    survivorTribalCouncil: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => false }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueCommissioner: m.commissioner, assertLeagueMember: vi.fn() }))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: m.hostGuard }))
vi.mock('@/lib/survivor/survivorPrivateVoteCommand', () => ({ submitPrivateVoteCommand: vi.fn() }))
vi.mock('@/lib/survivor/votingEngine', () => ({ lockVoting: vi.fn(), openTribalCouncil: vi.fn() }))
vi.mock('@/lib/survivor/idolEngine', () => ({ playIdol: vi.fn() }))
vi.mock('@/lib/survivor/rocksEngine', () => ({ executeRocksDraw: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorChatMembershipService', () => ({ removeRosterFromTribeChat: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorExileEngine', () => ({ enrollInExile: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorJuryEngine', () => ({ enrollJuryMember: vi.fn(), shouldJoinJury: vi.fn() }))
vi.mock('@/lib/survivor/survivorCouncilReadFinish', () => ({ finishCouncilReadIfComplete: m.finish }))
vi.mock('@/lib/survivor/leagueChatPoster', () => ({ postLeagueRevealFollowUp: vi.fn(), postScrollRevealToTribeChat: vi.fn() }))
import { POST } from '@/app/api/survivor/tribal/route'

const sequence = [
  { order: 0, targetName: 'Alpha', status: 'counts', isExtraVote: false },
  { order: 1, targetName: 'Bravo', status: 'counts', isExtraVote: false },
  { order: 2, targetName: 'Alpha', status: 'counts', isExtraVote: false },
]
const post = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/survivor/tribal', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'host' } })
  m.commissioner.mockResolvedValue({ ok: true })
  m.hostGuard.mockResolvedValue(null)
  m.db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'commissioner' })
})

describe('reveal_next paces the read without mutating the sequence', () => {
  it('advances revealStep and never rewrites revealSequence, so Replay keeps every ballot', async () => {
    m.db.survivorTribalCouncil.findUnique.mockResolvedValue({ revealSequence: sequence, isRevealed: true, revealStartsAt: new Date(Date.now() - 1000), revealStep: 1 })
    const res = await post({ leagueId: 'l1', action: 'reveal_next', councilId: 'c1' })
    expect(await res.json()).toEqual({ revealStep: 2, visibleSteps: 2, totalSteps: 3, remaining: 1 })
    expect(m.db.survivorTribalCouncil.update).toHaveBeenCalledTimes(1)
    const data = m.db.survivorTribalCouncil.update.mock.calls[0][0].data
    expect(data).toEqual({ revealStep: 2 })
    expect(data).not.toHaveProperty('revealSequence')
    expect(data).not.toHaveProperty('isRevealed')
    // Not the last ballot: the verdict and the elimination stay unpublished.
    expect(m.finish).not.toHaveBeenCalled()
  })

  it('publishes the verdict and resolves the elimination only when the last ballot is released', async () => {
    m.db.survivorTribalCouncil.findUnique.mockResolvedValue({ revealSequence: sequence, isRevealed: true, revealStartsAt: new Date(Date.now() - 1000), revealStep: 2 })
    const res = await post({ leagueId: 'l1', action: 'reveal_next', councilId: 'c1' })
    expect(await res.json()).toMatchObject({ revealStep: 3, remaining: 0 })
    expect(m.finish).toHaveBeenCalledWith('l1', 'c1', 'host')
  })

  it('refuses to start an unpublished read', async () => {
    m.db.survivorTribalCouncil.findUnique.mockResolvedValue({ revealSequence: sequence, isRevealed: false, revealStartsAt: null, revealStep: 0 })
    const res = await post({ leagueId: 'l1', action: 'reveal_next', councilId: 'c1' })
    expect(res.status).toBe(409)
    expect(m.db.survivorTribalCouncil.update).not.toHaveBeenCalled()
  })

  it('is a no-op once every step is out', async () => {
    m.db.survivorTribalCouncil.findUnique.mockResolvedValue({ revealSequence: sequence, isRevealed: true, revealStartsAt: new Date(Date.now() - 1000), revealStep: 3 })
    const res = await post({ leagueId: 'l1', action: 'reveal_next', councilId: 'c1' })
    expect(await res.json()).toMatchObject({ remaining: 0, visibleSteps: 3 })
    expect(m.db.survivorTribalCouncil.update).not.toHaveBeenCalled()
  })

  it('stays commissioner-only', async () => {
    m.commissioner.mockResolvedValue({ ok: false })
    const res = await post({ leagueId: 'l1', action: 'reveal_next', councilId: 'c1' })
    expect(res.status).toBe(403)
    expect(m.db.survivorTribalCouncil.findUnique).not.toHaveBeenCalled()
  })
})
