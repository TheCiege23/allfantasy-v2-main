/**
 * Decision OS — Phase A Increment 4: Sleeper imported-activity emitter.
 *
 * Provider-SPECIFIC parsing layer (kept separate from the provider-neutral normalizer/writer/
 * store built in Increments 1–3). Converts real Sleeper API shapes
 * (`SleeperTransactionRaw`, `SleeperDraftPickRaw`, `SleeperRosterRaw` — the same types the
 * production Sleeper adapter already uses) into {@link RawImportedActivity}, which then flows
 * through the existing pipeline:
 *
 *   Sleeper payload → [this emitter] → RawImportedActivity[]
 *     → normalizeImportedActivityBatch (Increment 1)
 *     → writeImportedActivity (Increment 2)
 *     → ImportedActivityStore / PrismaImportedActivityStore (Increment 2/3)
 *     → DecisionOsImportedActivity rows
 *
 * Honest degradation (three independent layers, each reporting its own reason — no single layer
 * is trusted to catch everything):
 *   - THIS FILE skips transaction/pick SHAPES it cannot safely interpret (unsupported Sleeper
 *     `type`, non-`complete` status, a draft pick with no draft/season context to key it safely).
 *   - The normalizer (Increment 1) skips activity with no provider event id, no valid timestamp,
 *     or no attributable manager.
 *   - The writer/store (Increment 2/3) skip activity a concrete store cannot represent.
 * Nothing here fabricates a player, manager, roster, AppUser, or timestamp. Draft-pick
 * timestamps are NEVER invented internally — the caller must supply one (e.g. from context they
 * actually have); absent that, the pick is passed through with `occurredAt: null` and the
 * normalizer skips it honestly (`MISSING_OCCURRED_AT`).
 */

import type {
  SleeperTransactionRaw,
  SleeperDraftPickRaw,
  SleeperRosterRaw,
} from '@/lib/league-import/adapters/sleeper/types'
import {
  normalizeImportedActivityBatch,
  type RawImportedActivity,
  type ManagerIdentityIndex,
  type SkippedImportedActivity,
  type ImportedActivityType,
} from './importedActivityNormalizer'
import { writeImportedActivity, type WriteImportedActivitySummary } from './importedActivityWriter'
import type { ImportedActivityStore } from './importedActivityStore'

export interface SleeperEmitterSkip {
  providerEventId: string | null
  reason: 'UNSUPPORTED_TRANSACTION_TYPE' | 'TRANSACTION_NOT_COMPLETE' | 'MISSING_DRAFT_CONTEXT'
}

/** Sleeper `transaction.type` → Decision OS activity type. Anything else is unsupported (skipped). */
const TRANSACTION_TYPE_MAP: Readonly<Record<string, ImportedActivityType>> = {
  trade: 'trade',
  waiver: 'waiver',
  // An instant free-agent add/drop (no waiver process) — a roster move, safely representable.
  free_agent: 'roster_move',
}

/**
 * Build a `roster_id → Sleeper owner user_id` lookup from raw rosters, mirroring the exact
 * convention the production Sleeper adapter uses (`SleeperRosterMapper`): a trimmed, non-empty
 * `owner_id`, or `null` for an orphan roster (no manager to attribute to — never fabricated).
 */
export function buildRosterOwnerMap(
  rosters: readonly SleeperRosterRaw[],
): ReadonlyMap<number, string | null> {
  const map = new Map<number, string | null>()
  for (const r of rosters) {
    const ownerId = typeof r.owner_id === 'string' ? r.owner_id.trim() : ''
    map.set(r.roster_id, ownerId || null)
  }
  return map
}

