import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => {
  const db = {
    $queryRaw: vi.fn(), league: { findUnique: vi.fn() },
    survivorAuditEntry: { findFirst: vi.fn(), create: vi.fn() },
    survivorGameState: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    survivorPlayer: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    roster: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    redraftRoster: { findFirst: vi.fn(), update: vi.fn() }, redraftRosterPlayer: { findMany: vi.fn(), updateMany: vi.fn() },
    survivorIdol: { findMany: vi.fn() },
    redraftRosterMoveHistory: { create: vi.fn() }, waiverClaim: { updateMany: vi.fn() },
    survivorTribe: { findFirst: vi.fn() }, survivorTribeMember: { upsert: vi.fn(), deleteMany: vi.fn() },
    survivorJuryMember: { deleteMany: vi.fn() }, survivorChatChannel: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    survivorChatMessage: { create: vi.fn() }, survivorTribalCouncil: { findFirst: vi.fn(), update: vi.fn() },
    survivorExileLeague: { findUnique: vi.fn() }, exileIsland: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() }, exileWeeklyEntry: { findMany: vi.fn(), update: vi.fn() },
  }
  return { db, transaction: vi.fn() }
})
vi.mock('@/lib/prisma', () => ({ prisma: { ...m.db, $transaction: m.transaction } }))
import { selectExileReturnCandidate, resolveScheduledExileReturn } from '@/lib/survivor/survivorExileLifecycle'
import { revealCouncil } from '@/lib/survivor/survivorVoteTallyService'
import { scoreExileWeek } from '@/lib/survivor/exileEngine'
import { resolveElimination } from '@/lib/survivor/survivorEliminationService'
const players = [
  { id: 'p-a', userId: 'a', displayName: 'Alice', redraftRosterId: 'legacy-a', tokenBalance: 4, totalTokensEarned: 6, eliminatedWeek: 2 },
  { id: 'p-b', userId: 'b', displayName: 'Bob', redraftRosterId: 'legacy-b', tokenBalance: 5, totalTokensEarned: 5, eliminatedWeek: 3 },
]
beforeEach(() => {
  vi.resetAllMocks()
  m.transaction.mockImplementation(fn => fn(m.db))
  m.db.league.findUnique.mockResolvedValue({ platform: 'manual', settings: { exileIslandEnabled: true, exileReturnWeek: 10, exileReturnTokens: 4 } })
  m.db.survivorAuditEntry.findFirst.mockImplementation(async ({ where }) => where.action === 'exile_week_scored' ? { id: 'scored', data: { balances: players } } : null)
  m.db.survivorGameState.findUnique.mockResolvedValue({ phase: 'merge', mergeTriggeredAt: new Date(), activeCouncilId: null })
  m.db.survivorPlayer.findMany.mockResolvedValue(players)
  m.db.roster.findFirst.mockResolvedValue({ id: 'legacy-b', redraftRosterId: 'actual-b', playerData: ['athlete'] })
  m.db.redraftRoster.findFirst.mockResolvedValue({ id: 'actual-b', seasonId: 'season', season: { season: 2026 } })
  m.db.redraftRosterPlayer.findMany.mockResolvedValue([{ playerId: 'athlete' }])
  m.db.survivorIdol.findMany.mockResolvedValue([])
  m.db.survivorChatChannel.findMany.mockResolvedValue([])
  m.db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'channel', memberUserIds: [] })
  m.db.survivorExileLeague.findUnique.mockResolvedValue(null)
  m.db.survivorPlayer.count.mockResolvedValue(5)
})
describe('Exile scheduled return', () => {
  it('requires the minimum token balance', () => { expect(selectExileReturnCandidate(players, 6)).toBeNull() })
  it('uses token balance, lifetime tokens, then longest stay for ties', () => {
    expect(selectExileReturnCandidate(players, 4)?.userId).toBe('b')
    expect(selectExileReturnCandidate(players.map(p => ({ ...p, tokenBalance: 4 })), 4)?.userId).toBe('a')
  })
  it('cannot return before the configured week', async () => {
    expect(await resolveScheduledExileReturn('league', 9)).toBeNull()
    expect(m.db.survivorPlayer.update).not.toHaveBeenCalled()
  })
  it('does not return a manager into an open ballot', async () => {
    m.db.survivorGameState.findUnique.mockResolvedValue({ phase: 'merge', activeCouncilId: 'open' })
    expect(await resolveScheduledExileReturn('league', 10)).toBeNull()
  })
  it('waits for finalized Exile results, even when the main island is ready', async () => {
    m.db.survivorAuditEntry.findFirst.mockResolvedValue(null)
    expect(await resolveScheduledExileReturn('league', 10)).toBeNull()
    expect(m.db.survivorPlayer.update).not.toHaveBeenCalled()
  })
  it('reactivates the actual season roster and consumes the token cost together', async () => {
    expect(await resolveScheduledExileReturn('league', 10)).toBe('b')
    expect(m.db.redraftRoster.update).toHaveBeenCalledWith({ where: { id: 'actual-b' }, data: { isEliminated: false } })
    expect(m.db.survivorPlayer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ playerState: 'active', tokenBalance: { decrement: 4 }, canAccessExileChat: false }) }))
    expect(m.db.survivorChatMessage.create).toHaveBeenCalledOnce()
  })
  it('cannot grant another return on a retry', async () => {
    m.db.survivorAuditEntry.findFirst.mockResolvedValue({ id: 'already-resolved' })
    expect(await resolveScheduledExileReturn('league', 10)).toBeNull()
    expect(m.db.redraftRoster.update).not.toHaveBeenCalled()
  })
  it('announces no qualifier without returning an underqualified manager', async () => {
    m.db.survivorPlayer.findMany.mockResolvedValue(players.map(p => ({ ...p, tokenBalance: 0 })))
    m.db.survivorAuditEntry.findFirst.mockImplementation(async ({ where }) => where.action === 'exile_week_scored' ? { id: 'scored', data: { balances: players.map(p => ({ ...p, tokenBalance: 0 })) } } : null)
    expect(await resolveScheduledExileReturn('league', 10)).toBeNull()
    expect(m.db.redraftRoster.update).not.toHaveBeenCalled()
    expect(m.db.survivorAuditEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'scheduled_exile_return_resolved', targetUserId: null }) }))
  })
})
describe('voted-out manager moves to Exile', () => {
  beforeEach(() => {
    m.db.survivorTribalCouncil.findFirst.mockResolvedValue({ id: 'council', isRevealed: true, status: 'revealed', isTie: false, eliminatedUserId: 'b', week: 3, phase: 'pre_merge' })
    m.db.survivorPlayer.findUnique.mockResolvedValue({ ...players[1], playerState: 'active' })
  })
  it('releases the main roster and enrolls the manager on Exile in one transaction', async () => {
    const result = await resolveElimination('league', 'council')
    expect(result).toMatchObject({ ok: true, outcome: 'exile_island', pendingExile: false, releasedPlayerCount: 1 })
    expect(m.db.redraftRosterPlayer.updateMany).toHaveBeenCalledOnce()
    expect(m.db.survivorPlayer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ playerState: 'exile', canAccessExileChat: true, canAccessTribeChat: false }) }))
    expect(m.db.exileIsland.upsert).toHaveBeenCalledOnce()
  })
  it('does not move anyone based on an unrevealed vote tally', async () => {
    m.db.survivorTribalCouncil.findFirst.mockResolvedValue({ isRevealed: false })
    expect(await resolveElimination('league', 'council')).toMatchObject({ ok: false, code: 'not_revealed' })
    expect(m.db.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
  })
  it('replaying a committed elimination releases no more players', async () => {
    m.db.survivorAuditEntry.findFirst.mockResolvedValue({ id: 'resolved', data: { outcome: 'exile_island', pendingRelease: false, pendingExile: false } })
    expect(await resolveElimination('league', 'council')).toMatchObject({ ok: true, alreadyResolved: true })
    expect(m.db.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
  })
})

