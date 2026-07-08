/**
 * Decision OS — Phase A Increment 5: behavioral snapshot trend-history store.
 *
 * Provider-neutral persistence boundary, mirroring the Increment 2 `ImportedActivityStore`
 * pattern: pure transformation (capture) stays separate from DB writes (this port), and the
 * in-memory reference implementation doubles as the DB-adapter contract + test double.
 *
 * Idempotency contract: `upsertByPeriod` is keyed on `(leagueId, managerId, periodKey)`. Running
 * the scheduled capture job twice for the same day converges to ONE row per (league|manager,
 * period) — re-run safety. A NEW period (a later day) naturally appends a NEW row — that
 * append-over-time IS the trend history.
 *
 * `listTrend` returns rows ordered oldest → newest, which is the trend derivation's raw input.
 */

import type { BehavioralSnapshotRecord } from './behavioralSnapshotCapture'

export type SnapshotUpsertResult = { status: 'created' } | { status: 'updated' }

export interface ListTrendParams {
  leagueId: string
  /** `null`/omitted = league-scope trend. A manager id = that manager's trend. */
  managerId?: string | null
  limit?: number
}

export interface BehavioralSnapshotStore {
  /** Idempotent by (leagueId, managerId, periodKey). */
  upsertByPeriod(record: BehavioralSnapshotRecord): Promise<SnapshotUpsertResult>
  /** Oldest → newest, for the given league (+ optional manager) scope. */
  listTrend(params: ListTrendParams): Promise<BehavioralSnapshotRecord[]>
  count(): Promise<number>
}

/** The persistence-layer key. `managerId` uses a stable sentinel for league-scope rows (see
 * `prismaBehavioralSnapshotStore.ts` for why: a nullable column can't enforce a unique
 * constraint against NULL in Postgres, since NULL is never equal to itself). */
export function snapshotStoreKey(leagueId: string, managerId: string | null, periodKey: string): string {
  return `${leagueId}::${managerId ?? '__league__'}::${periodKey}`
}

export class InMemoryBehavioralSnapshotStore implements BehavioralSnapshotStore {
  private readonly rows = new Map<string, BehavioralSnapshotRecord>()

  async upsertByPeriod(record: BehavioralSnapshotRecord): Promise<SnapshotUpsertResult> {
    const key = snapshotStoreKey(record.leagueId, record.managerId, record.periodKey)
    const exists = this.rows.has(key)
    this.rows.set(key, { ...record })
    return { status: exists ? 'updated' : 'created' }
  }

  async listTrend(params: ListTrendParams): Promise<BehavioralSnapshotRecord[]> {
    const managerId = params.managerId ?? null
    const rows = [...this.rows.values()]
      .filter((r) => r.leagueId === params.leagueId && r.managerId === managerId)
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
    return typeof params.limit === 'number' ? rows.slice(-params.limit) : rows
  }

  async count(): Promise<number> {
    return this.rows.size
  }

  /** Deterministic full snapshot of persisted state (test convergence assertions). */
  snapshot(): BehavioralSnapshotRecord[] {
    return [...this.rows.values()].sort((a, b) =>
      `${a.leagueId}:${a.managerId}:${a.periodKey}`.localeCompare(`${b.leagueId}:${b.managerId}:${b.periodKey}`),
    )
  }
}
