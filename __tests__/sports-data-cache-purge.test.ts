/**
 * `purgeExpiredCache` — the scheduled delete of expired `SportsDataCache` rows.
 *
 * Nothing called it before 2026-09-17, and 78% of the production table was expired rows. It now
 * runs hourly from /api/cron/reap-sync-runs, so the properties below are the ones that decide
 * whether it deletes something a reader still wants:
 *
 *   1. only families on the allow-list are touched — a reader census found families that are read
 *      ON PURPOSE after they expire (`trade-grades:v2:`, `h2h:v2:`, `fantasycalc:values:`…);
 *   2. within those, only rows whose `expiresAt` is strictly before the cutoff go;
 *   3. a row refreshed between the batch SELECT and the DELETE survives;
 *   4. it is bounded (rows per statement, statements per call, wall clock);
 *   5. a purge that could not run says so, instead of reporting a clean zero.
 *
 * The table is an in-memory fake that EVALUATES the `where` clauses the code sends, so these tests
 * check which rows survive, not which query text was written. An operator or field the fake does
 * not know throws, so a rewritten query cannot pass by being ignored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

type Row = { cacheKey: string; expiresAt: Date }

const FIELD_OPS = ['lt', 'lte', 'gt', 'gte', 'in', 'startsWith']

function matchesField(value: Date | string, cond: unknown): boolean {
  if (typeof cond !== 'object' || cond === null || cond instanceof Date) {
    return value instanceof Date && cond instanceof Date ? value.getTime() === cond.getTime() : value === cond
  }
  const ops = cond as Record<string, unknown>
  for (const op of Object.keys(ops)) {
    if (!FIELD_OPS.includes(op)) throw new Error(`fake table: unsupported operator "${op}"`)
  }
  const t = value instanceof Date ? value.getTime() : NaN
  const time = (d: unknown) => (d as Date).getTime()
  if (ops.lt !== undefined && !(t < time(ops.lt))) return false
  if (ops.lte !== undefined && !(t <= time(ops.lte))) return false
  if (ops.gt !== undefined && !(t > time(ops.gt))) return false
  if (ops.gte !== undefined && !(t >= time(ops.gte))) return false
  if (ops.in !== undefined && !(ops.in as string[]).includes(value as string)) return false
  if (ops.startsWith !== undefined && !String(value).startsWith(ops.startsWith as string)) return false
  return true
}

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') {
      if (!(cond as Record<string, unknown>[]).every((w) => matches(row, w))) return false
    } else if (key === 'OR') {
      const list = cond as Record<string, unknown>[]
      if (list.length === 0 || !list.some((w) => matches(row, w))) return false
    } else if (key === 'cacheKey' || key === 'expiresAt') {
      if (!matchesField(row[key], cond)) return false
    } else {
      throw new Error(`fake table: unsupported field "${key}"`)
    }
  }
  return true
}

function fakeTable(rows: Row[], hooks: { afterFind?: (found: Row[]) => void; failOn?: 'findMany' | 'deleteMany' } = {}) {
  const calls = { findMany: 0, deleteMany: 0 }
  const takes: Array<number | undefined> = []
  const client = {
    sportsDataCache: {
      findMany: vi.fn(async (args: { where?: Record<string, unknown>; take?: number; orderBy?: { expiresAt?: 'asc' | 'desc' } }) => {
        calls.findMany += 1
        takes.push(args.take)
        if (hooks.failOn === 'findMany') throw new Error('connection lost')
        let found = rows.filter((r) => matches(r, args.where))
        if (args.orderBy?.expiresAt) {
          const dir = args.orderBy.expiresAt === 'asc' ? 1 : -1
          found = [...found].sort((a, b) => dir * (a.expiresAt.getTime() - b.expiresAt.getTime()))
        }
        if (args.take !== undefined) found = found.slice(0, args.take)
        const out = found.map((r) => ({ cacheKey: r.cacheKey }))
        hooks.afterFind?.(found)
        return out
      }),
      deleteMany: vi.fn(async (args: { where?: Record<string, unknown> }) => {
        calls.deleteMany += 1
        if (hooks.failOn === 'deleteMany') throw new Error('connection lost')
        const doomed = rows.filter((r) => matches(r, args.where))
        for (const d of doomed) rows.splice(rows.indexOf(d), 1)
        return { count: doomed.length }
      }),
    },
  }
  return { client: client as never, rows, calls, takes }
}

const NOW = new Date('2026-09-17T14:00:00.000Z')
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs)
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const keys = (rows: Row[]) => rows.map((r) => r.cacheKey).sort()
/** A key in a purgeable family. */
const p = (id: string) => `news_context:${id}`

/**
 * Families a reader serves AFTER expiry, from the 2026-09-17 census. None may be purged, and no
 * allow-listed prefix may overlap one in either direction.
 */
