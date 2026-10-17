import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The store's raw SQL, captured rather than executed — no database is reachable from a unit test
 * here, by design (vitest.setup.db-guard.ts). What is pinned is what the SQL NAMES: which tables it
 * touches, and that the read range excludes the current week in the query itself.
 */

type Captured = { sql: string; values: unknown[] }
const h = vi.hoisted(() => ({ calls: [] as Captured[], txOptions: [] as unknown[], queryResult: [] as unknown[] }))

function capture(strings: TemplateStringsArray | { strings?: string[] }, ...values: unknown[]): Captured {
  const parts = Array.isArray(strings) ? (strings as readonly string[]) : []
  // Prisma.sql fragments (Prisma.join, nested Prisma.sql) flatten through `.sql` / `.values`.
  const flat: unknown[] = []
  let sql = ''
  parts.forEach((s, i) => {
    sql += s
    if (i < values.length) {
      const v = values[i] as { sql?: string; values?: unknown[] }
      if (v && typeof v === 'object' && typeof v.sql === 'string' && Array.isArray(v.values)) {
        sql += v.sql
        flat.push(...v.values)
      } else {
        sql += '?'
        flat.push(v)
      }
    }
  })
  return { sql, values: flat }
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const client = {
    $queryRaw: vi.fn(async (s: TemplateStringsArray, ...v: unknown[]) => {
      h.calls.push(capture(s, ...v))
      return h.queryResult
    }),
    $executeRaw: vi.fn(async (s: TemplateStringsArray, ...v: unknown[]) => {
      h.calls.push(capture(s, ...v))
      return 1
    }),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>, opts: unknown) => {
      h.txOptions.push(opts)
      return fn(client)
    }),
  }
  return { prisma: client }
})

import {
  futureWeekProjectionsReady,
  futureWeekStoreReader,
  futureWeekStoreWriter,
  resetFutureWeekProjectionsReadyCache,
} from '@/lib/projections/futureWeekProjectionStore'

const KEY = { sport: 'NFL', season: '2026', week: 5, source: 'sleeper' }

beforeEach(() => {
  h.calls = []
  h.txOptions = []
  h.queryResult = []
  resetFutureWeekProjectionsReadyCache()
})

describe('future-week store SQL', () => {
  it('🛑 no statement it can issue names fantasy_projections', async () => {
    await futureWeekStoreWriter.replaceWeek({
      ...KEY,
      anchorWeek: 4,
      scoringPresetId: 'ppr',
      payloadHash: 'abc',
      at: new Date('2026-09-29T11:00:00Z'),
      lines: [{ playerId: '4046', projectedPoints: 14.2, stats: { pts_ppr: 14.2 }, opponent: 'CHI' }],
    })
    await futureWeekStoreWriter.confirmWeek({ ...KEY, anchorWeek: 4, status: 'not_published', rowCount: 0, payloadHash: null, at: new Date() })
    await futureWeekStoreWriter.recordWeekError({ ...KEY, anchorWeek: 4, error: 'x', at: new Date() })
    await futureWeekStoreWriter.pruneThrough({ sport: 'NFL', season: '2026', throughWeek: 4 })
    await futureWeekStoreWriter.readCheck(KEY)
    await futureWeekStoreReader.readChecks({ sport: 'NFL', season: '2026', source: 'sleeper', afterWeek: 4, throughWeek: 8 })
    await futureWeekStoreReader.readLines({ sport: 'NFL', season: '2026', source: 'sleeper', afterWeek: 4, throughWeek: 8, playerIds: ['4046'] })

    expect(h.calls.length).toBeGreaterThan(8)
    for (const c of h.calls) {
      expect(c.sql).not.toMatch(/fantasy_projections/)
      expect(c.sql).toMatch(/future_week_projection(s|_checks)/)
    }
  })

  it('replaces a week inside one transaction with a timeout above Prisma’s 5s default', async () => {
    await futureWeekStoreWriter.replaceWeek({
      ...KEY,
      anchorWeek: 4,
      scoringPresetId: 'ppr',
      payloadHash: 'abc',
      at: new Date('2026-09-29T11:00:00Z'),
      lines: [{ playerId: '4046', projectedPoints: 14.2, stats: { pts_ppr: 14.2 }, opponent: 'CHI' }],
    })
    expect(h.txOptions).toEqual([{ maxWait: 10_000, timeout: 30_000 }])
    expect(h.calls[0]!.sql).toMatch(/DELETE FROM "future_week_projections"/)
    expect(h.calls[1]!.sql).toMatch(/INSERT INTO "future_week_projections"/)
    expect(h.calls[1]!.values).toEqual(expect.arrayContaining(['NFL', '2026', 5, '4046', 'ppr', 'sleeper', 14.2, 4]))
    expect(h.calls[2]!.sql).toMatch(/INSERT INTO "future_week_projection_checks"[\s\S]*ON CONFLICT/)
  })

  it('both reads exclude the current week in the query itself', async () => {
    await futureWeekStoreReader.readChecks({ sport: 'NFL', season: '2026', source: 'sleeper', afterWeek: 4, throughWeek: 8 })
    await futureWeekStoreReader.readLines({ sport: 'NFL', season: '2026', source: 'sleeper', afterWeek: 4, throughWeek: 8, playerIds: ['4046'] })
    for (const c of h.calls) {
      expect(c.sql).toMatch(/"week" > \?/)
      expect(c.sql).toMatch(/"week" <= \?/)
      expect(c.values).toEqual(expect.arrayContaining([4, 8]))
    }
  })

  it('a read for no players issues no query', async () => {
    expect(await futureWeekStoreReader.readLines({ sport: 'NFL', season: '2026', source: 'sleeper', afterWeek: 4, throughWeek: 8, playerIds: [] })).toEqual([])
    expect(h.calls).toEqual([])
  })
})

describe('futureWeekProjectionsReady', () => {
  it('is false until both tables exist, re-probes after 10 minutes, and never throws', async () => {
    let t = 0
    const now = () => t
    const probe = vi.fn(async () => false)
    expect(await futureWeekProjectionsReady({ probe, now })).toBe(false)
    t = 5 * 60_000
    expect(await futureWeekProjectionsReady({ probe, now })).toBe(false)
    expect(probe).toHaveBeenCalledTimes(1)
    t = 11 * 60_000
    probe.mockResolvedValueOnce(true)
    expect(await futureWeekProjectionsReady({ probe, now })).toBe(true)
    expect(await futureWeekProjectionsReady({ probe, now })).toBe(true)
    expect(probe).toHaveBeenCalledTimes(2)

    resetFutureWeekProjectionsReadyCache()
    expect(await futureWeekProjectionsReady({ probe: async () => { throw new Error('no db') }, now })).toBe(false)
  })

  it('the default probe asks information_schema for BOTH tables', async () => {
    h.queryResult = [{ n: 1 }]
    expect(await futureWeekProjectionsReady()).toBe(false)
    expect(h.calls[0]!.sql).toMatch(/information_schema\.tables/)
    expect(h.calls[0]!.sql).toMatch(/'future_week_projections', 'future_week_projection_checks'/)
    resetFutureWeekProjectionsReadyCache()
    h.queryResult = [{ n: 2 }]
    expect(await futureWeekProjectionsReady()).toBe(true)
  })
})
