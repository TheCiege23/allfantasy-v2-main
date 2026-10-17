import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSGConfig } from '@/lib/survivor-guillotine/config'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ findUniqueOrThrow: vi.fn(), updateMany: vi.fn() }))
const leagueDb = vi.hoisted(() => ({ findUniqueOrThrow: vi.fn() }))
const scoreDb = vi.hoisted(() => ({ findMany: vi.fn() }))
const chopDb = vi.hoisted(() => ({ updateMany: vi.fn() }))
const chatDb = vi.hoisted(() => ({ create: vi.fn() }))
const teamDb = vi.hoisted(() => ({ findFirst: vi.fn() }))
const rosterDb = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn() }))
const redraftDb = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  survivorGuillotineLeague: db, league: leagueDb, teamWeekResult: scoreDb,
  survivorGuillotineChop: chopDb, leagueChatMessage: chatDb, leagueTeam: teamDb,
  roster: rosterDb, redraftRoster: redraftDb,
  $transaction: (fn: (tx: unknown) => unknown) => fn({ survivorGuillotineLeague: db,
    survivorGuillotineChop: chopDb, leagueChatMessage: chatDb, roster: rosterDb,
    redraftRoster: redraftDb }),
} }))
vi.mock('@/lib/survivor-guillotine/competition', () => ({ resolveSGPeriod: () => ({
  status: 'resolved', choppedTeamIds: ['a'], savedTeamIds: [], immuneTribeId: null,
  placements: [], reasons: [],
}) }))

import { auditSGHistoricalCorrections, awardSGHistoricalCompensation, reviewSGHistoricalCorrection } from '@/lib/survivor-guillotine/operations'

