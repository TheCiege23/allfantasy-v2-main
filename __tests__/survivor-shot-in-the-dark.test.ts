import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db, context } = vi.hoisted(() => ({
  db: {
    survivorAuditEntry: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    survivorVote: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
  },
  context: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/survivorCouncilService', () => ({ loadCouncilContext: context }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({
  withSurvivorSetupTransaction: (_leagueId: string, work: (tx: typeof db) => Promise<unknown>) => work(db),
}))

import { getShotInTheDarkStatus, playShotInTheDark } from '@/lib/survivor/survivorShotInTheDark'

function council() {
  return {
    council: { id: 'council-1', week: 3, status: 'voting_open', phase: 'pre_merge', isRevealed: false, idolsPlayed: [],
      voteDeadlineAt: new Date(Date.now() + 60_000) },
    eligibility: { voterUserIds: ['user-a'] }, userToRoster: { 'user-a': 'roster-a' },
  }
}

describe('Shot in the Dark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    context.mockResolvedValue(council())
    db.survivorAuditEntry.findUnique.mockResolvedValue(null)
    db.survivorVote.findUnique.mockResolvedValue(null)
    db.survivorGameState.findUnique.mockResolvedValue({ pausedSnapshot: null })
    db.survivorAuditEntry.create.mockResolvedValue({})
  })

  it('uses a private, persisted one-in-six safe draw and forfeits the ballot', async () => {
    expect(await playShotInTheDark('league-1', 'user-a', () => 1)).toEqual(expect.objectContaining({ ok: true, success: true }))
    expect(db.survivorAuditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: 'survivor-shot:league-1:user-a', action: 'shot_in_the_dark_played',
      data: { draw: 1, success: true, forfeitedVote: true },
      isVisibleToCommissioner: false, isVisibleToPublic: false,
    }) })
  })

  it('does not reveal or re-roll a previous use', async () => {
    db.survivorAuditEntry.findUnique.mockResolvedValue({ id: 'survivor-shot:league-1:user-a', data: { success: false }, relatedEntityId: 'council-1' })
    const status = await getShotInTheDarkStatus('league-1', 'user-a')
    expect(status).toEqual({ available: false, used: true, success: false, councilId: 'council-1' })
    expect(await playShotInTheDark('league-1', 'user-a', () => { throw new Error('draw must not run') })).toEqual(expect.objectContaining({ ok: false, status: 409 }))
  })

  it('cannot be used after voting or during a revote', async () => {
    db.survivorVote.findUnique.mockResolvedValue({ id: 'vote-1' })
    expect(await playShotInTheDark('league-1', 'user-a', () => { throw new Error('draw must not run') })).toEqual(expect.objectContaining({ ok: false, status: 409 }))
    db.survivorVote.findUnique.mockResolvedValue(null)
    context.mockResolvedValue({ ...council(), council: { ...council().council, phase: 'revote' } })
    expect(await playShotInTheDark('league-1', 'user-a', () => { throw new Error('draw must not run') })).toEqual(expect.objectContaining({ ok: false, status: 409 }))
  })

  it('cannot be used after an additional idol ballot was cast', async () => {
    context.mockResolvedValue({ ...council(), council: { ...council().council, idolsPlayed: [
      { powerType: 'extra_vote', playerUserId: 'user-a', extraTargetUserId: 'user-b' },
    ] } })
    expect(await playShotInTheDark('league-1', 'user-a', () => { throw new Error('draw must not run') }))
      .toEqual(expect.objectContaining({ ok: false, status: 409 }))
  })

  it('cannot be used while the league is paused', async () => {
    db.survivorGameState.findUnique.mockResolvedValue({ pausedSnapshot: { at: 'pause' } })
    expect((await getShotInTheDarkStatus('league-1', 'user-a')).available).toBe(false)
    expect(await playShotInTheDark('league-1', 'user-a', () => { throw new Error('draw must not run') }))
      .toEqual(expect.objectContaining({ ok: false, status: 409 }))
  })
})
