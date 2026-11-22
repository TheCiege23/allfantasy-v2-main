// @vitest-environment node
/**
 * Sealed immunity in the council context (the immune stay on the ballot while votes are open and are
 * safe once the council closes) and "votes due N hours before the ceremony" in the ballot service.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    survivorGameState: { findUnique: vi.fn() },
    survivorVote: { findUnique: vi.fn(), upsert: vi.fn() },
    survivorAuditEntry: { create: vi.fn(), findUnique: vi.fn() },
  },
  necklaces: vi.fn(),
  loadCouncilContext: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/survivor/survivorTribeImmunity', () => ({ getCouncilImmuneUserIds: h.necklaces }))

import { loadCouncilContext as realLoadCouncilContext } from '@/lib/survivor/survivorCouncilService'

const players = [
  { userId: 'a', displayName: 'A', redraftRosterId: 'ra', tribeId: null, hasImmunityThisWeek: false, immunitySource: null },
  { userId: 'b', displayName: 'B', redraftRosterId: 'rb', tribeId: null, hasImmunityThisWeek: true, immunitySource: 'challenge' },
  { userId: 'c', displayName: 'C', redraftRosterId: 'rc', tribeId: null, hasImmunityThisWeek: false, immunitySource: null },
]

function fakeDb(council: Record<string, unknown>, settings: Record<string, unknown>) {
  return {
    league: { findUnique: vi.fn(async () => ({ settings })) },
    survivorPlayer: { findMany: vi.fn(async () => players) },
    survivorTribalCouncil: { findFirst: vi.fn(async () => council) },
    survivorGameState: { findUnique: vi.fn(async () => ({ immunePlayerId: null })) },
  }
}

const deadline = new Date('2026-12-22T01:00:00.000Z')
const council = (over: Record<string, unknown> = {}) => ({ id: 'c1', leagueId: 'L1', week: 12, councilNumber: 1, phase: 'merge', status: 'voting_open', attendingTribeId: null, votingOpensAt: null, votingDeadline: deadline, voteDeadlineAt: deadline, closedAt: null, isRevealed: false, doesNotCountVoteIds: [], idolsPlayed: [], tiePlayerIds: [], ...over })

describe('sealed immunity in the council context', () => {
  beforeEach(() => h.necklaces.mockResolvedValue([]))

  it('off (default): the immune manager is not a target and is listed as immune', async () => {
    const ctx = (await realLoadCouncilContext('L1', 'c1', fakeDb(council(), {}) as never))!
    expect(ctx.eligibility.targetUserIds).not.toContain('b')
    expect(ctx.immuneUserIds).toEqual(['b'])
    expect(ctx.sealedImmuneUserIds).toEqual([])
  })

  it('on, votes open: the immune manager stays on the ballot and nobody is listed as immune', async () => {
    const ctx = (await realLoadCouncilContext('L1', 'c1', fakeDb(council(), { sealedImmunity: true }) as never))!
    expect(ctx.eligibility.targetUserIds).toContain('b')
    expect(ctx.immuneUserIds).toEqual([])
    expect(ctx.sealedImmuneUserIds).toEqual(['b'])
  })

  it('on, council closed: the seal breaks, so the tally treats votes against them as target_safe', async () => {
    const ctx = (await realLoadCouncilContext('L1', 'c1', fakeDb(council({ status: 'closed', closedAt: new Date() }), { sealedImmunity: true }) as never))!
    expect(ctx.eligibility.targetUserIds).not.toContain('b')
    expect(ctx.immuneUserIds).toEqual(['b'])
  })

  it('ballots are due N hours before the ceremony; a revote keeps its own window', async () => {
    const due = (await realLoadCouncilContext('L1', 'c1', fakeDb(council(), { votesDueHoursBeforeCeremony: 3 }) as never))!
    expect(due.ballotsDueAt!.toISOString()).toBe('2026-12-21T22:00:00.000Z')
    const revote = (await realLoadCouncilContext('L1', 'c1', fakeDb(council({ phase: 'revote' }), { votesDueHoursBeforeCeremony: 3 }) as never))!
    expect(revote.ballotsDueAt!.toISOString()).toBe(deadline.toISOString())
    const none = (await realLoadCouncilContext('L1', 'c1', fakeDb(council(), {}) as never))!
    expect(none.ballotsDueAt!.toISOString()).toBe(deadline.toISOString())
  })
})

describe('votes due before the ceremony (submitVote)', () => {
  let submitVote: typeof import('@/lib/survivor/survivorVoteService').submitVote
  const ctxWith = (dueInHours: number, closeInHours: number) => {
    const close = new Date(Date.now() + closeInHours * 3_600_000)
    return {
      council: { ...council({ voteDeadlineAt: close, votingDeadline: close }) },
      settings: { lateVotesAllowed: false, selfVotesAllowed: false, voteChangePolicy: 'allow_until_close' },
      scopePlayers: [{ userId: 'a', rosterId: 'ra', displayName: 'A' }, { userId: 'c', rosterId: 'rc', displayName: 'C' }],
      eligibility: { voterUserIds: ['a', 'c'], targetUserIds: ['a', 'c'], targetsByVoter: { a: ['c'], c: ['a'] } },
      userToRoster: { a: 'ra', c: 'rc' },
      rosterToUser: { ra: 'a', rc: 'c' },
      ballotsDueAt: new Date(Date.now() + dueInHours * 3_600_000),
    }
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('@/lib/survivor/survivorCouncilService', () => ({ loadCouncilContext: h.loadCouncilContext }))
    h.prisma.$transaction.mockImplementation(async (fn: (db: unknown) => unknown) => fn(h.prisma))
    h.prisma.survivorGameState.findUnique.mockResolvedValue({ pausedSnapshot: null })
    h.prisma.survivorAuditEntry.findUnique.mockResolvedValue(null)
    h.prisma.survivorAuditEntry.create.mockResolvedValue({})
    h.prisma.survivorVote.upsert.mockReset()
    h.prisma.survivorVote.findUnique.mockResolvedValue(null)
    submitVote = (await import('@/lib/survivor/survivorVoteService')).submitVote
  })

  it('before the due time a ballot counts', async () => {
    h.loadCouncilContext.mockResolvedValue(ctxWith(2, 5))
    const res = await submitVote('L1', 'a', 'c')
    expect(res).toMatchObject({ ok: true, late: false, doesNotCount: false })
  })

  it('after the due time (still before the ceremony) a new ballot is late and does not count', async () => {
    h.loadCouncilContext.mockResolvedValue(ctxWith(-1, 2))
    const res = await submitVote('L1', 'a', 'c')
    expect(res).toMatchObject({ ok: true, late: true, doesNotCount: true })
    expect(h.prisma.survivorVote.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ isLateVote: true, doesNotCount: true }) }))
  })

  it('after the due time a counted ballot cannot be changed: the first submission stands', async () => {
    h.loadCouncilContext.mockResolvedValue(ctxWith(-1, 2))
    h.prisma.survivorVote.findUnique.mockResolvedValue({ id: 'v1', doesNotCount: false })
    const res = await submitVote('L1', 'a', 'c')
    expect(res).toMatchObject({ ok: false, code: 'ballots_due_passed', status: 409 })
    expect(h.prisma.survivorVote.upsert).not.toHaveBeenCalled()
  })
})
