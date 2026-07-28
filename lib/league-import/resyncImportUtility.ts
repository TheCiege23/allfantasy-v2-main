/**
 * Safe re-import: same external league + user → upsert league row + audit run.
 * Uses the same idempotency key as `persistImportWithCanonicalAudit`.
 * Idempotent: completed runs short-circuit in `persistImportWithCanonicalAudit` unless upstream forces refresh.
 */

import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
import { persistImportWithCanonicalAudit } from '@/lib/league-import/importPersistenceService'
import type { ImportProvider } from '@/lib/league-import/types'

export async function resyncImportedLeague(input: {
  userId: string
  provider: ImportProvider
  sourceId: string
}): Promise<
  | { ok: true; leagueId: string; runId: string; warningCount: number; reviewRequired: boolean }
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
    // the existing league WITHOUT re-persisting. For Sleeper we therefore drive the SAME idempotent
    // collector the scheduled cron uses over the payload we already fetched (no second provider call), so
    // a manual re-sync actually refreshes League/LeagueTeam/Roster instead of silently no-op'ing.
    if (input.provider === 'sleeper' && persisted.league.id) {
      try {
        const { applySleeperScopeToLeague } = await import('@/lib/fantasy-os/sync/collector')
        const { SLEEPER_SYNC_SCOPES } = await import('@/lib/fantasy-os/sync/collector')
        for (const scope of SLEEPER_SYNC_SCOPES) {
          await applySleeperScopeToLeague({ leagueId: persisted.league.id, scope, normalized: result.normalized })
        }
      } catch {
        // Non-fatal: the audit row is already committed; the scheduled cron will retry the refresh.
      }
    }

    return {
      ok: true,
      leagueId: persisted.league.id,
      runId,
      warningCount: canonical.warnings.length,
      reviewRequired: canonical.reviewRequired,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
