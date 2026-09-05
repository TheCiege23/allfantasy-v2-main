/**
 * Fantasy OS Phase 5E — shared runtime context envelope (Part 1). Pure (no server-only, no DB).
 *
 * One common envelope every wired subsystem returns alongside its result. It must correspond to the EXACT
 * certified snapshot returned: stale stays stale, unavailable is never represented as empty-but-current,
 * provider-specific fields never cross the boundary, unresolved identities stay visible.
 */
import type { SportsDataContext } from '@/lib/sports-data-gateway/contracts'

export type RuntimeIdentityStatus = 'resolved' | 'partially_resolved' | 'unresolved'

export type CertifiedSportsRuntimeContext = {
  generatedAt: string
  sourceProviders: string[]
  snapshotVersions: string[]
  freshnessStatus: 'current' | 'delayed' | 'partial' | 'unavailable'
  identityStatus: RuntimeIdentityStatus
  limitations: string[]
  evidenceIds: string[]
}

/** Derive an identity status from resolved/total counts (visible, never hidden). */
export function identityStatusFrom(resolved: number, total: number): RuntimeIdentityStatus {
  if (total === 0 || resolved === 0) return 'unresolved'
  if (resolved === total) return 'resolved'
  return 'partially_resolved'
}

/** Build the envelope from a gateway SportsDataContext + identity outcome + evidence ids. */
export function buildRuntimeContext(input: {
  dataContext: SportsDataContext
  identityStatus: RuntimeIdentityStatus
  evidenceIds: string[]
  extraLimitations?: string[]
}): CertifiedSportsRuntimeContext {
  const c = input.dataContext
  const limitations = [...c.limitations, ...(input.extraLimitations ?? [])]
  if (input.identityStatus !== 'resolved') limitations.push(`identity ${input.identityStatus}`)
  return {
    generatedAt: c.generatedAt,
    sourceProviders: c.sourceProviders,
    snapshotVersions: c.snapshotVersions,
    freshnessStatus: c.freshnessStatus,
    identityStatus: input.identityStatus,
    limitations: [...new Set(limitations)],
    evidenceIds: input.evidenceIds,
  }
}

/** The fail-closed unavailable envelope (no fabricated empty-but-current). */
export function unavailableRuntimeContext(reason: string): CertifiedSportsRuntimeContext {
  return {
    generatedAt: new Date().toISOString(),
    sourceProviders: [],
    snapshotVersions: [],
    freshnessStatus: 'unavailable',
    identityStatus: 'unresolved',
    limitations: [reason],
    evidenceIds: [],
  }
}