describe('historical stat correction recovery', () => {
  beforeEach(() => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    db.findUniqueOrThrow.mockReset().mockResolvedValue({ leagueId: 'league', revision: 3,
      config: defaultSGConfig(), currentPeriod: 15, periodState: { period: 15, ceremonyStarted: false },
      periodCalendar: {}, scoreHistory: { '14': Object.fromEntries(ids.map((id, i) => [id, i + 1])) },
      periodHistory: { '14': { mode: 'merged', scores: Object.fromEntries(ids.map((id, i) => [id, i + 1])),
        teams: ids.map((id, i) => ({ id, tribeId: 'merged', points: i + 1, previousPoints: null })),
        choppedTeamIds: ['a'] } } })
    leagueDb.findUniqueOrThrow.mockReset().mockResolvedValue({ season: 2026 })
    scoreDb.findMany.mockReset().mockResolvedValue(ids.map((rosterId, i) => ({ rosterId,
      totalPoints: rosterId === 'b' ? 2.5 : i + 1 })))
    db.updateMany.mockReset().mockResolvedValue({ count: 1 })
    chopDb.updateMany.mockReset().mockResolvedValue({ count: 1 })
    chatDb.create.mockReset()
    teamDb.findFirst.mockReset().mockResolvedValue({ eliminatedAt: null, teamName: 'Manager B', ownerName: 'B' })
    rosterDb.findFirst.mockReset().mockResolvedValue({ id: 'b', redraftRosterId: 'redraft-b',
      faabRemaining: 25, updatedAt: new Date('2026-10-15T00:00:00Z') })
    rosterDb.updateMany.mockReset().mockResolvedValue({ count: 1 })
    redraftDb.update.mockReset()
  })

  it('applies official corrected scores without changing the played chop', async () => {
    const result = await reviewSGHistoricalCorrection('league', 'commissioner', 14,
      'keep_played_result', 'Keep the played path after reviewing claims')
    expect(result.decision).toBe('keep_played_result')
    const saved = db.updateMany.mock.calls[0][0].data
    expect(saved.scoreHistory['14'].b).toBe(2.5)
    expect(saved.periodHistory['14'].teams[1].points).toBe(2.5)
    expect(saved.periodHistory['14'].choppedTeamIds).toEqual(['a'])
    expect(saved.periodHistory['14'].correctionReview.originalScores.b).toBe(2)
    expect(chopDb.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ period: 14, rosterId: 'a' }), data: { score: 1 },
    }))
    expect(chatDb.create).toHaveBeenCalledTimes(1)
  })

  it('leaves scores untouched when the commissioner flags manual follow-up', async () => {
    await reviewSGHistoricalCorrection('league', 'commissioner', 14,
      'manual_followup', 'Need to reconcile downstream claims first')
    const saved = db.updateMany.mock.calls[0][0].data
    expect(saved.scoreHistory).toBeUndefined()
    expect(saved.periodHistory['14'].scores.b).toBe(2)
    expect(chopDb.updateMany).not.toHaveBeenCalled()
  })

  it('keeps a reviewed correction visible for a one-time audited FAAB remedy', async () => {
    const original = await db.findUniqueOrThrow()
    await reviewSGHistoricalCorrection('league', 'commissioner', 14,
      'keep_played_result', 'Keep the played result after claims')
    const saved = db.updateMany.mock.calls[0][0].data
    db.findUniqueOrThrow.mockResolvedValue({ ...original, revision: 4,
      periodHistory: saved.periodHistory, scoreHistory: saved.scoreHistory })
    const audit = await auditSGHistoricalCorrections('league')
    expect(audit.changes[0]).toMatchObject({ period: 14, result: 'reviewed_played_result',
      changedRosterIds: ['b'], review: { decision: 'keep_played_result' } })
    await expect(reviewSGHistoricalCorrection('league', 'commissioner', 14,
      'keep_played_result', 'Try to apply the same correction again')).rejects.toThrow('already reviewed')
    db.updateMany.mockClear()
    chatDb.create.mockClear()
    const result = await awardSGHistoricalCompensation('league', 'commissioner', 14, 'b', 20,
      'Compensate the affected active manager')
    expect(result.compensation).toMatchObject({ recipientRosterId: 'b', kind: 'faab', amount: 20,
      balanceBefore: 25, balanceAfter: 45 })
    expect(rosterDb.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { faabRemaining: 45 } }))
    expect(redraftDb.update).toHaveBeenCalledWith(expect.objectContaining({ data: { faabBalance: { increment: 20 } } }))
    expect(db.updateMany.mock.calls[0][0].data.periodHistory['14'].correctionReview.compensations).toHaveLength(1)
    expect(chatDb.create).toHaveBeenCalledTimes(1)
    db.findUniqueOrThrow.mockResolvedValue({ ...original, revision: 5,
      periodHistory: db.updateMany.mock.calls[0][0].data.periodHistory,
      scoreHistory: saved.scoreHistory })
    await expect(awardSGHistoricalCompensation('league', 'commissioner', 14, 'b', 20,
      'Do not credit twice')).rejects.toThrow('already has a compensation decision')
  })

  it('records an external remedy for an eliminated manager without crediting unusable FAAB', async () => {
    const original = await db.findUniqueOrThrow()
    await reviewSGHistoricalCorrection('league', 'commissioner', 14,
      'keep_played_result', 'Keep the played result after claims')
    const saved = db.updateMany.mock.calls[0][0].data
    db.findUniqueOrThrow.mockResolvedValue({ ...original, revision: 4,
      periodHistory: saved.periodHistory, scoreHistory: saved.scoreHistory })
    teamDb.findFirst.mockResolvedValue({ eliminatedAt: new Date(), teamName: 'Manager B', ownerName: 'B' })
    await expect(awardSGHistoricalCompensation('league', 'commissioner', 14, 'b', 20,
      'Compensate an eliminated manager')).rejects.toThrow('active manager')
    const result = await awardSGHistoricalCompensation('league', 'commissioner', 14, 'b', 0,
      'Commissioner arranged a future-season remedy')
    expect(result.compensation).toMatchObject({ kind: 'record_only', amount: 0 })
    expect(rosterDb.updateMany).not.toHaveBeenCalled()
  })
})
