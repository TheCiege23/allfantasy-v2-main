/**
 * Weekly-loop handoff, section 2: the immunity necklace. The top score in each tribe headed to
 * Tribal Council wins individual immunity, stored per tribe per week, keeps the winner off the
 * ballot at that week's council, and is worn until the next lineup lock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  db: {
    survivorTribeImmunity: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    league: { findUnique: vi.fn() },
    survivorPlayer: { findMany: vi.fn(), updateMany: vi.fn() },
    survivorWeeklyScore: { findMany: vi.fn(), updateMany: vi.fn() },
    survivorTribalCouncil: { findFirst: vi.fn() },
    survivorLeagueConfig: { findUnique: vi.fn() },
    survivorAuditLog: { findMany: vi.fn() },
  },
  surprise: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/survivorSurpriseTribes', () => ({ getActiveSurpriseTribeWeek: m.surprise }))

import {
  awardTribeImmunity,
  clearExpiredTribeImmunity,
  computeTribeImmunityWinners,
  getActiveTribeImmunity,
  immunityChatLine,
  isImmunityActive,
} from '@/lib/survivor/survivorTribeImmunity'
import { buildCouncilContextParts, loadCouncilContext } from '@/lib/survivor/survivorCouncilService'
import { getNextLineupLock } from '@/lib/survivor/sportScheduleEngine'

const candidates = [
  { userId: 'a1', rosterId: 'ra1', displayName: 'Open Team 8', tribeId: 'vela' },
  { userId: 'a2', rosterId: 'ra2', displayName: 'Open Team 5', tribeId: 'vela' },
  { userId: 'a3', rosterId: 'ra3', displayName: 'TheCiege26', tribeId: 'vela' },
  { userId: 'b1', rosterId: 'rb1', displayName: 'Open Team 4', tribeId: 'kora' },
  { userId: 'b2', rosterId: 'rb2', displayName: 'Open Team 2', tribeId: 'kora' },
  { userId: 'c1', rosterId: 'rc1', displayName: 'Open Team 9', tribeId: 'lumo' },
]
const scores = [
  { userId: 'a1', tribeId: 'vela', finalScore: 96.2 },
  { userId: 'a2', tribeId: 'vela', finalScore: 142.6 },
  { userId: 'a3', tribeId: 'vela', finalScore: 118 },
  { userId: 'b1', tribeId: 'kora', finalScore: 160 },
  { userId: 'b2', tribeId: 'kora', finalScore: 150 },
  { userId: 'c1', tribeId: 'lumo', finalScore: 80 },
]

describe('computeTribeImmunityWinners', () => {
  it('awards the top score inside each tribe headed to Tribal Council, never the tribe that won', () => {
    const winners = computeTribeImmunityWinners({ scores, candidates, immuneTribeId: 'kora', merged: false })
    expect(winners.map(w => [w.tribeId, w.userId, w.score])).toEqual([['lumo', 'c1', 80], ['vela', 'a2', 142.6]])
    expect(winners.find(w => w.tribeId === 'kora')).toBeUndefined()
  })

  it('post-merge gives one necklace to the single top score', () => {
    const winners = computeTribeImmunityWinners({ scores, candidates, immuneTribeId: 'kora', merged: true })
    expect(winners).toEqual([{ tribeId: 'merge', userId: 'b1', rosterId: 'rb1', displayName: 'Open Team 4', score: 160 }])
  })

  it('breaks ties on userId, and skips uncounted scores and managers without a roster', () => {
    const tied = [
      { userId: 'a3', tribeId: 'vela', finalScore: 120 },
      { userId: 'a1', tribeId: 'vela', finalScore: 120 },
      { userId: 'a2', tribeId: 'vela', finalScore: 200, countedTowardTribeTotal: false },
    ]
    const winners = computeTribeImmunityWinners({ scores: tied, candidates, immuneTribeId: null, merged: false })
    expect(winners).toEqual([expect.objectContaining({ tribeId: 'vela', userId: 'a1' })])
    const noRoster = computeTribeImmunityWinners({ scores: [{ userId: 'x', tribeId: 'vela', finalScore: 999 }], candidates: [{ userId: 'x', rosterId: null, displayName: 'X', tribeId: 'vela' }], immuneTribeId: null, merged: false })
    expect(noRoster).toEqual([])
  })
})

describe('necklace lifetime', () => {
  it('is worn until the next lineup lock, then cleared', () => {
    const now = new Date('2026-10-20T12:00:00Z')
    expect(isImmunityActive({ expiresAt: null, clearedAt: null }, now)).toBe(true)
    expect(isImmunityActive({ expiresAt: '2026-10-23T00:00:00Z', clearedAt: null }, now)).toBe(true)
    expect(isImmunityActive({ expiresAt: '2026-10-20T11:59:59Z', clearedAt: null }, now)).toBe(false)
    expect(isImmunityActive({ expiresAt: '2026-10-23T00:00:00Z', clearedAt: '2026-10-20T00:00:00Z' }, now)).toBe(false)
  })

  it('the chat line uses original wording', () => {
    expect(immunityChatLine('Open Team 5')).toBe('Open Team 5 won immunity')
  })
})

describe('awardTribeImmunity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.db.survivorGameState.findUnique.mockResolvedValue({ immuneTribeId: 'kora', phase: 'pre_merge', mergeTriggeredAt: null })
    m.db.league.findUnique.mockResolvedValue({ sport: 'NFL', survivorPhase: 'pre_merge' })
    m.db.survivorPlayer.findMany.mockResolvedValue(candidates.map(c => ({ userId: c.userId, redraftRosterId: c.rosterId, displayName: c.displayName, tribeId: c.tribeId })))
    m.db.survivorWeeklyScore.findMany.mockResolvedValue(scores.map(s => ({ ...s, countedTowardTribeTotal: true })))
    m.db.survivorTribeImmunity.findMany.mockResolvedValue([])
    m.db.survivorTribeImmunity.upsert.mockResolvedValue({})
    m.db.survivorTribeImmunity.updateMany.mockResolvedValue({ count: 1 })
    m.db.survivorAuditLog.findMany.mockResolvedValue([])
    m.surprise.mockResolvedValue(null)
  })

  it('a surprise two-tribe week after the merge is scored like a pre-merge week: the lower temporary tribe gets the necklace', async () => {
    m.db.survivorGameState.findUnique.mockResolvedValue({ immuneTribeId: null, phase: 'post_merge', mergeTriggeredAt: new Date('2026-12-01T00:00:00Z') })
    m.db.league.findUnique.mockResolvedValue({ sport: 'NFL', survivorPhase: 'merge', settings: {} })
    m.surprise.mockResolvedValue({ week: 6, tribeIds: ['vela', 'kora'], benchedUserId: 'c1' })
    const result = await awardTribeImmunity('L1', 6)
    // vela (356.8) outscores kora (310): kora attends and its top scorer b1 wears the necklace; the benched c1's lumo row is ignored.
    expect(result.winners.map(w => [w.tribeId, w.userId])).toEqual([['kora', 'b1']])
  })

  it('with the two-highest rule the second tribe is safe too, so only the lowest tribe gets a necklace', async () => {
    m.db.league.findUnique.mockResolvedValue({ sport: 'NFL', survivorPhase: 'pre_merge', settings: { twoHighestTribesImmune: true } })
    const result = await awardTribeImmunity('L1', 6)
    // kora is the score sync's pick; vela (356.8) outscores lumo (80) for the second safe spot.
    expect(result.winners.map(w => [w.tribeId, w.userId])).toEqual([['lumo', 'c1']])
    expect(m.db.survivorPlayer.updateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1', userId: { in: ['c1'] } }, data: { hasImmunityThisWeek: true, immunitySource: 'tribe_top_score' } })
  })

  it('a tribe that won immunity in a challenge is headed home, not to council, so it gets no necklace', async () => {
    m.db.survivorAuditLog.findMany.mockResolvedValue([{ metadata: { week: 6, rewardType: 'tribe_immunity', tribeId: 'lumo' } }])
    const result = await awardTribeImmunity('L1', 6)
    expect(result.winners.map(w => [w.tribeId, w.userId])).toEqual([['vela', 'a2']])
  })

  it('stores immunityWinnerRosterId per tribe per week, expiring at the next lineup lock, and posts once', async () => {
    const now = new Date('2026-10-20T15:00:00Z')
    const post = vi.fn(async () => {})
    const result = await awardTribeImmunity('L1', 6, { now, post })
    expect(result.winners.map(w => w.userId)).toEqual(['c1', 'a2'])
    const vela = m.db.survivorTribeImmunity.upsert.mock.calls.find(([args]) => args.where.leagueId_week_tribeId.tribeId === 'vela')![0]
    expect(vela.where.leagueId_week_tribeId).toEqual({ leagueId: 'L1', week: 6, tribeId: 'vela' })
    expect(vela.create).toMatchObject({ immunityWinnerRosterId: 'ra2', immunityWinnerUserId: 'a2', winnerName: 'Open Team 5', score: 142.6 })
    expect(vela.create.expiresAt).toEqual(getNextLineupLock('NFL', now))
    expect(post).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ userId: 'a2', displayName: 'Open Team 5' }), 6)
    expect(m.db.survivorWeeklyScore.updateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1', week: 6, userId: { in: ['c1', 'a2'] } }, data: { wonIndividualImmunity: true } })
    expect(m.db.survivorPlayer.updateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1', userId: { in: ['c1', 'a2'] } }, data: { hasImmunityThisWeek: true, immunitySource: 'tribe_top_score' } })
  })

  it('does not post the chat line again on a re-run for the same winner', async () => {
    m.db.survivorTribeImmunity.findMany.mockResolvedValue([
      { tribeId: 'vela', immunityWinnerUserId: 'a2', announcedAt: new Date() },
      { tribeId: 'lumo', immunityWinnerUserId: 'c1', announcedAt: new Date() },
    ])
    const post = vi.fn(async () => {})
    await awardTribeImmunity('L1', 6, { post })
    expect(post).not.toHaveBeenCalled()
  })

  it('is a no-op when the table has not been migrated', async () => {
    const saved = m.db.survivorTribeImmunity
    ;(m.db as Record<string, unknown>).survivorTribeImmunity = undefined
    try {
      expect(await awardTribeImmunity('L1', 6)).toEqual({ winners: [], announced: [] })
      expect(await getActiveTribeImmunity('L1')).toEqual([])
    } finally {
      ;(m.db as Record<string, unknown>).survivorTribeImmunity = saved
    }
  })
})

describe('clearExpiredTribeImmunity (the lineup-lock hook)', () => {
  it('stamps clearedAt and takes the badge off only the weekly necklace holders', async () => {
    vi.clearAllMocks()
    const now = new Date('2026-10-23T01:00:00Z')
    m.db.survivorTribeImmunity.findMany.mockResolvedValue([{ id: 'n1', immunityWinnerUserId: 'a2' }])
    m.db.survivorTribeImmunity.updateMany.mockResolvedValue({ count: 1 })
    expect(await clearExpiredTribeImmunity('L1', now)).toBe(1)
    expect(m.db.survivorTribeImmunity.findMany.mock.calls[0][0].where).toEqual({ leagueId: 'L1', clearedAt: null, expiresAt: { lte: now } })
    expect(m.db.survivorTribeImmunity.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['n1'] } }, data: { clearedAt: now } })
    expect(m.db.survivorPlayer.updateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1', userId: { in: ['a2'] }, immunitySource: 'tribe_top_score' }, data: { hasImmunityThisWeek: false, immunitySource: null } })
  })
})

describe('council eligibility', () => {
  const scope = candidates.filter(c => c.tribeId === 'vela').map(c => ({ userId: c.userId, rosterId: c.rosterId, displayName: c.displayName, tribeId: c.tribeId }))
  const settings = { selfVotesAllowed: false } as never

  it('a list of immune managers keeps every one of them off the ballot', () => {
    const { eligibility } = buildCouncilContextParts(scope, [], settings, ['a2'])
    expect(eligibility.targetUserIds).toEqual(['a1', 'a3'])
    expect(eligibility.targetsByVoter.a3).toEqual(['a1'])
    expect(eligibility.voterUserIds).toContain('a2')
  })

  it('loadCouncilContext marks the attending tribe necklace winner safe at that week council', async () => {
    vi.clearAllMocks()
    m.db.survivorTribalCouncil.findFirst.mockResolvedValue({
      id: 'c6', leagueId: 'L1', week: 6, phase: 'pre_merge', status: 'voting_open', attendingTribeId: 'vela',
      votingOpensAt: null, votingDeadline: null, voteDeadlineAt: new Date(Date.now() + 3_600_000), closedAt: null,
      isRevealed: false, doesNotCountVoteIds: [], idolsPlayed: [], tiePlayerIds: [],
    })
    m.db.league.findUnique.mockResolvedValue({ settings: {} })
    m.db.survivorPlayer.findMany.mockResolvedValue(scope.map(p => ({ userId: p.userId, displayName: p.displayName, redraftRosterId: p.rosterId, tribeId: p.tribeId })))
    m.db.survivorGameState.findUnique.mockResolvedValue({ immunePlayerId: null })
    m.db.survivorTribeImmunity.findMany.mockResolvedValue([
      { tribeId: 'vela', immunityWinnerUserId: 'a2', clearedAt: null },
      { tribeId: 'lumo', immunityWinnerUserId: 'c1', clearedAt: null },
    ])
    const ctx = await loadCouncilContext('L1', 'c6')
    expect(m.db.survivorTribeImmunity.findMany.mock.calls[0][0].where).toEqual({ leagueId: 'L1', week: 6 })
    expect(ctx?.immuneUserIds).toEqual(['a2'])
    expect(ctx?.eligibility.targetUserIds).toEqual(['a1', 'a3'])
    expect(ctx?.scopePlayers).toEqual(scope)
  })

  it('immunity won in a challenge keeps that manager off the ballot; a necklace flag without a row for this week does not', async () => {
    vi.clearAllMocks()
    m.db.survivorTribalCouncil.findFirst.mockResolvedValue({
      id: 'c6', leagueId: 'L1', week: 6, phase: 'pre_merge', status: 'voting_open', attendingTribeId: 'vela',
      votingOpensAt: null, votingDeadline: null, voteDeadlineAt: new Date(Date.now() + 3_600_000), closedAt: null,
      isRevealed: false, doesNotCountVoteIds: [], idolsPlayed: [], tiePlayerIds: [],
    })
    m.db.league.findUnique.mockResolvedValue({ settings: {} })
    m.db.survivorPlayer.findMany.mockResolvedValue(scope.map(p => ({
      userId: p.userId, displayName: p.displayName, redraftRosterId: p.rosterId, tribeId: p.tribeId,
      hasImmunityThisWeek: p.userId !== 'a2', immunitySource: p.userId === 'a1' ? 'challenge_win' : p.userId === 'a3' ? 'tribe_top_score' : null,
    })))
    m.db.survivorGameState.findUnique.mockResolvedValue({ immunePlayerId: null })
    m.db.survivorTribeImmunity.findMany.mockResolvedValue([])
    const ctx = await loadCouncilContext('L1', 'c6')
    expect(m.db.survivorPlayer.findMany.mock.calls[0][0].select).toMatchObject({ hasImmunityThisWeek: true, immunitySource: true })
    expect(ctx?.immuneUserIds).toEqual(['a1'])
    expect(ctx?.eligibility.targetUserIds).toEqual(['a2', 'a3'])
    expect(ctx?.scopePlayers).toEqual(scope)
  })

  it('a surprise council after the merge is scoped to its attending temporary tribe', async () => {
    vi.clearAllMocks()
    m.db.survivorTribalCouncil.findFirst.mockResolvedValue({
      id: 'c9', leagueId: 'L1', week: 9, phase: 'surprise', status: 'voting_open', attendingTribeId: 'tide',
      votingOpensAt: null, votingDeadline: null, voteDeadlineAt: new Date(Date.now() + 3_600_000), closedAt: null,
      isRevealed: false, doesNotCountVoteIds: [], idolsPlayed: [], tiePlayerIds: [],
    })
    m.db.league.findUnique.mockResolvedValue({ settings: {} })
    m.db.survivorPlayer.findMany.mockResolvedValue(scope.map(p => ({ userId: p.userId, displayName: p.displayName, redraftRosterId: p.rosterId, tribeId: 'tide' })))
    m.db.survivorGameState.findUnique.mockResolvedValue({ immunePlayerId: null })
    m.db.survivorTribeImmunity.findMany.mockResolvedValue([{ tribeId: 'tide', immunityWinnerUserId: 'a3', clearedAt: null }, { tribeId: 'ember', immunityWinnerUserId: 'zz', clearedAt: null }])
    const ctx = await loadCouncilContext('L1', 'c9')
    expect(m.db.survivorPlayer.findMany.mock.calls[0][0].where).toEqual({ leagueId: 'L1', playerState: 'active', tribeId: 'tide' })
    expect(ctx?.immuneUserIds).toEqual(['a3'])
    expect(ctx?.eligibility.targetUserIds).toEqual(['a1', 'a2'])
  })
})
