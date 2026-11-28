import { describe, expect, it } from 'vitest'
import type { PersistedActivityRecord } from '@/lib/decision-os/ingestion/importedActivityStore'
import {
  PrismaImportedActivityStore,
  type DecisionOsImportedActivityDelegate,
  type DecisionOsImportedActivityRow,
} from '@/lib/decision-os/ingestion/prismaImportedActivityStore'
import { writeImportedActivity } from '@/lib/decision-os/ingestion/importedActivityWriter'
import type { NormalizedImportedActivity } from '@/lib/decision-os/ingestion/importedActivityNormalizer'

/**
 * The batched read in front of the imported-activity writer (2026-11-23).
 *
 * 🛑 WHAT WAS SLOW. Every record cost two sequential round trips — `findUnique`, then `upsert` — and the
 * cron re-ingests a league's whole season each visit, so ~500 unchanged rows meant ~1,000 queries to land
 * a handful of new moves. Measured: ~38 leagues per 180s fire against 811 eligible, about three weeks a
 * lap. These tests pin the contract that made it fast without changing what is stored.
 */

/** In-memory delegate that counts every call, and stores JSON the way Postgres JSONB returns it. */
class CountingDelegate implements DecisionOsImportedActivityDelegate {
  rows = new Map<string, DecisionOsImportedActivityRow>()
  calls = { findUnique: 0, findMany: 0, upsert: 0 }
  constructor(private readonly withFindMany = true) {
    if (!withFindMany) (this as { findMany?: unknown }).findMany = undefined
  }
  async findUnique({ where }: { where: { externalSourceKey: string } }) {
    this.calls.findUnique += 1
    return this.rows.get(where.externalSourceKey) ?? null
  }
  async findMany({ where }: { where: { externalSourceKey: { in: string[] } } }) {
    this.calls.findMany += 1
    return where.externalSourceKey.in.map((k) => this.rows.get(k)).filter((r): r is DecisionOsImportedActivityRow => r != null)
  }
  async upsert({ where, create, update }: {
    where: { externalSourceKey: string }
    create: Omit<DecisionOsImportedActivityRow, 'createdAt' | 'updatedAt'>
    update: Omit<DecisionOsImportedActivityRow, 'createdAt' | 'updatedAt' | 'externalSourceKey'>
  }) {
    this.calls.upsert += 1
    const now = new Date()
    const existing = this.rows.get(where.externalSourceKey)
    // JSONB does not keep key order: store the JSON columns with their keys reversed, as a real
    // round trip may, so "unchanged" has to survive a reordering.
    const reorder = (v: unknown): unknown =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse().map(([k, x]) => [k, reorder(x)]))
        : v
    const base = existing ? { ...existing, ...update } : { ...create, createdAt: now }
    const row = { ...base, payload: reorder(base.payload), normalized: reorder(base.normalized), updatedAt: now } as DecisionOsImportedActivityRow
    this.rows.set(where.externalSourceKey, row)
    return row
  }
  async count() {
    return this.rows.size
  }
}

const record = (key: string, over: Partial<PersistedActivityRecord> = {}): PersistedActivityRecord => ({
  naturalKey: key,
  provider: 'sleeper',
  leagueId: 'sl-1',
  afLeagueId: 'af-1',
  activityType: 'waiver',
  occurredAt: '2026-11-20T00:11:42.203Z',
  managerKeys: ['sleeper:o-1'],
  hasExternalOnlyManager: true,
  payload: { adds: ['1945'], drops: ['13833'], bid: 7 },
  ...over,
})

describe('PrismaImportedActivityStore.prefetch', () => {
  it('an unchanged row is not written; a changed one is written once; a new one is created — with no per-row read', async () => {
    const d = new CountingDelegate()
    const store = new PrismaImportedActivityStore(d)
    await store.upsertByNaturalKey(record('a'))
    await store.upsertByNaturalKey(record('b'))
    d.calls = { findUnique: 0, findMany: 0, upsert: 0 }

    await store.prefetch(['a', 'b', 'c'])
    expect(await store.upsertByNaturalKey(record('a'))).toEqual({ status: 'unchanged' })
    expect(await store.upsertByNaturalKey(record('b', { payload: { adds: ['1945'], drops: ['13833'], bid: 9 } }))).toEqual({ status: 'updated' })
    expect(await store.upsertByNaturalKey(record('c'))).toEqual({ status: 'created' })

    expect(d.calls).toEqual({ findUnique: 0, findMany: 1, upsert: 2 })
    expect((d.rows.get('b')!.payload as { bid: number }).bid).toBe(9)
  })

  it('a change anywhere an update writes is a change: the time, the managers, the AF league', async () => {
    for (const changed of [
      record('a', { occurredAt: '2026-11-21T00:00:00.000Z' }),
      record('a', { managerKeys: ['sleeper:o-2'] }),
      record('a', { afLeagueId: 'af-2' }),
    ]) {
      const d = new CountingDelegate()
      const store = new PrismaImportedActivityStore(d)
      await store.upsertByNaturalKey(record('a'))
      await store.prefetch(['a'])
      expect(await store.upsertByNaturalKey(changed)).toEqual({ status: 'updated' })
    }
  })

  it('without findMany (an older fake, a narrower client) it keeps the original read-then-write path', async () => {
    const d = new CountingDelegate(false)
    const store = new PrismaImportedActivityStore(d)
    await store.upsertByNaturalKey(record('a'))
    await store.prefetch(['a'])
    expect(await store.upsertByNaturalKey(record('a'))).toEqual({ status: 'updated' })
    expect(d.calls.findUnique).toBe(2)
    expect(d.calls.upsert).toBe(2)
  })

  it('reads in chunks, so one league with thousands of rows is a few queries, not one giant statement', async () => {
    const d = new CountingDelegate()
    const store = new PrismaImportedActivityStore(d)
    await store.prefetch(Array.from({ length: 1_201 }, (_, i) => `k${i}`))
    expect(d.calls.findMany).toBe(3)
  })
})

describe('writeImportedActivity with a prefetching store', () => {
  const normalized = (key: string, bid: number): NormalizedImportedActivity =>
    ({
      naturalKey: key,
      provider: 'sleeper',
      leagueId: 'sl-1',
      afLeagueId: 'af-1',
      activityType: 'waiver',
      occurredAt: '2026-11-20T00:11:42.203Z',
      managerKeys: ['sleeper:o-1'],
      hasExternalOnlyManager: true,
      payload: { bid },
    }) as unknown as NormalizedImportedActivity

  it('a second pass over the same season writes only what changed, and says how much it left alone', async () => {
    const d = new CountingDelegate()
    const first = await writeImportedActivity([normalized('a', 1), normalized('b', 2), normalized('c', 3)], new PrismaImportedActivityStore(d))
    expect(first).toMatchObject({ created: 3, updated: 0, unchanged: 0 })

    d.calls = { findUnique: 0, findMany: 0, upsert: 0 }
    const second = await writeImportedActivity([normalized('a', 1), normalized('b', 2), normalized('c', 4), normalized('d', 5)], new PrismaImportedActivityStore(d))
    expect(second).toMatchObject({ created: 1, updated: 1, unchanged: 2 })
    // One batched read, two writes — not eight sequential round trips.
    expect(d.calls).toEqual({ findUnique: 0, findMany: 1, upsert: 2 })
    expect(second.persistedByActivityType.waiver).toBe(2)
  })
})
