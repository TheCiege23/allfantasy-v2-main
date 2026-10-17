// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const reads = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { tradeAnalysisSnapshot: reads } }))
import { readLatestSnapshot, readLatestSnapshotRecord, readSnapshotsForUser, writeSnapshot } from '@/lib/trade-engine/snapshot-store'
import { readLatestSnapshot as alternateSnapshotReader } from '@/lib/trade-engine/snapshots'
beforeEach(() => { vi.clearAllMocks(); reads.findMany.mockResolvedValue([]) })
it('limits username-based listings to the three legacy snapshot kinds', async () => {
  await readSnapshotsForUser({ sleeperUsername: 'user:public-guess' })
  expect(reads.findMany.mock.calls[0][0].where.snapshotType).toEqual({ in: ['league_analyze', 'rankings_analyze', 'otb_packages'] })
})
it('refuses an account-owned receipt kind even if a caller circumvents the TypeScript type', async () => {
  const args = { leagueId: 'league-a', sleeperUsername: 'user:public-guess', snapshotType: 'trade_value_receipt_v1' as never }
  expect(await readLatestSnapshot(args)).toBeNull()
  expect(await readLatestSnapshotRecord(args)).toBeNull()
  expect(await alternateSnapshotReader(args)).toBeNull()
  expect(await readSnapshotsForUser(args)).toEqual([])
  await writeSnapshot({ ...args, payload: { grade: 'A' } })
  expect(reads.findFirst).not.toHaveBeenCalled()
  expect(reads.findMany).not.toHaveBeenCalled()
  expect(reads.create).not.toHaveBeenCalled()
})
