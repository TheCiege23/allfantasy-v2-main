/**
 * Decision OS — Phase A Increment 2: imported-activity writer / orchestrator.
 *
 * Consumes the normalized activity seam (Increment 1) and persists it idempotently via the
 * provider-neutral {@link ImportedActivityStore} port. Pure orchestration — no Prisma, no
 * provider parsing — so repeated syncs converge on the same persisted state (proven by the
 * Increment 2 tests) and the concrete DB adapter can be swapped in for Increment 3.
 *
 * Honest degradation: records the store cannot represent are surfaced as `skipped` with the
 * store's reason (e.g. external-only manager into an AF-account-coupled table). Nothing is
 * fabricated to force a write.
 */

import type { NormalizedImportedActivity, ImportedActivityType } from './importedActivityNormalizer'
import {
  toPersistedActivityRecord,
  type ImportedActivityStore,
  type PersistedActivityRecord,
} from './importedActivityStore'

export interface WriteImportedActivitySummary {
  total: number
  created: number
  updated: number
  /** Already stored with identical content, so not written (stores with `prefetch`). Absent from `persistedByActivityType`. */
  unchanged: number
  skipped: number
  /** Store-reported skip reasons → count (honest, never fabricated). */
  skippedReasons: Record<string, number>
  /** Records that included ≥1 manager attributed only via provider stable_key (no AF account). */
  externalOnlyManagerRecords: number
  /** Per-activity-type persisted (created+updated) counts, for surface/telemetry reporting. */
  persistedByActivityType: Record<ImportedActivityType, number>
}

function emptyByType(): Record<ImportedActivityType, number> {
  return { trade: 0, waiver: 0, roster_move: 0, draft_pick: 0 }
}

/**
 * Persist a batch of normalized imported activity idempotently. Order-independent and
 * re-runnable: the store's natural-key upsert guarantees a second pass produces `updated`
 * (not `created`) for already-persisted activity, so the persisted state converges.
 */
export async function writeImportedActivity(
  records: readonly NormalizedImportedActivity[],
  store: ImportedActivityStore,
): Promise<WriteImportedActivitySummary> {
  const summary: WriteImportedActivitySummary = {
    total: records.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    skippedReasons: {},
    externalOnlyManagerRecords: 0,
    persistedByActivityType: emptyByType(),
  }

  const persistedRecords = records.map((record) => toPersistedActivityRecord(record))
  // One batched read up front where the store supports it (2026-11-23): no per-row existence read,
  // and unchanged rows are not rewritten. Stores without it behave exactly as before.
  if (store.prefetch && persistedRecords.length > 0) await store.prefetch(persistedRecords.map((r) => r.naturalKey))

  for (const [i, record] of records.entries()) {
    const persisted: PersistedActivityRecord = persistedRecords[i]!
    const result = await store.upsertByNaturalKey(persisted)

    if (result.status === 'skipped') {
      summary.skipped += 1
      summary.skippedReasons[result.reason] = (summary.skippedReasons[result.reason] ?? 0) + 1
      continue
    }
    if (result.status === 'unchanged') {
      summary.unchanged += 1
      continue
    }

    if (result.status === 'created') summary.created += 1
    else summary.updated += 1
    summary.persistedByActivityType[record.activityType] += 1
    if (record.hasExternalOnlyManager) summary.externalOnlyManagerRecords += 1
  }

  return summary
}
