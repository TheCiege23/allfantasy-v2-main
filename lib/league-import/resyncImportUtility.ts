/**
 * Safe re-import: same external league + user → upsert league row + audit run.
 * Uses the same idempotency key as `persistImportWithCanonicalAudit`.
 * Idempotent: completed runs short-circuit in `persistImportWithCanonicalAudit` unless upstream forces refresh.
 */

import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
import { persistImportWithCanonicalAudit } from '@/lib/league-import/importPersistenceService'
import type { ImportProvider } from '@/lib/league-import/types'

/**
 * Honest, sanitized outcome of the durable Sleeper read-model refresh — no provider payload,
 * credentials, or lock token. `kind:'sync'` carries the durable run outcome; `kind:'auth'` carries a
 * pre-run authorization / not-found / invalid-connection failure with its HTTP status; null = a
 * non-Sleeper provider (no durable refresh step).
 */
export type SleeperResyncRefresh =
  | { kind: 'sync'; status: string; advancedFreshness: boolean; executed: boolean }
  | { kind: 'auth'; httpStatus: 400 | 403 | 404; error: string }
  | null

export async function resyncImportedLeague(input: {
  userId: string
  provider: ImportProvider
  sourceId: string
}): Promise<
  | {
      ok: true
      leagueId: string
      runId: string
      warningCount: number
      reviewRequired: boolean
      /** Honest, sanitized outcome of the durable read-model refresh (Sleeper only); null for others. */
      refresh: SleeperResyncRefresh
    }
  | { ok: false; error: string }
> {
  const result = await runImportedLeagueNormalizationPipeline({
    provider: input.provider,
    sourceId: input.sourceId,
    userId: input.userId,
  })
  if (!result.success) {
    return { ok: false, error: result.error }
  }

  const canonical = buildCanonicalImportBundle(result.normalized)
  try {
    const { persisted, runId } = await persistImportWithCanonicalAudit({
      userId: input.userId,
      provider: input.provider,
      normalized: result.normalized,
      canonical,
      allowUpdateExisting: true,
    })

    // Launch Batch 2 — durable read-model refresh. `persistImportWithCanonicalAudit` short-circuits an
    // already-`completed` ImportRun (its idempotency key has no payload hash), so on a re-sync it returns
    // the existing league WITHOUT re-persisting. For Sleeper we therefore drive the SAME durable collector
    // the scheduled cron uses — the distributed lock, LeagueSyncState checkpoints, SyncJobRun telemetry,
    // failure accounting, and certified freshness (League.lastSyncedAt advances only on completion) — over
    // the payload we already fetched (NO second Sleeper call). It keeps the same League.id, refreshes every
    // mirror, and preserves claims. The outcome is surfaced honestly, never a silently-swallowed failure.
    let refresh: SleeperResyncRefresh = null
    if (input.provider === 'sleeper' && persisted.league.id) {
      const { manualRefreshConnectedSleeperLeague } = await import('@/lib/fantasy-os/sync/collector')
      const out = await manualRefreshConnectedSleeperLeague({
        userId: input.userId,
        leagueId: persisted.league.id,
        fetchNormalized: async () => result.normalized, // reuse the payload already fetched above
      })
      refresh = out.ok
        ? {
            kind: 'sync',
            status: out.sync.status ?? out.sync.reason ?? 'unknown',
            advancedFreshness: Boolean(out.sync.advancedFreshness),
            executed: Boolean(out.sync.executed),
          }
        : { kind: 'auth', httpStatus: out.status, error: out.error }
    }

    return {
      ok: true,
      leagueId: persisted.league.id,
      runId,
      warningCount: canonical.warnings.length,
      reviewRequired: canonical.reviewRequired,
      refresh,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
