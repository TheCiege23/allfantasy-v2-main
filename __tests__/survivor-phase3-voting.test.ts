/**
 * Survivor Phase 3 — Tribal Council voting, idol resolution, deterministic tally.
 *
 * Pure eligibility is tested directly. The DB-backed tally + vote services are tested with
 * `loadCouncilContext` and prisma mocked, so the real counting / idol-resolution / privacy logic
 * runs without a database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeCouncilEligibility,
  isEligibleTarget,
  isEligibleVoter,
} from '../lib/survivor/survivorBallotEligibility'
import { getActiveCouncil, restrictCouncilToRevote } from '../lib/survivor/survivorCouncilService'

// ── Pure eligibility ─────────────────────────────────────────────────────────
describe('computeCouncilEligibility', () => {
  const scope = [
    { userId: 'a', rosterId: 'ra', displayName: 'A' },
    { userId: 'b', rosterId: 'rb', displayName: 'B' },
    { userId: 'c', rosterId: 'rc', displayName: 'C' },
  ]

  it('excludes self from targets by default and includes all as voters', () => {
    const e = computeCouncilEligibility({ scopePlayers: scope, selfVotesAllowed: false })
    expect(e.voterUserIds).toEqual(['a', 'b', 'c'])
    expect(e.targetsByVoter['a']).toEqual(['b', 'c'])
    expect(isEligibleTarget(e, 'a', 'a')).toBe(false)
    expect(isEligibleTarget(e, 'a', 'b')).toBe(true)
  })

  it('allows self-vote when settings permit', () => {
    const e = computeCouncilEligibility({ scopePlayers: scope, selfVotesAllowed: true })
    expect(e.targetsByVoter['a']).toContain('a')
  })

  it('skip-tribal-safe user is not a valid target', () => {
    const e = computeCouncilEligibility({ scopePlayers: scope, selfVotesAllowed: false, safeUserIds: ['b'] })
    expect(e.targetUserIds).not.toContain('b')
    expect(isEligibleTarget(e, 'a', 'b')).toBe(false)
  })

  it('vote-forfeit user cannot vote', () => {
    const e = computeCouncilEligibility({ scopePlayers: scope, selfVotesAllowed: false, voteForfeitUserIds: ['c'] })
    expect(isEligibleVoter(e, 'c')).toBe(false)
    expect(e.voterUserIds).toEqual(['a', 'b'])
  })
})

describe('revote eligibility', () => {
  it('lets only non-tied managers vote and limits every ballot to tied managers', () => {
    const scope = ['a', 'b', 'c', 'd'].map(userId => ({ userId, rosterId: `r${userId}`, displayName: userId }))
    const firstRound = computeCouncilEligibility({ scopePlayers: scope, selfVotesAllowed: false })
    const revote = restrictCouncilToRevote(firstRound, ['c', 'd'])
    expect(revote.voterUserIds).toEqual(['a', 'b'])
    expect(revote.targetUserIds).toEqual(['c', 'd'])
    expect(revote.targetsByVoter).toEqual({ a: ['c', 'd'], b: ['c', 'd'] })
  })
  it('does not revive a revealed first-round tie after the revote is read', async () => {
    prisma.survivorTribalCouncil.findFirst.mockResolvedValue(null)
    await getActiveCouncil('league-1')
    expect(prisma.survivorTribalCouncil.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isRevealed: false }) }))
  })
})

// ── DB-backed tally with mocks ───────────────────────────────────────────────
const { prisma, loadCouncilContext } = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    survivorVote: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    survivorWeeklyScore: { findMany: vi.fn(async () => []) },
    survivorTribalCouncil: { update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    survivorAuditEntry: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(), $queryRaw: vi.fn(),
  },
  loadCouncilContext: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/survivor/survivorHostIndependence', () => ({ hasIndependentSurvivorHost: vi.fn(async () => true) }))
vi.mock('@/lib/survivor/survivorCouncilService', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, loadCouncilContext }
})

import { tallyCouncil } from '@/lib/survivor/survivorVoteTallyService'
import { hasIndependentSurvivorHost } from '@/lib/survivor/survivorHostIndependence'
import { submitVote } from '@/lib/survivor/survivorVoteService'

type IdolPlay = {
  idolId: string
  powerType: 'vote_shield' | 'extra_vote' | 'skip_tribal' | 'vote_steal'
  playerUserId: string
  playerRosterId: string
  protectedRosterId?: string
  extraTargetUserId?: string
  extraTargetRosterId?: string
  stolenVoterUserId?: string
  stolenVoterRosterId?: string
  forfeitsVote?: boolean
  playedAt: string
}

function makeCtx(opts: { status?: string; idolsPlayed?: IdolPlay[]; lateVotesAllowed?: boolean; selfVotesAllowed?: boolean; voteChangePolicy?: 'first_valid_locks' | 'allow_until_close'; tieRule?: string; nonVoterAutoCast?: boolean } = {}) {
  const scopePlayers = [
    { userId: 'a', rosterId: 'ra', displayName: 'A' },
    { userId: 'b', rosterId: 'rb', displayName: 'B' },
    { userId: 'c', rosterId: 'rc', displayName: 'C' },
    { userId: 'd', rosterId: 'rd', displayName: 'D' },
  ]
  const rosterToUser: Record<string, string> = {}
  const userToRoster: Record<string, string> = {}
  for (const p of scopePlayers) {
    rosterToUser[p.rosterId] = p.userId
    userToRoster[p.userId] = p.rosterId
  }
  const eligibility = computeCouncilEligibility({
    scopePlayers,
    selfVotesAllowed: opts.selfVotesAllowed ?? false,
    safeUserIds: (opts.idolsPlayed ?? []).filter((p) => p.powerType === 'skip_tribal').map((p) => p.playerUserId),
  })
  return {
    council: {
      id: 'council-1',
      leagueId: 'league-1',
      week: 3,
      phase: 'pre_merge',
      status: opts.status ?? 'closed',
      attendingTribeId: 'tribe-a',
      /*
       * ⚠ RELATIVE TO NOW, NOT FIXED DATES — THIS FILE WAS A TIME BOMB AND IT WENT OFF.
       * These were hard-coded 2026-09-01/2026-09-02. `submitVote` computes
       * `past = now > voteDeadlineAt`, so from 2026-09-03 onward every ballot in this file
       * was LATE, `doesNotCount` became true, and `locked: firstValidLocks && !doesNotCount`
       * silently flipped to false. "accepts a valid first ballot and reports it locked"
       * started failing on a date, with no commit touching either the test or the service.
       *
       * Anchoring the window to Date.now() states what these tests actually mean — the council
       * is open right now — instead of encoding a week when that happened to be true.
       */
      votingOpensAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      votingDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      voteDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      closedAt: null,
      isRevealed: false,
      doesNotCountVoteIds: [],
      idolsPlayed: opts.idolsPlayed ?? [],
    },
    settings: {
      lateVotesAllowed: opts.lateVotesAllowed ?? false,
      selfVotesAllowed: opts.selfVotesAllowed ?? false,
      voteChangePolicy: opts.voteChangePolicy ?? 'first_valid_locks',
      tieRule: opts.tieRule ?? 'revote_then_rocks',
      nonVoterAutoCast: opts.nonVoterAutoCast ?? true,
    },
    scopePlayers,
    eligibility,
    rosterToUser,
    userToRoster,
  }
}

