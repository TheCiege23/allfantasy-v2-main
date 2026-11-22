import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A DRAFT OUTLIVES ITS POOL CACHE BY HOURS.
 *
 * Pool rows expire after 5 minutes by default and a draft runs for hours, so every expiry handed the
 * next autopick, room load or lookahead a full cold build while the pick clock ran. Readers that opt
 * in now take the last good row and start ONE background rebuild; readiness stays fresh-only.
 */

type Row = { leagueId: string; cacheKey: string; sourceFingerprint: string; payload: unknown; entryCount: number; syncedAt: Date; expiresAt: Date }

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  resolve: vi.fn(),
  upsert: vi.fn(),
}))

/** Honours the filters these reads use, so an expired row is genuinely invisible to a fresh-only read. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  if (typeof where.cacheKey === 'string' && row.cacheKey !== where.cacheKey) return false
  if (typeof where.leagueId === 'string' && row.leagueId !== where.leagueId) return false
  if (typeof where.sourceFingerprint === 'string' && row.sourceFingerprint !== where.sourceFingerprint) return false
  const gt = (where.expiresAt as { gt?: Date } | undefined)?.gt
  if (gt && !(row.expiresAt > gt)) return false
  return true
}

vi.mock('@/lib/prisma', () => ({
  prisma: { draftPoolCache: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      [...h.rows].sort((a, b) => b.syncedAt.getTime() - a.syncedAt.getTime()).find(row => matches(row, where)) ?? null),
    upsert: h.upsert,
  } },
}))
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({
  getEffectiveLeagueRosterTemplate: vi.fn(async () => ({ template: {}, hasPersistedRosterSchema: true, allowedPositions: ['C'], sport: 'NBA' })),
  starterEligiblePlayerPositionsFromTemplate: vi.fn(() => new Set(['C'])),
}))
vi.mock('@/lib/draft-room/draft-pool-eligible-positions', () => ({ rosterFingerprintFromEligible: vi.fn(() => 'C') }))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({ getResolvedDraftPoolForLeague: h.resolve }))
vi.mock('@/lib/db-first-mode', () => ({ dbFirstMode: { draftPoolCacheTtlSeconds: 300 } }))
vi.mock('@/lib/api-performance', () => ({ getApiCached: vi.fn(() => null) }))

import {
  DRAFT_POOL_MAX_STALE_MS,
  getDraftPoolReadiness,
  getWarmDraftPoolSnapshotFast,
  inFlightDraftPoolBuildCount,
  resolveDraftPoolCacheContext,
} from '@/lib/draft-room/ensureDraftPoolReady'

const MINUTE = 60_000

async function seed(expiredAgoMs: number, entries: unknown[] = [{ playerId: 'p1', name: 'Old Center' }]) {
  const ctx = await resolveDraftPoolCacheContext('lg')
  const now = Date.now()
  h.rows = [{
    leagueId: 'lg', cacheKey: ctx.standardCacheKey, sourceFingerprint: ctx.rosterFp,
    payload: { entries, sport: 'NBA', count: entries.length }, entryCount: entries.length,
    syncedAt: new Date(now - expiredAgoMs - 5 * MINUTE), expiresAt: new Date(now - expiredAgoMs),
  }]
}

/** A rebuild that never finishes until the test says so: proves nobody waits on it. */
function hangingRebuild() {
  let finish!: () => void
  h.resolve.mockImplementation(() => new Promise(done => {
    finish = () => done({ sport: 'NBA', poolType: 'pro', count: 1, entries: [{ playerId: 'p2', name: 'New Center' }] })
  }))
  return () => finish()
}

describe('draft pool: stale while revalidate', () => {
  beforeEach(() => {
    h.rows = []
    h.resolve.mockReset()
    h.upsert.mockReset()
  })

  it('an expired row is still cold to the readiness check, so the rebuild is still owed', async () => {
    await seed(10 * MINUTE)
    expect((await getDraftPoolReadiness('lg')).ready).toBe(false)
    expect((await getWarmDraftPoolSnapshotFast('lg')).warm).toBe(false)
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('an opted-in reader gets the last good pool at once, and starts ONE background rebuild for many readers', async () => {
    await seed(10 * MINUTE)
    const finish = hangingRebuild()

    const reads = await Promise.all([1, 2, 3].map(() => getWarmDraftPoolSnapshotFast('lg', { allowStale: true })))
    for (const read of reads) {
      expect(read).toMatchObject({ warm: true, stale: true, source: 'db-cache', entryCount: 1 })
      expect(read.warm && read.payload.entries).toEqual([{ playerId: 'p1', name: 'Old Center' }])
    }
    // The reads returned while the rebuild is still running: nobody waited for it.
    await vi.waitFor(() => expect(h.resolve).toHaveBeenCalledTimes(1))
    expect(inFlightDraftPoolBuildCount()).toBe(1)

    finish()
    await vi.waitFor(() => expect(h.upsert).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(inFlightDraftPoolBuildCount()).toBe(0))
  })

  it('a fresh row is served as fresh, with no rebuild', async () => {
    await seed(-2 * MINUTE)
    const read = await getWarmDraftPoolSnapshotFast('lg', { allowStale: true })
    expect(read).toMatchObject({ warm: true, source: 'db-cache' })
    expect(read.warm && read.stale).toBeFalsy()
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('[control] a row older than the stale limit, or an empty one, is not served', async () => {
    await seed(DRAFT_POOL_MAX_STALE_MS + MINUTE)
    expect((await getWarmDraftPoolSnapshotFast('lg', { allowStale: true })).warm).toBe(false)
    await seed(10 * MINUTE, [])
    expect((await getWarmDraftPoolSnapshotFast('lg', { allowStale: true })).warm).toBe(false)
    expect(h.resolve).not.toHaveBeenCalled()
  })
})