describe('Exile weekly award settlement', () => {
  beforeEach(() => {
    m.db.exileIsland.findUnique.mockResolvedValue({ id: 'island', isActive: true, bossWinsEnabled: true, bossTokenResetOnWin: true, currentWeek: 9 })
    m.db.exileWeeklyEntry.findMany.mockResolvedValue([{ id: 'entry', userId: 'b', weeklyScore: 0 }])
    m.db.survivorPlayer.findUnique.mockResolvedValue({ ...players[1], playerState: 'exile' })
  })
  it('default zero scores cannot award tokens without finalization evidence', async () => {
    m.db.survivorAuditEntry.findFirst.mockResolvedValue(null)
    expect(await scoreExileWeek('league', 10)).toBe(false)
    expect(m.db.survivorPlayer.update).not.toHaveBeenCalled()
  })
  it('a scored week cannot award its token again', async () => {
    m.db.survivorAuditEntry.findFirst.mockResolvedValue({ id: 'already-scored' })
    expect(await scoreExileWeek('league', 10)).toBe(true)
    expect(m.db.survivorPlayer.update).not.toHaveBeenCalled()
  })
  it('does not settle even a finalized zero score before Chimmy has a verified score', async () => {
    m.db.survivorAuditEntry.findFirst.mockImplementation(async ({ where }) => where.action === 'exile_results_finalized' ? { id: 'finalized' } : null)
    expect(await scoreExileWeek('league', 10)).toBe(false)
    expect(m.db.survivorPlayer.update).not.toHaveBeenCalled()
  })
  it('ignores an inactive manager when selecting the weekly winner', async () => {
    m.db.survivorAuditEntry.findFirst.mockImplementation(async ({ where }) => where.action === 'exile_results_finalized' ? { id: 'finalized' } :
      where.action === 'exile_boss_result_finalized' ? { id: 'boss', data: { source: 'locked_chimmy_nba_roster_v1', score: 5 } } : null)
    m.db.exileWeeklyEntry.findMany.mockResolvedValue([{ id: 'old', userId: 'a', weeklyScore: 99 }, { id: 'entry', userId: 'b', weeklyScore: 10 }])
    m.db.survivorPlayer.findUnique.mockImplementation(async ({ where }) => ({ ...players.find(p => p.userId === where.leagueId_userId.userId), playerState: where.leagueId_userId.userId === 'a' ? 'active' : 'exile' }))
    expect(await scoreExileWeek('league', 10)).toBe(true)
    expect(m.db.exileWeeklyEntry.update).toHaveBeenCalledWith({ where: { id: 'entry' }, data: expect.objectContaining({ bossScore: 5, bossWon: false, tokenEarned: 1 }) })
  })

  it('resets Exile tokens when Chimmy ties or beats the top score', async () => {
    m.db.survivorAuditEntry.findFirst.mockImplementation(async ({ where }) => where.action === 'exile_results_finalized' ? { id: 'finalized' } :
      where.action === 'exile_boss_result_finalized' ? { id: 'boss', data: { source: 'locked_chimmy_nba_roster_v1', score: 10 } } : null)
    m.db.exileWeeklyEntry.findMany.mockResolvedValue([{ id: 'entry', userId: 'b', weeklyScore: 10 }])
    expect(await scoreExileWeek('league', 10)).toBe(true)
    expect(m.db.survivorPlayer.updateMany).toHaveBeenCalledWith({ where: { leagueId: 'league', playerState: 'exile', userId: { notIn: [] } }, data: { tokenBalance: 0 } })
    expect(m.db.survivorPlayer.update).not.toHaveBeenCalled()
    expect(m.db.exileWeeklyEntry.update).toHaveBeenCalledWith({ where: { id: 'entry' }, data: expect.objectContaining({ bossWon: true, tokenEarned: 0, tokenWiped: true }) })
  })

  it('awards exactly one token when Exile leaders tie above Chimmy', async () => {
    m.db.survivorAuditEntry.findFirst.mockImplementation(async ({ where }) => where.action === 'exile_results_finalized' ? { id: 'finalized' } :
      where.action === 'exile_boss_result_finalized' ? { id: 'boss', data: { source: 'locked_chimmy_nba_roster_v1', score: 0 } } : null)
    m.db.exileWeeklyEntry.findMany.mockResolvedValue([{ id: 'entry-a', userId: 'a', weeklyScore: 12 }, { id: 'entry-b', userId: 'b', weeklyScore: 12 }])
    m.db.survivorPlayer.findUnique.mockImplementation(async ({ where }) => ({ ...players.find(p => p.userId === where.leagueId_userId.userId), playerState: 'exile' }))
    expect(await scoreExileWeek('league', 10)).toBe(true)
    expect(m.db.survivorPlayer.update).toHaveBeenCalledOnce()
    expect(m.db.exileWeeklyEntry.update).toHaveBeenCalledTimes(2)
    expect(m.db.exileWeeklyEntry.update.mock.calls.filter(([call]) => call.data.tokenEarned === 1)).toHaveLength(1)
  })

})