describe('tallyCouncil', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.survivorTribalCouncil.update.mockResolvedValue({})
    prisma.survivorAuditEntry.create.mockResolvedValue({})
    prisma.survivorAuditEntry.findMany.mockResolvedValue([])
  })

  it('counts valid ballots and names the eliminated player', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx())
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
      { id: 'v3', voterRosterId: 'rc', targetRosterId: 'ra', targetUserId: 'a', targetName: 'A', doesNotCount: false, isLateVote: false },
    ])
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.tally.countsByTargetUserId).toEqual({ d: 2, a: 1 })
    expect(res.tally.eliminatedUserId).toBe('d')
    expect(res.tally.isTie).toBe(false)
    // deterministic reveal order follows the (submittedAt,id) query order
    expect(res.tally.revealSequence.map((s) => s.order)).toEqual([0, 1, 2])
  })

  it('Vote Shield blocks all votes against the holder (blocked_by_idol, does not count)', async () => {
    loadCouncilContext.mockResolvedValue(
      makeCtx({ idolsPlayed: [{ idolId: 'i1', powerType: 'vote_shield', playerUserId: 'd', playerRosterId: 'rd', protectedRosterId: 'rd', playedAt: 'x' }] }),
    )
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
      { id: 'v3', voterRosterId: 'rc', targetRosterId: 'ra', targetUserId: 'a', targetName: 'A', doesNotCount: false, isLateVote: false },
    ])
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.tally.blockedByIdol).toBe(true)
    expect(res.tally.countsByTargetUserId.d).toBeUndefined()
    expect(res.tally.eliminatedUserId).toBe('a')
    expect(res.tally.revealSequence.filter((s) => s.status === 'blocked_by_idol')).toHaveLength(2)
  })

  it('a successful Shot in the Dark blocks votes only against its owner', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx())
    prisma.survivorAuditEntry.findMany.mockResolvedValue([{ actorUserId: 'd', data: { draw: 1, success: true } }])
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'rc', targetUserId: 'c', targetName: 'C', doesNotCount: false, isLateVote: false },
    ])
    const result = await tallyCouncil('league-1', 'council-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tally.countsByTargetUserId).toEqual({ c: 1 })
    expect(result.tally.revealSequence[0].status).toBe('blocked_by_shot')
    expect(result.tally.eliminatedUserId).toBe('c')
  })

  it('a failed draw leaves the owner vulnerable and forfeits any extra ballot', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx({ idolsPlayed: [{ idolId: 'i2', powerType: 'extra_vote', playerUserId: 'a', playerRosterId: 'ra', extraTargetUserId: 'd', extraTargetRosterId: 'rd', playedAt: 'x' }] }))
    prisma.survivorAuditEntry.findMany.mockResolvedValue([{ actorUserId: 'a', data: { draw: 4, success: false } }])
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'rb', targetRosterId: 'ra', targetUserId: 'a', targetName: 'A', doesNotCount: false, isLateVote: false },
    ])
    const result = await tallyCouncil('league-1', 'council-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tally.countsByTargetUserId).toEqual({ a: 1 })
    expect(result.tally.revealSequence).toHaveLength(1)
  })

  it('does not count a stale ballot recorded for a manager who used a draw', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx())
    prisma.survivorAuditEntry.findMany.mockResolvedValue([{ actorUserId: 'a', data: { draw: 6, success: false } }])
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'rc', targetUserId: 'c', targetName: 'C', doesNotCount: false, isLateVote: false },
    ])
    const result = await tallyCouncil('league-1', 'council-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tally.countsByTargetUserId).toEqual({ c: 1 })
    expect(result.tally.revealSequence[0].status).toBe('forfeited_by_shot')
    expect(result.tally.doesNotCountVoteIds).toContain('v1')
  })

  it('Extra Vote adds an additional ballot at tally', async () => {
    loadCouncilContext.mockResolvedValue(
      makeCtx({ idolsPlayed: [{ idolId: 'i2', powerType: 'extra_vote', playerUserId: 'a', playerRosterId: 'ra', extraTargetUserId: 'd', extraTargetRosterId: 'rd', playedAt: 'x' }] }),
    )
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'ra', targetUserId: 'a', targetName: 'A', doesNotCount: false, isLateVote: false },
    ])
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // a's ballot (d) + a's extra ballot (d) = 2 for d, 1 for a
    expect(res.tally.countsByTargetUserId.d).toBe(2)
    expect(res.tally.revealSequence.some((s) => s.isExtraVote)).toBe(true)
    expect(res.tally.eliminatedUserId).toBe('d')
  })

  it('Vote Steal stamps the taken ballot and counts the holder’s second vote', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx({ idolsPlayed: [{ idolId: 'i4', powerType: 'vote_steal', playerUserId: 'a', playerRosterId: 'ra', stolenVoterUserId: 'b', stolenVoterRosterId: 'rb', extraTargetUserId: 'd', extraTargetRosterId: 'rd', playedAt: 'x' }] }))
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'rc', targetUserId: 'c', targetName: 'C', doesNotCount: false, isLateVote: false },
    ])
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.tally.countsByTargetUserId).toEqual({ d: 2 })
    expect(res.tally.revealSequence.find(scroll => scroll.targetUserId === 'c')?.status).toBe('taken_by_vote_steal')
    expect(res.tally.doesNotCountVoteIds).toContain('v2')
  })

  it('Skip Tribal makes the holder a safe (does-not-count) target', async () => {
    loadCouncilContext.mockResolvedValue(
      makeCtx({ idolsPlayed: [{ idolId: 'i3', powerType: 'skip_tribal', playerUserId: 'd', playerRosterId: 'rd', playedAt: 'x' }] }),
    )
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'ra', targetUserId: 'a', targetName: 'A', doesNotCount: false, isLateVote: false },
    ])
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.tally.countsByTargetUserId.d).toBeUndefined()
    expect(res.tally.revealSequence.find((s) => s.targetUserId === 'd')?.status).toBe('target_safe')
    expect(res.tally.eliminatedUserId).toBe('a')
  })

  it('late ballots show Does Not Count and are excluded', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx())
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: true },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'ra', targetUserId: 'a', targetName: 'A', doesNotCount: false, isLateVote: false },
    ])
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.tally.doesNotCountVoteIds).toContain('v1')
    expect(res.tally.countsByTargetUserId.d).toBeUndefined()
    expect(res.tally.eliminatedUserId).toBe('a')
  })

  it('a first-round tie requires a revote and no elimination', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx())
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'rc', targetUserId: 'c', targetName: 'C', doesNotCount: false, isLateVote: false },
    ])
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.tally.isTie).toBe(true)
    expect(res.tally.tiePhase).toBe('revote_required')
    expect(res.tally.eliminatedUserId).toBeNull()
    expect(res.status).toBe('tie_pending')
  })

  function revoteStillTied(tieRule = 'revote_then_season_points') {
    const ctx = makeCtx({ tieRule })
    // A real revote restricts voters to the non-tied managers and targets to the tied.
    loadCouncilContext.mockResolvedValue({ ...ctx, council: { ...ctx.council, phase: 'revote', tiePlayerIds: ['c', 'd'] }, eligibility: restrictCouncilToRevote(ctx.eligibility, ['c', 'd']) })
    ;(prisma as unknown as Record<string, { findMany: ReturnType<typeof vi.fn> }>).survivorWeeklyScore = {
      findMany: vi.fn(async () => [{ userId: 'c', finalScore: 120.5 }, { userId: 'd', finalScore: 120.5 }]),
    }
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rc', targetUserId: 'c', targetName: 'C', doesNotCount: false, isLateVote: false },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
    ])
  }

  it('a revote tie on equal season points waits for a commissioner who does not play', async () => {
    revoteStillTied()
    vi.mocked(hasIndependentSurvivorHost).mockResolvedValue(true)
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.tally.isTie).toBe(true)
    expect(res.tally.tiePhase).toBe('commissioner_tiebreak_required')
    expect(res.tally.eliminatedUserId).toBeNull()
  })

  it('the same tie goes to the stones when the commissioner plays, so the week never stalls', async () => {
    revoteStillTied()
    vi.mocked(hasIndependentSurvivorHost).mockResolvedValue(false)
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.tally.isTie).toBe(false)
    expect(res.tally.tiePhase).toBe('stones_decided')
    expect(['c', 'd']).toContain(res.tally.eliminatedUserId)
    expect(res.tally.eliminatedUserId && res.tally.eliminatedRosterId).toBeTruthy()
    // Reproducible: the same council draws the same stone.
    const again = await tallyCouncil('league-1', 'council-1')
    expect(again.ok && again.tally.eliminatedUserId).toBe(res.tally.eliminatedUserId)
  })

  it('owner\'s default: a revote that stays tied goes to rocks — a seeded draw among the tied — not to season points', async () => {
    revoteStillTied('revote_then_rocks')
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.tally.isTie).toBe(false)
    expect(res.tally.tiePhase).toBe('rocks_decided')
    expect(['c', 'd']).toContain(res.tally.eliminatedUserId)
    expect(prisma.survivorTribalCouncil.update.mock.calls.at(-1)[0].data.tieBreakSeasonPoints).toMatchObject({ rule: 'revote_then_rocks', round: 'revote', rocks: { candidates: ['c', 'd'] } })
    expect(vi.mocked(hasIndependentSurvivorHost)).not.toHaveBeenCalled()
    const again = await tallyCouncil('league-1', 'council-1')
    expect(again.ok && again.tally.eliminatedUserId).toBe(res.tally.eliminatedUserId)
  })

  it('"rocks immediately": a first-round tie draws rocks at once, with no revote', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx({ tieRule: 'rocks_immediately', nonVoterAutoCast: false }))
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'rc', targetUserId: 'c', targetName: 'C', doesNotCount: false, isLateVote: false },
    ])
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.tally.tiePhase).toBe('rocks_decided')
    expect(res.status).toBe('closed')
    expect(['c', 'd']).toContain(res.tally.eliminatedUserId)
  })

  it('a missing ballot is auto-cast for the lowest-scoring manager the voter could have targeted, and recorded', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx())
    // a and b vote; c and d do not. This week c scored 80 and d 95, b 120, a 110.
    prisma.survivorWeeklyScore.findMany.mockResolvedValue([
      { userId: 'a', finalScore: 110, isFinalized: true }, { userId: 'b', finalScore: 120, isFinalized: true },
      { userId: 'c', finalScore: 80, isFinalized: true }, { userId: 'd', finalScore: 95, isFinalized: true },
    ])
    prisma.survivorVote.upsert.mockImplementation(async (args: { create: { voterRosterId: string } }) => ({ id: `auto-${args.create.voterRosterId}` }))
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
    ])
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // c cannot vote for themself, so c's ballot goes to d (95, the lowest left); d's ballot goes to c (80).
    const casts = prisma.survivorVote.upsert.mock.calls.map((call: [{ create: { voterUserId: string; targetUserId: string } }]) => call[0].create)
    expect(casts.map(c => [c.voterUserId, c.targetUserId])).toEqual([['c', 'd'], ['d', 'c']])
    expect(res.tally.countsByTargetUserId).toEqual({ d: 3, c: 1 })
    expect(res.tally.eliminatedUserId).toBe('d')
    expect(res.tally.totalBallots).toBe(4)
    const audits = prisma.survivorAuditEntry.create.mock.calls.map((call: [{ data: { action: string } }]) => call[0].data.action)
    expect(audits.filter(a => a === 'non_voter_auto_cast')).toHaveLength(2)
    expect(audits.at(-1)).toBe('votes_tallied')
  })

  it('auto-cast skips a manager who used Shot in the Dark, and does nothing when switched off or without scores', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx())
    prisma.survivorAuditEntry.findMany.mockResolvedValue([{ actorUserId: 'c', data: { draw: 3, success: false } }])
    prisma.survivorWeeklyScore.findMany.mockResolvedValue([{ userId: 'a', finalScore: 10, isFinalized: true }, { userId: 'b', finalScore: 20, isFinalized: true }, { userId: 'c', finalScore: 5, isFinalized: true }])
    prisma.survivorVote.upsert.mockResolvedValue({ id: 'auto' })
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rb', targetUserId: 'b', targetName: 'B', doesNotCount: false, isLateVote: false },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'ra', targetUserId: 'a', targetName: 'A', doesNotCount: false, isLateVote: false },
    ])
    await tallyCouncil('league-1', 'council-1')
    // Only d is auto-cast (c forfeited by the shot); d's lowest-scoring target is c.
    expect(prisma.survivorVote.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.survivorVote.upsert.mock.calls[0][0].create).toMatchObject({ voterUserId: 'd', targetUserId: 'c' })

    vi.clearAllMocks()
    prisma.survivorTribalCouncil.update.mockResolvedValue({})
    prisma.survivorAuditEntry.findMany.mockResolvedValue([])
    loadCouncilContext.mockResolvedValue(makeCtx({ nonVoterAutoCast: false }))
    await tallyCouncil('league-1', 'council-1')
    expect(prisma.survivorVote.upsert).not.toHaveBeenCalled()

    loadCouncilContext.mockResolvedValue(makeCtx())
    prisma.survivorWeeklyScore.findMany.mockResolvedValue([])
    await tallyCouncil('league-1', 'council-1')
    expect(prisma.survivorVote.upsert).not.toHaveBeenCalled()
  })

  it('refuses to tally while the window is open', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx({ status: 'voting_open' }))
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('window_open')
  })
})

