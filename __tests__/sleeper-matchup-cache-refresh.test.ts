// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
  fetch: vi.fn(),
  delete: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
  metadata: vi.fn(),
  groupBy: vi.fn(),
}))
vi.mock('@/lib/sleeper-client', () => ({ getLeagueMatchups: db.fetch }))
vi.mock('@/lib/core-app/leagueWeekMetadata', () => ({ readLeagueWeekMetadata: db.metadata }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  weeklyMatchup: {
    groupBy: db.groupBy,
    deleteMany: db.delete,
    createMany: db.create,
  },
  $transaction: db.transaction,
} }))
import { ensureMatchupsCached } from '@/lib/rankings-engine/sleeper-matchup-cache'
beforeEach(() => {
  vi.clearAllMocks()
  db.metadata.mockResolvedValue([])
  db.groupBy.mockResolvedValue([{ week: 1, _max: { updatedAt: new Date(0) }, _sum: { pointsFor: 100 } }])
  db.delete.mockResolvedValue({ count: 2 })
  db.create.mockResolvedValue({ count: 2 })
  db.transaction.mockImplementation(async (callback) => callback({ weeklyMatchup: { deleteMany: db.delete, createMany: db.create } }))
})
it('refreshes the provider current week even when an older week is empty', async () => {
  db.metadata.mockResolvedValue([{ season: 2026, status: 'active', settings: { leg: '3' } }])
  db.groupBy.mockResolvedValue([1, 2, 3, 4].map((week) => ({
    week, _max: { updatedAt: new Date(0) }, _sum: { pointsFor: week === 1 ? 0 : 100 },
  })))
  db.fetch.mockResolvedValue([])
  await ensureMatchupsCached('P', 4, 2026)
  expect(db.fetch.mock.calls.map((call) => call[1])).toEqual([2, 3, 4])
})
it('keeps the last scores when the provider refresh fails', async () => {
  db.fetch.mockRejectedValueOnce(new Error('provider unavailable'))
  await expect(ensureMatchupsCached('P', 1, 2026)).rejects.toThrow('provider unavailable')
  expect(db.delete).not.toHaveBeenCalled()
  expect(db.create).not.toHaveBeenCalled()
})
it('keeps the last scores when the provider returns an empty response', async () => {
  db.fetch.mockResolvedValueOnce([])
  await ensureMatchupsCached('P', 1, 2026)
  expect(db.delete).not.toHaveBeenCalled()
})
it('replaces a successful refresh in one transaction', async () => {
  db.fetch.mockResolvedValueOnce([
    { roster_id: 1, matchup_id: 1, points: 30 },
    { roster_id: 2, matchup_id: 1, points: 20 },
  ])
  await ensureMatchupsCached('P', 1, 2026)
  expect(db.transaction).toHaveBeenCalledOnce()
  expect(db.create.mock.calls[0][0].data).toEqual(expect.arrayContaining([
    expect.objectContaining({ rosterId: '1', pointsFor: 30, pointsAgainst: 20 }),
  ]))
})