function isFiniteEpochMs(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/** Convert Sleeper transactions (trades / waivers / free-agent moves) into raw imported activity. */
export function emitSleeperTransactionActivity(
  transactions: readonly SleeperTransactionRaw[],
  ctx: { leagueId: string; rosterOwnerMap: ReadonlyMap<number, string | null> },
): { raws: RawImportedActivity[]; skipped: SleeperEmitterSkip[] } {
  const raws: RawImportedActivity[] = []
  const skipped: SleeperEmitterSkip[] = []

  for (const tx of transactions) {
    const providerEventId = tx.transaction_id ?? null
    const activityType = TRANSACTION_TYPE_MAP[tx.type]
    if (!activityType) {
      skipped.push({ providerEventId, reason: 'UNSUPPORTED_TRANSACTION_TYPE' })
      continue
    }
    if (tx.status !== 'complete') {
      // Pending/failed/vetoed transactions are not final — never treat them as having happened.
      skipped.push({ providerEventId, reason: 'TRANSACTION_NOT_COMPLETE' })
      continue
    }

    const managerSourceIds = (tx.roster_ids ?? [])
      .map((rid) => ctx.rosterOwnerMap.get(rid))
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    raws.push({
      provider: 'sleeper',
      leagueId: ctx.leagueId,
      activityType,
      providerEventId,
      // Sleeper's `created` is an epoch-ms real timestamp; never substituted when absent/invalid.
      occurredAt: isFiniteEpochMs(tx.created) ? new Date(tx.created).toISOString() : null,
      managerSourceIds,
      payload: {
        source: 'sleeper_transaction',
        transactionType: tx.type,
        adds: tx.adds ?? null,
        drops: tx.drops ?? null,
        draftPicks: tx.draft_picks ?? null,
      },
    })
  }

  return { raws, skipped }
}

/**
 * Convert Sleeper draft picks into raw imported activity. `occurredAt` must be supplied by the
 * caller (Sleeper's per-pick payload carries no per-pick timestamp) — passing `null` is honest
 * and causes the normalizer to skip the pick (`MISSING_OCCURRED_AT`) rather than fabricate a time.
 */
export function emitSleeperDraftPickActivity(
  picks: readonly SleeperDraftPickRaw[],
  ctx: {
    leagueId: string
    rosterOwnerMap: ReadonlyMap<number, string | null>
    /** Real timestamp for these picks if known (e.g. draft start_time); never invented if absent. */
    occurredAt: string | null
  },
): { raws: RawImportedActivity[]; skipped: SleeperEmitterSkip[] } {
  const raws: RawImportedActivity[] = []
  const skipped: SleeperEmitterSkip[] = []

  for (const pick of picks) {
    // pick_no alone repeats across drafts/seasons — need real context to key it safely.
    const context = pick.draft_id ?? pick.season ?? null
    if (!context) {
      skipped.push({ providerEventId: null, reason: 'MISSING_DRAFT_CONTEXT' })
      continue
    }
    const providerEventId = `${context}:${pick.pick_no}`
    const pickedBy = typeof pick.picked_by === 'string' ? pick.picked_by.trim() : ''
    const managerSourceId = pickedBy || ctx.rosterOwnerMap.get(pick.roster_id) || null

    raws.push({
      provider: 'sleeper',
      leagueId: ctx.leagueId,
      activityType: 'draft_pick',
      providerEventId,
      occurredAt: ctx.occurredAt,
      managerSourceIds: managerSourceId ? [managerSourceId] : [],
      payload: {
        source: 'sleeper_draft_pick',
        round: pick.round,
        pickNo: pick.pick_no,
        playerId: pick.player_id,
        metadata: pick.metadata ?? null,
      },
    })
  }

  return { raws, skipped }
}

export interface SleeperIngestionResult {
  writer: WriteImportedActivitySummary
  emitterSkipped: SleeperEmitterSkip[]
  normalizerSkipped: SkippedImportedActivity[]
}

/**
 * End-to-end Sleeper ingestion: emitter → normalizer → writer → store. This is the single
 * entry point a Sleeper backfill/sync job calls once real payload data is available.
 */
export async function ingestSleeperImportedActivity(
  input: {
    leagueId: string
    transactions?: readonly SleeperTransactionRaw[]
    draftPicks?: readonly SleeperDraftPickRaw[]
    rosters?: readonly SleeperRosterRaw[]
    /** Real timestamp for draftPicks if known; null (default) if not — never fabricated. */
    draftPicksOccurredAt?: string | null
  },
  identityIndex: ManagerIdentityIndex,
  store: ImportedActivityStore,
): Promise<SleeperIngestionResult> {
  const rosterOwnerMap = buildRosterOwnerMap(input.rosters ?? [])

  const txResult = emitSleeperTransactionActivity(input.transactions ?? [], {
    leagueId: input.leagueId,
    rosterOwnerMap,
  })
  const pickResult = emitSleeperDraftPickActivity(input.draftPicks ?? [], {
    leagueId: input.leagueId,
    rosterOwnerMap,
    occurredAt: input.draftPicksOccurredAt ?? null,
  })

  const { normalized, skipped: normalizerSkipped } = normalizeImportedActivityBatch(
    [...txResult.raws, ...pickResult.raws],
    identityIndex,
  )
  const writer = await writeImportedActivity(normalized, store)

  return {
    writer,
    emitterSkipped: [...txResult.skipped, ...pickResult.skipped],
    normalizerSkipped,
  }
}