describe('submitVote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.$transaction.mockImplementation(async fn => fn(prisma))
    prisma.survivorGameState.findUnique.mockResolvedValue({ pausedSnapshot: null })
    prisma.survivorAuditEntry.create.mockResolvedValue({})
    prisma.survivorAuditEntry.findUnique.mockResolvedValue(null)
    prisma.survivorVote.upsert.mockResolvedValue({})
    prisma.$transaction.mockImplementation((work: (db: typeof prisma) => Promise<unknown>) => work(prisma))
  })

  it('cannot submit while the league is paused', async () => {
    prisma.survivorGameState.findUnique.mockResolvedValue({ pausedSnapshot: { needsTribalLock: true } })
    expect(await submitVote('league-1', 'a', 'c')).toMatchObject({ ok: false, code: 'league_paused' })
    expect(prisma.survivorVote.upsert).not.toHaveBeenCalled()
    expect(prisma.$queryRaw.mock.calls[0][1]).toBe('survivor-setup:league-1')
  })

  it.each(['closed', 'tie_pending'])('cannot submit after the window becomes %s', async status => {
    loadCouncilContext.mockResolvedValue(makeCtx({ status }))
    expect(await submitVote('league-1', 'a', 'c')).toMatchObject({ ok: false, code: 'window_closed' })
    expect(prisma.survivorVote.upsert).not.toHaveBeenCalled()
  })

  it('blocks a self-vote when self-votes are disallowed', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx({ status: 'voting_open' }))
    const res = await submitVote('league-1', 'a', 'a')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('self_vote_disallowed')
  })

  it('rejects an ineligible target', async () => {
    loadCouncilContext.mockResolvedValue(
      makeCtx({ status: 'voting_open', idolsPlayed: [{ idolId: 'i', powerType: 'skip_tribal', playerUserId: 'b', playerRosterId: 'rb', playedAt: 'x' }] }),
    )
    const res = await submitVote('league-1', 'a', 'b')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('not_eligible_target')
  })

  it('locks the first valid vote and rejects a change under first_valid_locks', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx({ status: 'voting_open' }))
    prisma.survivorVote.findUnique.mockResolvedValue({ id: 'v1', doesNotCount: false })
    const res = await submitVote('league-1', 'a', 'c')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('vote_locked')
  })

  it('accepts a valid first ballot and reports it locked', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx({ status: 'voting_open' }))
    prisma.survivorVote.findUnique.mockResolvedValue(null)
    const res = await submitVote('league-1', 'a', 'c')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.locked).toBe(true)
    expect(res.targetUserId).toBe('c')
    expect(prisma.survivorVote.upsert).toHaveBeenCalledOnce()
  })

  it('rejects a vote after the manager used Shot in the Dark', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx({ status: 'voting_open' }))
    prisma.survivorAuditEntry.findUnique.mockResolvedValue({ relatedEntityId: 'council-1' })
    const result = await submitVote('league-1', 'a', 'c')
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'shot_forfeited_vote' }))
    expect(prisma.survivorVote.upsert).not.toHaveBeenCalled()
  })

  it('allows voting at a later council after using the one-time draw earlier', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx({ status: 'voting_open' }))
    prisma.survivorAuditEntry.findUnique.mockResolvedValue({ relatedEntityId: 'older-council' })
    prisma.survivorVote.findUnique.mockResolvedValue(null)
    const result = await submitVote('league-1', 'a', 'b')
    expect(result.ok).toBe(true)
  })
})
