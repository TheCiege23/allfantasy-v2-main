/**
 * Fantasy OS Suite — Phase D Increment 7.
 *
 * Pure, testable helpers for `decision-os-ingest-sleeper-activity-nonprod.ts`. Kept separate from
 * the script itself (which pulls in the Prisma singleton and makes real network calls) so the real
 * Sleeper-API-shape reconciliation and the week-range/timestamp logic have a genuine unit-test seam,
 * mirroring `scripts/decision-os-suite-conformance-helpers.ts`'s own established pattern.
 *
 * Provider-agnostic architecture note: these helpers are deliberately Sleeper-SPECIFIC (this is the
 * provider-specific emitter layer, exactly like `lib/decision-os/ingestion/sleeperActivityEmitter.ts`
 * itself) — the layer they feed (`RawImportedActivity`, the normalizer, the writer, the store) stays
 * provider-blind. A future provider's orchestration script would have its own equivalent helpers
 * file, never touching this one.
 */

import type { SleeperTransaction } from '../lib/sleeper-client'
import type {
  SleeperTransactionRaw,
  SleeperDraftPickRaw,
} from '../lib/league-import/adapters/sleeper/types'
import type { ExternalIdentityMapping } from '../lib/league-import/types'

/**
 * Sleeper's `/league/{id}/transactions/{week}` endpoint is per-week — reconstructing a full season
 * requires looping over every week. NFL seasons run at most 18 weeks (17 regular + playoffs); this
 * is deliberately a small, fixed, honest upper bound, not a guess at the league's real schedule
 * length — fetching a week with no transactions yet just returns an empty array, never an error.
 */
export function buildWeekRange(totalWeeks: number): number[] {
  const safeTotal = Math.max(1, Math.min(18, Math.trunc(totalWeeks)))
  return Array.from({ length: safeTotal }, (_, i) => i + 1)
}

/**
 * Reconcile the real `SleeperTransaction` shape (`lib/sleeper-client.ts`, this repo's existing
 * public-API client) into the `SleeperTransactionRaw` shape the emitter
 * (`lib/decision-os/ingestion/sleeperActivityEmitter.ts`) expects. Both describe the SAME real
 * Sleeper API response — this is a type-shape reconciliation between two independently-written
 * type definitions for it, not a new derivation. `adds`/`drops` values differ only in whether they
 * were typed as `number` (player→roster) or `string` — the emitter only ever carries them through
 * as opaque payload, never reads their value type, so a safe key-preserving remap is honest.
 */
export function mapSleeperTransactionToRaw(tx: SleeperTransaction): SleeperTransactionRaw {
  const remap = (m: Record<string, number> | null): Record<string, string> | undefined =>
    m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)])) : undefined

  return {
    transaction_id: tx.transaction_id,
    type: tx.type,
    status: tx.status,
    created: tx.created,
    adds: remap(tx.adds),
    drops: remap(tx.drops),
    draft_picks: tx.draft_picks,
    roster_ids: tx.roster_ids,
  }
}

/** A minimal structural check for the real (untyped) Sleeper draft-pick API response shape. */
interface RawSleeperDraftPickResponseItem {
  round?: unknown
  roster_id?: unknown
  player_id?: unknown
  picked_by?: unknown
  pick_no?: unknown
}

/**
 * Reconcile one real Sleeper draft-pick API response item into `SleeperDraftPickRaw`. The endpoint
 * (`getDraftPicks`, `lib/sleeper-client.ts`) is untyped (`any[]`) at its source — this performs a
 * real runtime shape check and returns `null` (never a fabricated pick) when required fields are
 * missing, mirroring the normalizer's own "skip honestly, never guess" contract.
 */
export function mapSleeperDraftPickResponseItem(
  item: unknown,
  draftId: string,
  season: string | undefined,
): SleeperDraftPickRaw | null {
  const candidate = item as RawSleeperDraftPickResponseItem
  if (
    typeof candidate?.round !== 'number' ||
    typeof candidate?.roster_id !== 'number' ||
    typeof candidate?.player_id !== 'string' ||
    typeof candidate?.pick_no !== 'number'
  ) {
    return null
  }
  return {
    round: candidate.round,
    roster_id: candidate.roster_id,
    player_id: candidate.player_id,
    picked_by: typeof candidate.picked_by === 'string' ? candidate.picked_by : undefined,
    pick_no: candidate.pick_no,
    season,
    draft_id: draftId,
  }
}

/** A minimal structural check for the real (untyped) Sleeper draft API response shape. */
interface RawSleeperDraftResponseItem {
  draft_id?: unknown
  season?: unknown
  start_time?: unknown
}

/**
 * Extract a real draft start timestamp from a Sleeper draft object, if present and valid. Returns
 * `null` (never invented) when absent — the caller passes this straight through to
 * `emitSleeperDraftPickActivity`'s `occurredAt`, which itself already causes the normalizer to skip
 * picks honestly (`MISSING_OCCURRED_AT`) rather than fabricate a time.
 */
export function resolveDraftOccurredAt(draft: unknown): string | null {
  const candidate = draft as RawSleeperDraftResponseItem
  const raw = candidate?.start_time
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null
  return new Date(raw).toISOString()
}

export function getDraftId(draft: unknown): string | null {
  const candidate = draft as RawSleeperDraftResponseItem
  return typeof candidate?.draft_id === 'string' && candidate.draft_id.length > 0 ? candidate.draft_id : null
}

/**
 * Build a real, honest `ExternalIdentityMapping` for one Sleeper roster owner. `resolveAfUserId` is
 * injected (not called directly here) so this function stays pure and unit-testable without a
 * database — the real script supplies a Prisma-backed lookup against `UserProfile.sleeperUserId`
 * (the real, persisted reverse-lookup: which AF account, if any, has linked this Sleeper user id).
 * Falls back to a stable, deterministic `stable_key` for a manager with no linked AF account —
 * mirroring the EXACT convention `docs/os/THE_REPLACEMENTS_PROVIDER_ADAPTER_PLAN.md` §5 documents,
 * and the same external-only attribution path Decision OS Phase A already proved on fixtures.
 */
export async function buildSleeperManagerMapping(
  sleeperUserId: string,
  resolveAfUserId: (sleeperUserId: string) => Promise<string | null>,
): Promise<ExternalIdentityMapping> {
  const afId = await resolveAfUserId(sleeperUserId)
  return {
    source_provider: 'sleeper',
    source_id: sleeperUserId,
    entity_type: 'manager',
    af_id: afId,
    stable_key: `sleeper:${sleeperUserId}`,
  }
}

/**
 * Phase D Increment 8 (runbook hardening). `lib/sleeper-client.ts`'s fetchers catch every error and
 * return `[]` on failure — a genuine zero-activity league and a silently-failed fetch (bad league
 * id, network hiccup, Sleeper API downtime) are otherwise indistinguishable to an operator reading
 * the script's own log output. This makes that distinction explicit: rosters resolved (the earlier
 * "zero rosters" check already refuses honestly) but BOTH transactions and draft picks came back
 * empty is worth a warning, not a silent "0 activity, done."
 */
export function shouldWarnPossibleSilentFetchFailure(
  rosterCount: number,
  transactionCount: number,
  draftPickCount: number,
): boolean {
  return rosterCount > 0 && transactionCount === 0 && draftPickCount === 0
}

/** De-duplicated, order-stable list of every real Sleeper user id that owns at least one roster. */
export function collectRosterOwnerIds(rosters: readonly { owner_id?: string | null }[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const r of rosters) {
    const id = typeof r.owner_id === 'string' ? r.owner_id.trim() : ''
    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}
