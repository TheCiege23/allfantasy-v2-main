/**
 * `ingestSchedule` must fit inside one cron fire, and must make progress across fires.
 *
 * WHAT HAPPENED
 * `import-schedules?source=tsdb-only` returned HTTP 502 at 300,302ms on 2026-08-23, on the fire
 * where NCAAF led the rotation. The platform edge cuts at 300s, so a sport that cannot finish in one
 * fire can never finish at all — it 502s forever and nothing downstream ever sees its season.
 *
 * The cost is the WRITE, not the fetch: one `eventsseason.php` call returns a whole season, then
 * this upserts it one row at a time. Current-season populations measured on prod that day:
 * MLB 2,303 events, NCAAF 866, NCAAB 155.
 *
 * ⚠ AND IT IS NOT AN NCAAF PROBLEM. NCAAF only surfaced it because rotation put it first. MLB is
 * nearly 3x larger and fails harder on the fire where IT leads. Special-casing NCAAF would have
 * looked like a fix and left the bigger one armed — so the bound is per-sport and general.
 *
 * WHAT IS PINNED
 *   1. THE BUDGET STOPS THE WRITES. Without it the handler walks into the edge.
 *   2. DEFERRED WORK IS COUNTED, not silently dropped — a partial sweep must be distinguishable
 *      from a sport that had nothing to write.
 *   3. OLDEST-FIRST ORDERING. A budget over the provider's order rewrites the same head every six
 *      hours and never reaches the tail: starvation one level below `rotateForFairness`.
 *   4. UNBOUNDED BY DEFAULT. `scripts/ingest-thesportsdb.ts` does full sweeps by hand and must not
 *      be silently truncated by a default that exists for the cron's ceiling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { upsertMock, findManyMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(async () => ({})),
  findManyMock: vi.fn(async () => [] as Array<{ externalId: string; fetchedAt: Date | null }>),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsGame: { upsert: upsertMock, findMany: findManyMock } },
}))
vi.mock('@/lib/env/sports-media-keys', () => ({ getTheSportsDbApiKeyOrFallback: () => 'test-key' }))

/**
 * The `v1` helper is module-private, so the seam is `fetch` itself. Stubbed rather than mocked
 * through a client module because there is no client module to mock — it lives in the same file.
 *
 * ⚠ Stubbed inside a hook, NOT at module top level. Replacing global `fetch` during collection
 * broke vitest's own worker startup ("Timeout waiting for worker to respond", both pools), while an
 * unrelated file in the same run passed — the worker transport is up before the hook fires.
 */
const v1Mock = vi.fn()
const realFetch = globalThis.fetch

/** N synthetic events, ids "e0".."e{N-1}". */
function events(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    idEvent: `e${i}`,
    strHomeTeam: `Home ${i}`,
    strAwayTeam: `Away ${i}`,
    intRound: 1,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  findManyMock.mockResolvedValue([])
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify(await v1Mock()),
  })) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('ingestSchedule budget', () => {
  it('stops writing once the budget is spent, and says how much it left', async () => {
    const { ingestSchedule } = await import('@/lib/sports-data/theSportsDbIngest')
    v1Mock.mockResolvedValue({ events: events(100) })

    // 10ms per row, 55ms of budget → ~5 rows through, the rest deferred.
    let t = 0
    const now = () => (t += 10)

    const r = await ingestSchedule('NCAAF' as never, { season: '2026', budgetMs: 55, now })

    expect(r.fetched).toBe(100)
    expect(r.written).toBeLessThan(100)
    expect(r.deferred).toBeGreaterThan(0)
    // The property the 502 came from: written + deferred accounts for everything fetched, so a
    // partial sweep can never be mistaken for a complete one.
    expect(r.written + r.deferred).toBe(100)
    expect(r.budgetExhausted).toBe(true)
  })

  it('writes everything when the budget is ample, and reports nothing deferred', async () => {
    const { ingestSchedule } = await import('@/lib/sports-data/theSportsDbIngest')
    v1Mock.mockResolvedValue({ events: events(20) })

    const r = await ingestSchedule('NCAAF' as never, { season: '2026', budgetMs: 60_000 })

    expect(r.written).toBe(20)
    expect(r.deferred).toBe(0)
    expect(r.budgetExhausted).toBe(false)
  })

  it('is unbounded by default, so the manual full-sweep script is not truncated', async () => {
    const { ingestSchedule } = await import('@/lib/sports-data/theSportsDbIngest')
    v1Mock.mockResolvedValue({ events: events(200) })

    // No budgetMs — exactly how scripts/ingest-thesportsdb.ts calls it.
    //
    // The clock advances a full second per row on purpose. Without it this test passes whatever the
    // default is, because 200 mocked upserts finish in milliseconds — it would assert nothing. With
    // it, any finite default (60s would cut at ~60 rows) fails here.
    let t = 0
    const now = () => (t += 1_000)
    const r = await ingestSchedule('MLB' as never, { season: '2026', now })

    expect(r.written).toBe(200)
    expect(r.deferred).toBe(0)
  })

  it('writes least-recently-fetched first, so successive fires reach the tail', async () => {
    const { ingestSchedule } = await import('@/lib/sports-data/theSportsDbIngest')
    v1Mock.mockResolvedValue({ events: events(3) })
    // e0 written recently, e1 long ago, e2 never seen.
    findManyMock.mockResolvedValue([
      { externalId: 'e0', fetchedAt: new Date(9_000_000) },
      { externalId: 'e1', fetchedAt: new Date(1_000) },
    ])

    await ingestSchedule('NCAAF' as never, { season: '2026', budgetMs: 60_000 })

    const order = upsertMock.mock.calls.map(
      (c) => (c[0] as { where: { sport_externalId_source: { externalId: string } } }).where
        .sport_externalId_source.externalId,
    )
    // Never-seen first, then oldest. Provider order would put e0 first and starve e2 forever.
    expect(order).toEqual(['e2', 'e1', 'e0'])
  })

  it('still writes when the ordering query fails', async () => {
    const { ingestSchedule } = await import('@/lib/sports-data/theSportsDbIngest')
    v1Mock.mockResolvedValue({ events: events(5) })
    findManyMock.mockRejectedValue(new Error('db down'))

    const r = await ingestSchedule('NCAAF' as never, { season: '2026', budgetMs: 60_000 })

    // Ordering is an optimisation; losing it must not lose the sweep.
    expect(r.written).toBe(5)
  })
})
