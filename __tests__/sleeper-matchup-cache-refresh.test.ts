// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
  fetch: vi.fn(),
  delete: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('@/lib/sleeper-client', () => ({ getLeagueMatchups: db.fetch }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  weeklyMatchup: {
    groupBy: vi.fn(async () => [{ week: 1, _max: { updatedAt: new Date(0) }, _sum: { pointsFor: 100 } }]),
    deleteMany: db.delete,
    createMany: db.create,
  },
  $transaction: db.transaction,
} }))
import { ensureMatchupsCached } from '@/lib/rankings-engine/sleeper-matchup-cache'
beforeEach(() => {
  vi.clearAllMocks()
  db.delete.mockResolvedValue({ count: 2 })
  db.create.mockResolvedValue({ count: 2 })
  db.transaction.mockImplementation(async (callback) => callback({ weeklyMatchup: { deleteMany: db.delete, createMany: db.create } }))
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