describe('public Torch Ceremony commit', () => {
  beforeEach(() => m.db.survivorTribalCouncil.findFirst.mockResolvedValue({ id: 'council', week: 3, status: 'closed', isRevealed: false, isTie: false, eliminatedName: 'Bob', eliminatedUserId: 'b', revealSequence: [{ targetName: 'Bob', targetUserId: 'b', status: 'counts', order: 1, isExtraVote: false }] }))
  it('publishes anonymous ballots with the reveal flag in one transaction', async () => {
    expect(await revealCouncil('league', 'council')).toMatchObject({ ok: true, alreadyRevealed: false })
    expect(m.transaction).toHaveBeenCalledOnce()
    expect(m.db.survivorChatMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ senderName: 'Chimmy', content: expect.stringContaining('Ballot 1: Bob.') }) }))
    expect(m.db.survivorTribalCouncil.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isRevealed: true }) }))
  })
  it('does not reveal when league chat cannot receive the ceremony', async () => {
    m.db.survivorChatChannel.findFirst.mockResolvedValue(null)
    expect(await revealCouncil('league', 'council')).toMatchObject({ ok: false, code: 'chat_missing' })
    expect(m.db.survivorTribalCouncil.update).not.toHaveBeenCalled()
  })
  it('does not publish the same ceremony on a retry', async () => {
    m.db.survivorTribalCouncil.findFirst.mockResolvedValue({ id: 'council', isRevealed: true, revealSequence: [] })
    expect(await revealCouncil('league', 'council')).toMatchObject({ ok: true, alreadyRevealed: true })
    expect(m.db.survivorChatMessage.create).not.toHaveBeenCalled()
  })
})
