/**
 * Fantasy OS Phase 5C — pure freshness envelope for certified sports snapshots (no DB, no server-only).
 *
 * Freshness belongs to the EXACT snapshot returned. `unavailable` when there is no certified snapshot (never a
 * fabricated empty snapshot). Stale-but-certified data is returned with `delayed` — never hidden.
 */
import type { SportsDataContext } from '../contracts'
import type { CertifiedSnapshotMeta } from './store'

/** Default staleness threshold (minutes) after which a certified snapshot reads as `delayed`. */
export const DEFAULT_CERTIFIED_STALE_MINUTES = 60

export function buildCertifiedFreshness(
  meta: CertifiedSnapshotMeta | null,
  now: Date,
  staleMinutes = DEFAULT_CERTIFIED_STALE_MINUTES,
): SportsDataContext {
  if (!meta) {
    return {
      generatedAt: now.toISOString(),
      lastSuccessfulSyncAt: null,
      sourceProviders: [],
      snapshotVersions: [],
      freshnessStatus: 'unavailable',
      limitations: ['No certified snapshot available.'],
    }
  }
  const ageMin = (now.getTime() - new Date(meta.generatedAt).getTime()) / 60000
  const status = Number.isNaN(ageMin) ? 'unavailable' : ageMin <= staleMinutes ? 'current' : 'delayed'
  const limitations = [...meta.limitations]
  if (meta.unresolvedCount > 0) limitations.push(`${meta.unresolvedCount} unresolved identities in this snapshot`)
  if (meta.rejectedCount > 0) limitations.push(`${meta.rejectedCount} records rejected during normalization`)
  return {
    generatedAt: now.toISOString(),
    lastSuccessfulSyncAt: meta.generatedAt,
    sourceProviders: [meta.provider],
    snapshotVersions: [meta.version],
    freshnessStatus: status,
    limitations,
  }
}
