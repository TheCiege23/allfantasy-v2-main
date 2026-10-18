/**
 * Weekly-loop handoff, section 1: players see "N of M managers have voted" and nothing else.
 * Never who voted, never for whom, never a partial tally before the reveal. The torch-out moment
 * (section 3) only ever comes from a council that has been read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  context: vi.fn(),
  db: {
    survivorVote: { findUnique: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    survivorWeeklyScore: { findMany: vi.fn() },
    survivorTribalCouncil: { findFirst: vi.fn(), findUnique: vi.fn() },
    survivorTribe: { findMany: vi.fn() },
    survivorTribeImmunity: { findMany: vi.fn() },
    survivorMomentSeen: { findMany: vi.fn(), upsert: vi.fn() },
    survivorIdol: { findMany: vi.fn() },
    // Read by the reveal gate (exile-scroll) in the tribal view and the torch-out.
    league: { findUnique: vi.fn() },
  },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/survivorCouncilService', () => ({ loadCouncilContext: m.context, getLatestCouncil: vi.fn(async () => null) }))
vi.mock('@/lib/survivor/survivorIdolResolutionService', () => ({ getPlayableIdolsForUser: vi.fn(async () => []) }))

import { buildTribalCouncilView } from '@/lib/survivor/survivorTribalView'
import { computeCouncilEligibility } from '@/lib/survivor/survivorBallotEligibility'
import { buildWeeklyMoments, isValidMomentKey, markWeeklyMomentSeen } from '@/lib/survivor/survivorWeeklyMoments'

const scopePlayers = ['me', 'b', 'c', 'immune'].map(userId => ({ userId, rosterId: `r-${userId}`, displayName: `Name ${userId}`, tribeId: 'vela' }))
let ctx: Record<string, unknown>

function access(userId: string, host = false) {
  return {
    leagueId: 'L1', userId,
    settings: { voteChangePolicy: 'allow_until_close', selfVotesAllowed: false, exileIslandEnabled: true },
    decisions: { canSeeVoteTallyBeforeReveal: host },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  ctx = {
    council: { id: 'c6', week: 6, status: 'voting_open', phase: 'pre_merge', attendingTribeId: 'vela', votingOpensAt: null, votingDeadline: null, voteDeadlineAt: new Date(Date.now() + 3_600_000), isRevealed: false, idolsPlayed: [], tiePlayerIds: [] },
    scopePlayers,
    settings: {},
    eligibility: computeCouncilEligibility({ scopePlayers, selfVotesAllowed: false, safeUserIds: ['immune'] }),
    userToRoster: Object.fromEntries(scopePlayers.map(p => [p.userId, p.rosterId])),
    rosterToUser: Object.fromEntries(scopePlayers.map(p => [p.rosterId, p.userId])),
    immuneUserIds: ['immune'],
  }
  m.context.mockImplementation(async () => ctx)
  m.db.survivorVote.findUnique.mockResolvedValue(null)
  m.db.league.findUnique.mockResolvedValue({ survivorRevealMode: null })
  m.db.survivorVote.count.mockResolvedValue(2)
  m.db.survivorWeeklyScore.findMany.mockResolvedValue([{ userId: 'b', finalScore: 96.2 }, { userId: 'immune', finalScore: 142.6 }])
})

describe('votes-in count for players', () => {
  it('gives every player a count and no voter or target identity', async () => {
    const view = await buildTribalCouncilView(access('me'))
    expect(view.votesIn).toEqual({ submittedCount: 2, eligibleVoterCount: 4 })
    expect(view.host).toBeNull()
    // Only a count is ever asked of the ballot table, scoped to eligible voters; no ballot rows are read.
    expect(m.db.survivorVote.findMany).not.toHaveBeenCalled()
    expect(m.db.survivorVote.count.mock.calls[0][0]).toEqual({ where: { councilId: 'c6', doesNotCount: false, voterUserId: { in: ['me', 'b', 'c', 'immune'] } } })
    const json = JSON.stringify({ votesIn: view.votesIn, ballot: view.ballot })
    expect(json).not.toMatch(/voterUserId|targetUserId|targetName|voted_for|tally/)
  })

  it('reads the same for every viewer whatever was voted, so it cannot leak a target', async () => {
    m.db.survivorVote.findUnique.mockResolvedValue({ targetUserId: 'c', targetName: 'Name c', doesNotCount: false, isLateVote: false })
    const voter = await buildTribalCouncilView(access('b'))
    const other = await buildTribalCouncilView(access('c'))
    expect(voter.votesIn).toEqual(other.votesIn)
    expect(voter.ballot?.candidates.map(c => ({ ...c, isSelf: false, canReceiveYourVote: false }))).toEqual(other.ballot?.candidates.map(c => ({ ...c, isSelf: false, canReceiveYourVote: false })))
    // A player only ever sees their own ballot.
    expect(other.you.yourVoteTargetUserId).toBe('c')
    expect(m.db.survivorVote.findUnique.mock.calls.at(-1)?.[0].where.councilId_voterRosterId.voterRosterId).toBe('r-c')
  })

  it('caps the count at the eligible voters and hides it after the reveal', async () => {
    m.db.survivorVote.count.mockResolvedValue(9)
    expect((await buildTribalCouncilView(access('me'))).votesIn).toEqual({ submittedCount: 4, eligibleVoterCount: 4 })
    ;(ctx.council as Record<string, unknown>).isRevealed = true
    ;(ctx.council as Record<string, unknown>).status = 'revealed'
    m.db.survivorTribalCouncil.findUnique.mockResolvedValue({ revealSequence: [], eliminatedName: null, isTie: false, tiePhase: null })
    expect((await buildTribalCouncilView(access('me'))).votesIn).toBeNull()
  })

  it('builds the ballot sheet: self blocked, public immunity disabled, scores public', async () => {
    const view = await buildTribalCouncilView(access('me'))
    expect(view.you.voteChangeAllowed).toBe(true)
    expect(view.ballot?.selfVotesAllowed).toBe(false)
    const byId = Object.fromEntries((view.ballot?.candidates ?? []).map(c => [c.userId, c]))
    expect(byId.me).toMatchObject({ isSelf: true, canReceiveYourVote: false })
    expect(byId.immune).toMatchObject({ isImmune: true, canReceiveYourVote: false, weekScore: 142.6 })
    expect(byId.b).toMatchObject({ isImmune: false, canReceiveYourVote: true, weekScore: 96.2 })
  })
})

describe('weekly moments', () => {
  beforeEach(() => {
    m.db.survivorTribeImmunity.findMany.mockResolvedValue([])
    m.db.survivorTribe.findMany.mockResolvedValue([])
    m.db.survivorMomentSeen.findMany.mockResolvedValue([])
  })

  it('only a council that has been read can produce a torch-out', async () => {
    m.db.survivorTribalCouncil.findFirst.mockResolvedValue(null)
    expect((await buildWeeklyMoments(access('me'))).torchOut).toBeNull()
    expect(m.db.survivorTribalCouncil.findFirst.mock.calls[0][0].where).toEqual({ leagueId: 'L1', isRevealed: true, eliminatedUserId: { not: null } })
  })

  it('plays once per user: the seen key is stored and read back for that user only', async () => {
    // A finished read (published, every ballot released) — the torch-out waits for the reveal gate.
    m.db.survivorTribalCouncil.findFirst.mockResolvedValue({ id: 'c6', week: 6, eliminatedUserId: 'b', eliminatedRosterId: 'r-b', eliminatedName: 'Open Team 8', isRevealed: true, revealStartsAt: new Date(Date.now() - 60_000), revealStep: 0, revealSequence: [] })
    m.db.survivorMomentSeen.findMany.mockResolvedValue([{ momentKey: 'torch:c6' }])
    const moments = await buildWeeklyMoments(access('b'))
    expect(moments.torchOut).toMatchObject({ key: 'torch:c6', name: 'Open Team 8', isYou: true, exileEnabled: true, seen: true })
    expect(m.db.survivorMomentSeen.findMany.mock.calls[0][0].where).toMatchObject({ leagueId: 'L1', userId: 'b' })
    m.db.survivorMomentSeen.upsert.mockResolvedValue({})
    expect(await markWeeklyMomentSeen('L1', 'b', 'torch:c6')).toBe(true)
    expect(m.db.survivorMomentSeen.upsert.mock.calls[0][0].where).toEqual({ leagueId_userId_momentKey: { leagueId: 'L1', userId: 'b', momentKey: 'torch:c6' } })
  })

  it('rejects moment keys it did not mint', async () => {
    expect(isValidMomentKey('torch:c6')).toBe(true)
    expect(isValidMomentKey('immunity:6:merge')).toBe(true)
    expect(isValidMomentKey('vote:c6:target')).toBe(false)
    expect(isValidMomentKey('torch:../../x')).toBe(false)
    expect(await markWeeklyMomentSeen('L1', 'b', 'nope')).toBe(false)
    expect(m.db.survivorMomentSeen.upsert).not.toHaveBeenCalled()
  })
})
