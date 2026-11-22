// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
  fetch: vi.fn(),
  delete: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
  metadata: vi.fn(),
  groupBy: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
}))
vi.mock('@/lib/sleeper-client', () => ({ getLeagueMatchups: db.fetch }))
vi.mock('@/lib/core-app/leagueWeekMetadata', () => ({ readLeagueWeekMetadata: db.metadata }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  weeklyMatchup: {
    groupBy: db.groupBy,
    findMany: db.findMany,
    updateMany: db.updateMany,
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
  db.findMany.mockResolvedValue([])
  db.updateMany.mockResolvedValue({ count: 2 })
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

const storedWeek1 = [
  { week: 1, rosterId: '1', matchupId: 1, pointsFor: 30, pointsAgainst: 20, win: 1 },
  { week: 1, rosterId: '2', matchupId: 1, pointsFor: 20, pointsAgainst: 30, win: 0 },
]
const providerWeek1 = [
  { roster_id: 1, matchup_id: 1, points: 30 },
  { roster_id: 2, matchup_id: 1, points: 20 },
]
it('does not delete and reinsert a week the provider reports unchanged, but marks it confirmed', async () => {
  db.fetch.mockResolvedValueOnce(providerWeek1)
  db.findMany.mockResolvedValueOnce(storedWeek1)
  await ensureMatchupsCached('P', 1, 2026)
  expect(db.transaction).not.toHaveBeenCalled()
  expect(db.delete).not.toHaveBeenCalled()
  expect(db.create).not.toHaveBeenCalled()
  // `updatedAt` still moves: the staleness check, the outlook prewarm and freshness boards read it.
  expect(db.updateMany).toHaveBeenCalledOnce()
  expect(db.updateMany.mock.calls[0][0]).toMatchObject({
    where: { leagueId: 'P', seasonYear: 2026, week: 1 },
    data: { updatedAt: expect.any(Date) },
  })
})
it('replaces the week when any score moved', async () => {
  db.fetch.mockResolvedValueOnce([{ roster_id: 1, matchup_id: 1, points: 31.5 }, providerWeek1[1]])
  db.findMany.mockResolvedValueOnce(storedWeek1)
  await ensureMatchupsCached('P', 1, 2026)
  expect(db.transaction).toHaveBeenCalledOnce()
  expect(db.updateMany).not.toHaveBeenCalled()
})
it('replaces the week when a roster was added or a pairing changed', async () => {
  db.fetch.mockResolvedValueOnce([...providerWeek1, { roster_id: 3, matchup_id: 2, points: 0 }])
  db.findMany.mockResolvedValueOnce(storedWeek1)
  await ensureMatchupsCached('P', 1, 2026)
  expect(db.transaction).toHaveBeenCalledOnce()

  vi.clearAllMocks()
  db.transaction.mockImplementation(async (callback) => callback({ weeklyMatchup: { deleteMany: db.delete, createMany: db.create } }))
  db.metadata.mockResolvedValue([])
  db.groupBy.mockResolvedValue([{ week: 1, _max: { updatedAt: new Date(0) }, _sum: { pointsFor: 100 } }])
  db.fetch.mockResolvedValueOnce(providerWeek1.map((m) => ({ ...m, matchup_id: 9 })))
  db.findMany.mockResolvedValueOnce(storedWeek1)
  await ensureMatchupsCached('P', 1, 2026)
  expect(db.transaction).toHaveBeenCalledOnce()
})
it('falls back to replacing the week when the stored rows cannot be read', async () => {
  db.fetch.mockResolvedValueOnce(providerWeek1)
  db.findMany.mockRejectedValueOnce(new Error('read failed'))
  await ensureMatchupsCached('P', 1, 2026)
  expect(db.transaction).toHaveBeenCalledOnce()
})
it('does not read stored rows for a week that is not cached yet', async () => {
  db.groupBy.mockResolvedValue([])
  db.fetch.mockResolvedValueOnce(providerWeek1)
  await ensureMatchupsCached('P', 1, 2026)
  expect(db.findMany).not.toHaveBeenCalled()
  expect(db.delete).not.toHaveBeenCalled()
  expect(db.create).toHaveBeenCalledOnce()
})

it('kill switch "matchups" restores the always-replace behaviour', async () => {
  process.env.AF_CHANGE_AWARE_WRITES_OFF = 'matchups'
  try {
    db.fetch.mockResolvedValueOnce(providerWeek1)
    db.findMany.mockResolvedValueOnce(storedWeek1)
    await ensureMatchupsCached('P', 1, 2026)
    expect(db.findMany).not.toHaveBeenCalled()
    expect(db.updateMany).not.toHaveBeenCalled()
    expect(db.transaction).toHaveBeenCalledOnce()
  } finally {
    delete process.env.AF_CHANGE_AWARE_WRITES_OFF
  }
})

/*
 * 🛑 A ROW WITH NO OPPONENT IS NOT A WIN. Sleeper leaves a roster unpaired (`matchup_id` null, or a
 * `matchup_id` nobody else shares) on a bye or in a league with no head-to-head pairing. The writer
 * compared its points against a phantom 0 and stored `win = 1` for every such roster that scored —
 * which is how fifteen leagues showed all twelve teams at 1-0.
 */
it('stores no win for a roster that has no opponent, paired or not', async () => {
  db.groupBy.mockResolvedValue([])
  db.fetch.mockResolvedValueOnce([
    { roster_id: 1, matchup_id: 1, points: 30 },
    { roster_id: 2, matchup_id: 1, points: 20 },
    { roster_id: 3, matchup_id: null, points: 25 },
    { roster_id: 4, matchup_id: 7, points: 40 },
    { roster_id: 5, matchup_id: 2, points: 50 },
    { roster_id: 6, matchup_id: 2, points: 50 },
  ])
  await ensureMatchupsCached('P', 1, 2026)
  const rows = db.create.mock.calls[0][0].data as Array<{ rosterId: string; win: number; pointsAgainst: number }>
  const win = (id: string) => rows.find((r) => r.rosterId === id)?.win
  expect(win('1')).toBe(1)
  expect(win('2')).toBe(0)
  expect(win('3')).toBe(0)
  expect(win('4')).toBe(0)
  // A tie stays 0 for both sides: readers tell it from a loss by the equal points.
  expect(win('5')).toBe(0)
  expect(win('6')).toBe(0)
})
