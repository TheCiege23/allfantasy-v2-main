import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  council: { findFirst: vi.fn() }, close: vi.fn(), tally: vi.fn(), reveal: vi.fn(), legacyLock: vi.fn(), legacyTally: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'host' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueCommissioner: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: vi.fn(async () => null) }))
vi.mock('@/lib/prisma', () => ({ prisma: { survivorTribalCouncil: m.council } }))
vi.mock('@/lib/survivor/survivorCouncilService', () => ({ closeVoteWindow: m.close }))
vi.mock('@/lib/survivor/survivorVoteTallyService', () => ({ tallyCouncil: m.tally, revealCouncil: m.reveal, publishCouncilVerdictIfComplete: vi.fn(async () => ({ ok: true, complete: false })) }))
vi.mock('@/lib/survivor/votingEngine', () => ({ lockVoting: m.legacyLock }))
vi.mock('@/lib/survivor/SurvivorVoteEngine', () => ({ tallyVotes: m.legacyTally, getSeasonPointsFromRosterPerformance: vi.fn() }))

import { POST as lock } from '@/server/api-route-modules/league-survivor/votes/lock/route'
import { POST as reveal } from '@/server/api-route-modules/league-survivor/votes/reveal/route'

const call = (route: typeof lock) => route(new Request('http://test', { method: 'POST' }) as never, { params: { leagueId: 'league' } })

beforeEach(() => {
  vi.clearAllMocks()
  m.council.findFirst.mockResolvedValue({ id: 'council' })
  m.close.mockResolvedValue({ ok: true })
  m.tally.mockResolvedValue({ ok: true, status: 'closed' })
  m.reveal.mockResolvedValue({ ok: true, eliminatedName: 'Bob', isTie: false })
})

describe('legacy council URLs', () => {
  it('lock closes and tallies through the canonical council services', async () => {
    expect((await call(lock)).status).toBe(200)
    expect(m.close).toHaveBeenCalledWith('league', 'council', 'host')
    expect(m.tally).toHaveBeenCalledWith('league', 'council')
    expect(m.legacyLock).not.toHaveBeenCalled()
  })

  it('reveal publishes through the canonical Torch Ceremony', async () => {
    const res = await call(reveal)
    // The outcome is not echoed to the host mid-read; it is published when the last ballot is read.
    expect(await res.json()).toEqual({ ok: true, councilId: 'council' })
    expect(m.reveal).toHaveBeenCalledWith('league', 'council', 'host')
    expect(m.legacyTally).not.toHaveBeenCalled()
  })

  it('passes canonical refusals through', async () => {
    m.close.mockResolvedValue({ ok: false, status: 409, error: 'Council already revealed.' })
    const res = await call(lock)
    expect(res.status).toBe(409)
    expect(m.tally).not.toHaveBeenCalled()
  })
})
