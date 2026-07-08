/**
 * Decision OS — Phase A ingestion seam.
 *
 * Provider-agnostic normalizer that turns raw imported league activity (trades, waiver
 * claims, roster moves, draft picks) into a canonical ingestion record carrying:
 *   1. a DETERMINISTIC natural key  → makes downstream DB upserts idempotent (re-runnable
 *      backfill converges instead of duplicating);
 *   2. a resolved MANAGER KEY per participant → reuses the existing import
 *      {@link ExternalIdentityMapping} so managers who have NO AllFantasy account are still
 *      attributable via their provider `stable_key` (the external-manager-identity blocker);
 *   3. HONEST DEGRADATION → activity that can't be keyed or attributed is returned as a
 *      `skipped` record with a reason. It is NEVER fabricated or given a random id.
 *
 * This is the pure transformation layer that the (next-increment) DB-write layer consumes:
 * it upserts the four behavioral-input tables the Decision OS behavioral pipeline reads
 * (`afLeagueTrade`/`redraftTradeProposal`, `waiverClaim`, `afRosterMoveHistory`/
 * `redraftRosterMoveHistory`, `draftPick`) keyed by `naturalKey`. Keeping it pure keeps it
 * unit-testable without a live DB, and provider-open (Sleeper first; Yahoo/ESPN/Fantrax/MFL/
 * The Replacements plug in by emitting {@link RawImportedActivity}).
 */

import type { ImportProvider, ExternalIdentityMapping } from '@/lib/league-import/types'

/** The activity kinds the Decision OS behavioral pipeline derives intelligence from. */
export type ImportedActivityType = 'trade' | 'waiver' | 'roster_move' | 'draft_pick'

/**
 * Provider-agnostic raw activity emitted by an import adapter. Adapters map their native
 * shape (e.g. a Sleeper `transaction`) into this; the normalizer stays provider-blind.
 */
export interface RawImportedActivity {
  provider: ImportProvider
  leagueId: string
  activityType: ImportedActivityType
  /** Provider's own stable id for this event (Sleeper `transaction_id`, draft pick id, …). Required for idempotency. */
  providerEventId: string | null | undefined
  /** ISO-8601 instant the activity occurred (for trend ordering). */
  occurredAt: string | null | undefined
  /** Provider source ids of the managers involved (roster owner ids / user ids). */
  managerSourceIds: string[]
  /** Opaque provider payload, carried through for the write layer (never invented here). */
  payload?: unknown
}

/** A normalized, idempotency-keyed, attributable activity record ready for upsert. */
export interface NormalizedImportedActivity {
  skipped: false
  naturalKey: string
  provider: ImportProvider
  leagueId: string
  activityType: ImportedActivityType
  occurredAt: string
  /** Resolved manager keys (af_id when present, else provider stable_key). Order-stable, de-duped. */
  managerKeys: string[]
  /** True when at least one manager had no AF account and was attributed via stable_key only. */
  hasExternalOnlyManager: boolean
  payload?: unknown
}

/** Activity that could not be safely normalized — surfaced honestly, never fabricated. */
export interface SkippedImportedActivity {
  skipped: true
  reason:
    | 'MISSING_PROVIDER_EVENT_ID'
    | 'MISSING_OCCURRED_AT'
    | 'NO_ATTRIBUTABLE_MANAGER'
  provider: ImportProvider
  leagueId: string
  activityType: ImportedActivityType
}

export type NormalizeResult = NormalizedImportedActivity | SkippedImportedActivity

/** Index of manager identity mappings keyed by provider `source_id` (from ExternalIdentityMapper output). */
export type ManagerIdentityIndex = ReadonlyMap<string, ExternalIdentityMapping>

/**
 * Deterministic natural key for an imported activity. Same provider event → same key across
 * every backfill run → the write layer's upsert converges (idempotency). Segments are
 * delimiter-escaped so ids containing ':' can't collide.
 */