const KEEP_EXPIRED_FAMILIES = [
  'trade-grades:v2:',
  'draft-report:v1:',
  'h2h:v2:',
  'h2h:season:v1:',
  'h2h-facts:v1:',
  'fantasycalc:values:',
  'player-valuations:',
  'college-team-directory:v1',
  'projection_accuracy:',
  'league-context:rules:v1:',
  'league-context:v1:',
  'league-history:v1:',
  'nfl-redraft-provider:',
  'ktc-dynasty-rankings',
  'draft-order-',
  'nfl-state:v1',
  'transactions:',
  'rosters:',
  'league_users:',
  'players:all',
  'sleeper:dashboard:',
  'career-card:v3:',
  'command-center:v3:',
  'assets:tsdb:v1:',
  'projections:week:v1:',
  'espn:summary:v1:',
  'espn:news:',
  'newsapi:',
  'market-values:v1:',
  'waiver-intel:v1:',
  'dynastyprocess:values:v1:',
  'core-visit:v1:',
  'geocode:owm:v1:',
  'NFL:',
  'nfl:',
]

async function load() {
  return import('@/lib/enrichment-cache')
}

describe('purgeExpiredCache', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.SPORTS_DATA_CACHE_PURGE_DISABLED
  })

  it('removes only rows whose expiresAt is strictly before now', async () => {
    const { purgeExpiredCache } = await load()
    const t = fakeTable([
      { cacheKey: p('old'), expiresAt: at(-30 * DAY) },
      { cacheKey: p('just-expired'), expiresAt: at(-1) },
      { cacheKey: p('expires-now'), expiresAt: at(0) },
      { cacheKey: p('live'), expiresAt: at(1) },
      { cacheKey: 'core-portfolio:totals:v1:2026-09-17:u=1', expiresAt: at(400 * DAY) },
    ])

    const result = await purgeExpiredCache(t.client, { now: NOW })

    expect(keys(t.rows)).toEqual(['core-portfolio:totals:v1:2026-09-17:u=1', p('expires-now'), p('live')])
    expect(result).toMatchObject({ available: true, deleted: 2, capped: false, cutoff: NOW.toISOString() })
  })

  it('never touches a family that is not on the allow-list, however long expired', async () => {
    const { purgeExpiredCache } = await load()
    // The kept rows are the OLDEST, so a read that dropped the family filter would fill its small
    // pages with them and never reach the purgeable row.
    const kept = KEEP_EXPIRED_FAMILIES.map((f, i) => ({ cacheKey: `${f}row`, expiresAt: at(-400 * DAY + i) }))
    const t = fakeTable([...kept, { cacheKey: 'api:abc', expiresAt: at(-HOUR) }])

    const result = await purgeExpiredCache(t.client, { now: NOW, batchSize: 2, maxBatches: 5 })

    expect(keys(t.rows)).toEqual(keys(kept))
    expect(result).toMatchObject({ deleted: 1, capped: false })
  })

  it('deletes expired rows in every allow-listed family', async () => {
    const { purgeExpiredCache, PURGEABLE_KEY_PREFIXES } = await load()
    const t = fakeTable(PURGEABLE_KEY_PREFIXES.map((f) => ({ cacheKey: `${f}row`, expiresAt: at(-HOUR) })))

    const result = await purgeExpiredCache(t.client, { now: NOW })

    expect(t.rows).toEqual([])
    expect(result.deleted).toBe(PURGEABLE_KEY_PREFIXES.length)
  })

  it('no allow-listed prefix overlaps a family whose readers use expired rows', async () => {
    const { PURGEABLE_KEY_PREFIXES } = await load()
    const overlaps = PURGEABLE_KEY_PREFIXES.flatMap((allowed) =>
      KEEP_EXPIRED_FAMILIES.filter((kept) => kept.startsWith(allowed) || allowed.startsWith(kept)).map(
        (kept) => `${allowed} ~ ${kept}`,
      ),
    )
    expect(overlaps).toEqual([])
    expect(PURGEABLE_KEY_PREFIXES.every((prefix) => prefix.length >= 4)).toBe(true)
  })

  it('keeps rows inside the grace window', async () => {
    const { purgeExpiredCache } = await load()
    const t = fakeTable([
      { cacheKey: p('expired-3d'), expiresAt: at(-3 * DAY) },
      { cacheKey: p('expired-1d'), expiresAt: at(-DAY) },
      { cacheKey: p('expired-1h'), expiresAt: at(-HOUR) },
      { cacheKey: p('live'), expiresAt: at(HOUR) },
    ])

    const result = await purgeExpiredCache(t.client, { now: NOW, graceMs: 2 * DAY })

    expect(keys(t.rows)).toEqual([p('expired-1d'), p('expired-1h'), p('live')])
    expect(result.deleted).toBe(1)
    expect(result.cutoff).toBe(at(-2 * DAY).toISOString())
  })

  it('never deletes a row refreshed between the batch read and the delete', async () => {
    const { purgeExpiredCache } = await load()
    const rows: Row[] = [
      { cacheKey: p('stale'), expiresAt: at(-HOUR) },
      { cacheKey: p('refreshed-mid-purge'), expiresAt: at(-HOUR) },
    ]
    // A writer upserts the key after the purge selected it: its expiresAt moves into the future.
    const t = fakeTable(rows, {
      afterFind: () => {
        const r = rows.find((x) => x.cacheKey === p('refreshed-mid-purge'))
        if (r) r.expiresAt = at(20 * 60_000)
      },
    })

    const result = await purgeExpiredCache(t.client, { now: NOW })

    expect(keys(t.rows)).toEqual([p('refreshed-mid-purge')])
    expect(result.deleted).toBe(1)
  })

  it('is bounded per call and finishes the backlog on the next call', async () => {
    const { purgeExpiredCache } = await load()
    const t = fakeTable([
      ...Array.from({ length: 5 }, (_, i) => ({ cacheKey: p(`e${i}`), expiresAt: at(-(i + 1) * HOUR) })),
      { cacheKey: p('live'), expiresAt: at(HOUR) },
    ])

    const first = await purgeExpiredCache(t.client, { now: NOW, batchSize: 2, maxBatches: 2 })
    expect(first).toMatchObject({ available: true, deleted: 4, batches: 2, capped: true })
    // Oldest first: the one left is the most recently expired.
    expect(keys(t.rows)).toEqual([p('e0'), p('live')])
    expect(t.takes).toEqual([2, 2])

    const second = await purgeExpiredCache(t.client, { now: NOW, batchSize: 2, maxBatches: 2 })
    expect(second).toMatchObject({ available: true, deleted: 1, batches: 1, capped: false })
    expect(keys(t.rows)).toEqual([p('live')])
  })

  it('stops between batches when the time budget runs out', async () => {
    const { purgeExpiredCache } = await load()
    const t = fakeTable(Array.from({ length: 6 }, (_, i) => ({ cacheKey: p(`e${i}`), expiresAt: at(-HOUR) })))
    let clock = 0
    const tick = () => {
      clock += 4_000
      return clock
    }

    const result = await purgeExpiredCache(t.client, { now: NOW, batchSize: 2, maxBatches: 10, budgetMs: 10_000, clock: tick })

    expect(result.capped).toBe(true)
    expect(result.batches).toBeLessThan(3)
    expect(t.rows.length).toBeGreaterThan(0)
  })

  it('does not spin to the cap on rows expiring exactly at the cutoff', async () => {
    // If the batch read took `<=` while the delete keeps `<`, these two rows would fill every page,
    // never be deleted, and burn the whole call's batches re-reading them.
    const { purgeExpiredCache } = await load()
    const t = fakeTable([
      { cacheKey: p('expired'), expiresAt: at(-HOUR) },
      { cacheKey: p('at-cutoff-1'), expiresAt: at(0) },
      { cacheKey: p('at-cutoff-2'), expiresAt: at(0) },
    ])

    const result = await purgeExpiredCache(t.client, { now: NOW, batchSize: 2, maxBatches: 5 })

    expect(result).toMatchObject({ deleted: 1, batches: 1, capped: false })
    expect(t.calls.findMany).toBe(1)
    expect(keys(t.rows)).toEqual([p('at-cutoff-1'), p('at-cutoff-2')])
  })

  it('does not issue a second read after a short page', async () => {
    const { purgeExpiredCache } = await load()
    const t = fakeTable([{ cacheKey: p('e'), expiresAt: at(-HOUR) }])

    await purgeExpiredCache(t.client, { now: NOW, batchSize: 10 })

    expect(t.calls).toEqual({ findMany: 1, deleteMany: 1 })
  })

  it.each(['findMany', 'deleteMany'] as const)('reports UNAVAILABLE, not a clean zero, when %s throws', async (failOn) => {
    const { purgeExpiredCache } = await load()
    const t = fakeTable([{ cacheKey: p('e'), expiresAt: at(-HOUR) }], { failOn })

    const result = await purgeExpiredCache(t.client, { now: NOW })

    expect(result.available).toBe(false)
    expect(result.error).toContain('connection lost')
    expect(result.deleted).toBe(0)
  })

  it('does nothing when disabled, and says so', async () => {
    process.env.SPORTS_DATA_CACHE_PURGE_DISABLED = 'true'
    const { purgeExpiredCache } = await load()
    const t = fakeTable([{ cacheKey: p('e'), expiresAt: at(-HOUR) }])

    const result = await purgeExpiredCache(t.client, { now: NOW })

    expect(result).toMatchObject({ available: false, error: 'disabled', deleted: 0 })
    expect(t.calls).toEqual({ findMany: 0, deleteMany: 0 })
    expect(t.rows).toHaveLength(1)
  })

  it('the fake refuses what it does not evaluate', () => {
    // Guards the guard: a query rewritten to an operator or field this fake ignores must fail loudly.
    const row = { cacheKey: 'k', expiresAt: NOW }
    expect(() => matches(row, { expiresAt: { not: NOW } })).toThrow(/unsupported operator/)
    expect(() => matches(row, { createdAt: { lt: NOW } })).toThrow(/unsupported field/)
    expect(() => matches(row, { NOT: { cacheKey: 'k' } })).toThrow(/unsupported field/)
    expect(matches(row, { OR: [] })).toBe(false)
  })
})
