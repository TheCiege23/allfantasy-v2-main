/**
 * Decision OS — Phase A Increment 2: imported-activity persistence port.
 *
 * Provider-neutral persistence boundary. The writer/orchestrator
 * ({@link ../ingestion/importedActivityWriter}) depends only on this interface, so:
 *   - the idempotent-upsert LOGIC is unit-testable against the in-memory reference store
 *     below (no live DB required);
 *   - the concrete Prisma-backed adapter (Increment 3) is swapped in without touching the
 *     writer or the pure normalizer.
 *
 * Idempotency contract: `upsertByNaturalKey` MUST be keyed solely on `record.naturalKey`
 * (the deterministic key produced by the normalizer). Re-persisting the same imported
 * activity therefore CONVERGES to a single row instead of duplicating — the property the
 * Increment 2 tests assert.
 *
 * Honest degradation: a store MAY return `{ status: 'skipped', reason }` for activity it
 * cannot represent (e.g. the concrete Prisma adapter cannot write an `afLeagueTrade` row
 * for an external-only manager because `proposedByUserId` is a required AppUser FK — see the
 * implementation doc). Skips are surfaced, never fabricated around.
 */

import type { ImportProvider } from '@/lib/league-import/types'
import type { ImportedActivityType, NormalizedImportedActivity } from './importedActivityNormalizer'

/** A persistence-ready imported activity record (the normalizer output, minus the skip discriminant). */
export interface PersistedActivityRecord {
  naturalKey: string
  provider: ImportProvider
  /** The PROVIDER's league id → `DecisionOsImportedActivity.providerLeagueId`. Part of `naturalKey`. */
  leagueId: string
  /** AllFantasy canonical `League.id` when mapped → `afLeagueId`. Null when unmapped; never fabricated. */
  afLeagueId?: string | null
  activityType: ImportedActivityType
  occurredAt: string
  managerKeys: string[]
  hasExternalOnlyManager: boolean
  payload?: unknown
}

export type UpsertResult =
  | { status: 'created' }
  | { status: 'updated' }
  | { status: 'skipped'; reason: string }

/** Provider-neutral persistence boundary consumed by the writer. */
export interface ImportedActivityStore {
  /** Idempotent by `record.naturalKey`. Transaction-safe when DB-backed. */
  upsertByNaturalKey(record: PersistedActivityRecord): Promise<UpsertResult>
  /** Number of persisted rows (verification/tests). */
  count(): Promise<number>
  /** Fetch a persisted row by natural key (verification/tests). */
  getByNaturalKey(naturalKey: string): Promise<PersistedActivityRecord | null>
}

/** Map a normalized activity to its persistence-ready shape. */
export function toPersistedActivityRecord(n: NormalizedImportedActivity): PersistedActivityRecord {
  return {
    naturalKey: n.naturalKey,
    provider: n.provider,
    leagueId: n.leagueId,
    afLeagueId: n.afLeagueId ?? null,
    activityType: n.activityType,
    occurredAt: n.occurredAt,
    managerKeys: [...n.managerKeys],
    hasExternalOnlyManager: n.hasExternalOnlyManager,
    payload: n.payload,
  }
}

/**
 * In-memory reference implementation. Idempotent by construction (a Map keyed on
 * `naturalKey`), so it doubles as the executable contract for the DB adapter and as the
 * test double for Increment 2. It never skips — real per-table constraints belong to the
 * Prisma adapter (Increment 3).
 */
export class InMemoryImportedActivityStore implements ImportedActivityStore {
  private readonly rows = new Map<string, PersistedActivityRecord>()

  async upsertByNaturalKey(record: PersistedActivityRecord): Promise<UpsertResult> {
    const exists = this.rows.has(record.naturalKey)
    // Clone so external mutation of the input can't retro-edit persisted state.
    this.rows.set(record.naturalKey, { ...record, managerKeys: [...record.managerKeys] })
    return { status: exists ? 'updated' : 'created' }
  }

  async count(): Promise<number> {
    return this.rows.size
  }

  async getByNaturalKey(naturalKey: string): Promise<PersistedActivityRecord | null> {
    const r = this.rows.get(naturalKey)
    return r ? { ...r, managerKeys: [...r.managerKeys] } : null
  }

  /** Deterministic snapshot of persisted state (for convergence assertions). */
  snapshot(): PersistedActivityRecord[] {
    return [...this.rows.values()]
      .map((r) => ({ ...r, managerKeys: [...r.managerKeys] }))
      .sort((a, b) => a.naturalKey.localeCompare(b.naturalKey))
  }
}
