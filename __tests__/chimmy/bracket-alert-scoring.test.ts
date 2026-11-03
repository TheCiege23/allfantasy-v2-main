import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  entries: vi.fn(), leaderboard: vi.fn(), upsert: vi.fn(), transaction: vi.fn(), emit: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  bracketEntry: { findMany: mocks.entries },
  bracketLeaderboard: { findMany: mocks.leaderboard, upsert: mocks.upsert },
  $transaction: mocks.transaction,
} }))
vi.mock('@/lib/chimmy/bracketChangeAlerts', () => ({
  emitBracketChangeAlert: mocks.emit,
  settleBracketAlertBatch: async <T>(items: T[], send: (item: T) => Promise<unknown>) => {
    const result = await Promise.allSettled(items.map(send))
    return result.filter((row) => row.status === 'rejected').length
  },
}))

import { rebuildLeaderboardForScope } from '@/lib/brackets/leaderboard'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.entries.mockResolvedValueOnce([{ id: 'e1', leagueId: 'l1', picks: [{ points: 15 }] }])
    .mockResolvedValueOnce([{ id: 'e1', userId: 'u1', name: 'My Entry', league: { name: 'Office', tournament: { sport: 'NCAAB' } } }])
  mocks.leaderboard.mockResolvedValue([{ entryId: 'e1', rank: 1, score: 10 }])
  mocks.upsert.mockResolvedValue({ id: 'row' })
  mocks.transaction.mockResolvedValue([])
  mocks.emit.mockResolvedValue(true)
})

describe('tournament bracket result alerts', () => {
  it('emits the stored before score and the newly ranked score after a successful write', async () => {
    await rebuildLeaderboardForScope({ tournamentId: 't1', leagueId: 'l1' })
    expect(mocks.emit).toHaveBeenCalledWith({ userId: 'u1', entryId: 'e1', entryName: 'My Entry',
      poolName: 'Office', format: 'tournament', sport: 'NCAAB',
      before: { score: 10, rank: 1 }, after: { score: 15, rank: 1 } })
  })

  it('does not alert for a first leaderboard snapshot', async () => {
    mocks.leaderboard.mockResolvedValue([])
    await rebuildLeaderboardForScope({ tournamentId: 't1', leagueId: 'l1' })
    expect(mocks.emit).not.toHaveBeenCalled()
  })
})
