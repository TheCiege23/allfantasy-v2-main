// @vitest-environment node
/**
 * `getTradeGrades` serves an expired payload while ONE rebuild runs behind it (2026-10-03).
 *
 * Past the 6h TTL the read used to wait for the full rebuild — 15–26s measured read-only against
 * production — and both test leagues' entries had been expired for days, so that was most views.
 * These pin the contract: stale-in-window returns at once and rebuilds once per league; `force`
 * (a new completed trade) always waits and never joins a background rebuild; past the window the
 * read waits as it always did.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  row: null as null | { data: unknown; expiresAt: Date },
  builds: 0,
  release: [] as Array<() => void>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: async () => h.row,
      upsert: async () => ({}),
    },
  },
}))
vi.mock('@/lib/trade-intel/sleeperTradeSync', () => ({ sleeperGet: async () => null }))
// The rebuild's first step. Each call is one rebuild; it parks until the test releases it, then
// returns null (no league), so the build yields nothing and no cache write happens.
vi.mock('@/lib/league-context/leagueContextService', () => ({
  getLeagueContext: () => {
    h.builds += 1
    return new Promise((resolve) => h.release.push(() => resolve(null)))
  },
}))
vi.mock('@/lib/sports-data/sleeperMarketService', () => ({
  getSeasonStatsBoard: async () => null,
  getWeekStatsBoard: async () => null,
  scoreStatLine: () => ({ points: 0 }),
}))

const {
  getTradeGrades,
  TRADE_GRADES_STALE_WHILE_REVALIDATE_MS,
} = await import('@/lib/trade-intel/sleeperTradeGradeService')

const HOUR = 60 * 60 * 1000
const PAYLOAD = { version: 2, fetchedAt: '2026-09-29T01:01:00.000Z', staleAsOf: null, trades: [], missing: [] }
const expiredBy = (ms: number) => ({ data: PAYLOAD, expiresAt: new Date(Date.now() - ms) })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const releaseAll = async () => {
  while (h.release.length) h.release.shift()!()
  await flush()
}

beforeEach(async () => {
  await releaseAll()
  h.row = null
  h.builds = 0
})

describe('getTradeGrades stale-while-revalidate', () => {
  it('a fresh entry is served with no rebuild', async () => {
    h.row = { data: PAYLOAD, expiresAt: new Date(Date.now() + HOUR) }
    expect(await getTradeGrades('S1')).toEqual(PAYLOAD)
    expect(h.builds).toBe(0)
  })

  it('🛑 an expired entry inside the window is served AT ONCE, unflagged, with one rebuild behind it', async () => {
    h.row = expiredBy(4 * 24 * HOUR)
    // Resolves while the rebuild is still parked — the read did not wait for it.
    const out = await getTradeGrades('S1')
    expect(out).toEqual(PAYLOAD)
    // Not flagged stale: its own fetchedAt dates it, and the refresh is already under way.
    expect(out?.staleAsOf).toBeNull()
    expect(h.builds).toBe(1)
    await releaseAll()
  })

  it('two stale reads of one league share ONE background rebuild', async () => {
    h.row = expiredBy(HOUR)
    await Promise.all([getTradeGrades('S1'), getTradeGrades('S1')])
    expect(h.builds).toBe(1)
    // A different league is its own rebuild.
    await getTradeGrades('S2')
    expect(h.builds).toBe(2)
    await releaseAll()
    // Once settled, the next stale read starts a new one.
    await getTradeGrades('S1')
    expect(h.builds).toBe(3)
    await releaseAll()
  })

  it('🛑 `force` waits for its own rebuild and never joins a background one', async () => {
    h.row = expiredBy(HOUR)
    await getTradeGrades('S1') // starts the background rebuild
    expect(h.builds).toBe(1)
    let settled = false
    const forced = getTradeGrades('S1', { force: true }).then((v) => {
      settled = true
      return v
    })
    await flush()
    expect(h.builds).toBe(2) // its own build, not the in-flight one
    expect(settled).toBe(false) // and it is waiting on it
    await releaseAll()
    // The forced build yielded nothing, so it falls back to the cached payload, flagged stale.
    expect((await forced)?.staleAsOf).not.toBeNull()
  })

  it('past the window the read waits for the rebuild, as it always did', async () => {
    h.row = expiredBy(TRADE_GRADES_STALE_WHILE_REVALIDATE_MS + HOUR)
    let settled = false
    const read = getTradeGrades('S1').then((v) => {
      settled = true
      return v
    })
    await flush()
    expect(h.builds).toBe(1)
    expect(settled).toBe(false)
    await releaseAll()
    expect((await read)?.staleAsOf).not.toBeNull()
  })
})
