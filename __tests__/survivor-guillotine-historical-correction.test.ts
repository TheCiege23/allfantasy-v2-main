import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSGConfig } from '@/lib/survivor-guillotine/config'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ findUniqueOrThrow: vi.fn(), updateMany: vi.fn() }))
const leagueDb = vi.hoisted(() => ({ findUniqueOrThrow: vi.fn() }))
const scoreDb = vi.hoisted(() => ({ findMany: vi.fn() }))
const chopDb = vi.hoisted(() => ({ updateMany: vi.fn() }))
const chatDb = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  survivorGuillotineLeague: db, league: leagueDb, teamWeekResult: scoreDb,
  survivorGuillotineChop: chopDb, leagueChatMessage: chatDb,
  $transaction: (fn: (tx: unknown) => unknown) => fn({ survivorGuillotineLeague: db,
    survivorGuillotineChop: chopDb, leagueChatMessage: chatDb }),
} }))
vi.mock('@/lib/survivor-guillotine/competition', () => ({ resolveSGPeriod: () => ({
  status: 'resolved', choppedTeamIds: ['a'], savedTeamIds: [], immuneTribeId: null,
  placements: [], reasons: [],
}) }))

import { reviewSGHistoricalCorrection } from '@/lib/survivor-guillotine/operations'

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
})
