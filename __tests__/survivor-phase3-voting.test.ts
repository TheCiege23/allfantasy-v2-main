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

// ── DB-backed tally with mocks ───────────────────────────────────────────────
const { prisma, loadCouncilContext } = vi.hoisted(() => ({
  prisma: {
    survivorVote: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    survivorTribalCouncil: { update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
    survivorGameState: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
  loadCouncilContext: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/survivor/survivorCouncilService', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, loadCouncilContext }
})

import { tallyCouncil } from '@/lib/survivor/survivorVoteTallyService'
import { submitVote } from '@/lib/survivor/survivorVoteService'

type IdolPlay = {
  idolId: string
  powerType: 'vote_shield' | 'extra_vote' | 'skip_tribal'
  playerUserId: string
  playerRosterId: string
  protectedRosterId?: string
  extraTargetUserId?: string
  extraTargetRosterId?: string
  forfeitsVote?: boolean
  playedAt: string
}

function makeCtx(opts: { status?: string; idolsPlayed?: IdolPlay[]; lateVotesAllowed?: boolean; selfVotesAllowed?: boolean; voteChangePolicy?: 'first_valid_locks' | 'allow_until_close' } = {}) {
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

  it('a tie returns tie_pending with a commissioner tiebreak and no elimination', async () => {
    loadCouncilContext.mockResolvedValue(makeCtx())
    prisma.survivorVote.findMany.mockResolvedValue([
      { id: 'v1', voterRosterId: 'ra', targetRosterId: 'rd', targetUserId: 'd', targetName: 'D', doesNotCount: false, isLateVote: false },
      { id: 'v2', voterRosterId: 'rb', targetRosterId: 'rc', targetUserId: 'c', targetName: 'C', doesNotCount: false, isLateVote: false },
    ])
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.tally.isTie).toBe(true)
    expect(res.tally.tiePhase).toBe('commissioner_tiebreak_required')
    expect(res.tally.eliminatedUserId).toBeNull()
    expect(res.status).toBe('tie_pending')
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
    prisma.survivorAuditEntry.create.mockResolvedValue({})
    prisma.survivorVote.upsert.mockResolvedValue({})
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
})