export function deriveActivityNaturalKey(
  provider: ImportProvider,
  leagueId: string,
  activityType: ImportedActivityType,
  providerEventId: string,
): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:')
  return ['dos', 'act', esc(provider), esc(leagueId), esc(activityType), esc(providerEventId)].join(':')
}

/**
 * Resolve one manager to a stable key: AF canonical id when the manager has an AllFantasy
 * account, otherwise the provider `stable_key`. Returns null when neither exists — the caller
 * degrades honestly rather than inventing an identity.
 */
export function resolveManagerKey(mapping: ExternalIdentityMapping | undefined): string | null {
  if (!mapping) return null
  if (mapping.entity_type !== 'manager') return null
  if (mapping.af_id) return mapping.af_id
  if (mapping.stable_key) return mapping.stable_key
  return null
}

function buildIdentityIndexEntry(mapping: ExternalIdentityMapping): [string, ExternalIdentityMapping] {
  return [mapping.source_id, mapping]
}

/** Build a lookup index from a flat list of manager identity mappings (convenience for callers). */
export function buildManagerIdentityIndex(mappings: readonly ExternalIdentityMapping[]): ManagerIdentityIndex {
  const index = new Map<string, ExternalIdentityMapping>()
  for (const m of mappings) {
    if (m.entity_type === 'manager') {
      const [k, v] = buildIdentityIndexEntry(m)
      index.set(k, v)
    }
  }
  return index
}

/**
 * Normalize one raw imported activity. Pure + deterministic: idempotent by natural key,
 * attributable via the external identity map (AF users and non-AF managers alike), and
 * honestly degrading when it can't be keyed or attributed.
 */
export function normalizeImportedActivity(
  raw: RawImportedActivity,
  identityIndex: ManagerIdentityIndex,
): NormalizeResult {
  const base = { provider: raw.provider, leagueId: raw.leagueId, activityType: raw.activityType }

  const providerEventId = (raw.providerEventId ?? '').trim()
  if (!providerEventId) {
    return { skipped: true, reason: 'MISSING_PROVIDER_EVENT_ID', ...base }
  }
  const occurredAt = (raw.occurredAt ?? '').trim()
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    return { skipped: true, reason: 'MISSING_OCCURRED_AT', ...base }
  }

  // Resolve every participant; keep only real, de-duped keys in stable order.
  const seen = new Set<string>()
  const managerKeys: string[] = []
  let hasExternalOnlyManager = false
  for (const sourceId of raw.managerSourceIds ?? []) {
    const mapping = identityIndex.get(sourceId)
    const key = resolveManagerKey(mapping)
    if (!key || seen.has(key)) continue
    seen.add(key)
    managerKeys.push(key)
    if (mapping && !mapping.af_id && mapping.stable_key) hasExternalOnlyManager = true
  }

  if (managerKeys.length === 0) {
    // No manager could be attributed — do not fabricate one. Surface honestly.
    return { skipped: true, reason: 'NO_ATTRIBUTABLE_MANAGER', ...base }
  }

  return {
    skipped: false,
    naturalKey: deriveActivityNaturalKey(raw.provider, raw.leagueId, raw.activityType, providerEventId),
    provider: raw.provider,
    leagueId: raw.leagueId,
    activityType: raw.activityType,
    occurredAt: new Date(occurredAt).toISOString(),
    managerKeys,
    hasExternalOnlyManager,
    payload: raw.payload,
  }
}

/** Normalize a batch; returns kept + skipped partitions so callers can log/telemeter honestly. */
export function normalizeImportedActivityBatch(
  raws: readonly RawImportedActivity[],
  identityIndex: ManagerIdentityIndex,
): { normalized: NormalizedImportedActivity[]; skipped: SkippedImportedActivity[] } {
  const normalized: NormalizedImportedActivity[] = []
  const skipped: SkippedImportedActivity[] = []
  for (const raw of raws) {
    const r = normalizeImportedActivity(raw, identityIndex)
    if (r.skipped) skipped.push(r)
    else normalized.push(r)
  }
  return { normalized, skipped }
}
