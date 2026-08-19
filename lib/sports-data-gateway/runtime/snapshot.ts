/**
 * Fantasy OS Phase 5B — snapshot build + certification rules (Part 1).
 *
 * Append-only, provider-neutral. A snapshot may become `certified` ONLY when every gate passes. A failed
 * replacement leaves the previous certified snapshot intact — certified snapshots are never updated in place.
 */
import type { SportsDataCapability } from '../capabilities'
import { snapshotChecksum } from './checksum'

export type SnapshotStatus = 'building' | 'partial' | 'certified' | 'rejected'

export type SnapshotRecordDraft = {
  canonicalKey: string
  resolutionStatus: 'resolved' | 'ambiguous' | 'unresolved' | 'conflicting'
  contentHash: string
  record: unknown
  schemaValid: boolean
}

export type SnapshotDraft = {
  snapshotId: string
  version: string
  sport: string
  capability: SportsDataCapability
  provider: string
  generatedAt: string
  sourceUpdatedAt: string | null
  records: SnapshotRecordDraft[]
  rejectedCount: number
  runPartial: boolean
  scopeComplete: boolean
  previousSnapshotId: string | null
  limitations: string[]
  /** League/entity dimension for league-scoped capabilities (rosters/transactions/draft). null = global. */
  scopeRef?: string | null
}

export type CertificationDecision = { certifiable: true; checksum: string; counts: SnapshotCounts } | { certifiable: false; reasons: string[] }

export type SnapshotCounts = { recordCount: number; resolvedCount: number; ambiguousCount: number; unresolvedCount: number; rejectedCount: number }

export function countSnapshot(draft: SnapshotDraft): SnapshotCounts {
  return {
    recordCount: draft.records.length,
    resolvedCount: draft.records.filter((r) => r.resolutionStatus === 'resolved').length,
    ambiguousCount: draft.records.filter((r) => r.resolutionStatus === 'ambiguous').length,
    unresolvedCount: draft.records.filter((r) => r.resolutionStatus === 'unresolved' || r.resolutionStatus === 'conflicting').length,
    rejectedCount: draft.rejectedCount,
  }
}

/**
 * Certification gate (Part 1). All must hold: every stored record schema-valid; all identity outcomes
 * classified; deterministic checksum; row accounting reconciles; scope complete; rejects explained via
 * `limitations`; run not partial; provenance present (generatedAt); freshness metadata complete.
 */
export function canCertify(draft: SnapshotDraft): CertificationDecision {
  const reasons: string[] = []
  if (draft.runPartial) reasons.push('run is partial')
  if (!draft.scopeComplete) reasons.push('scope is incomplete')
  if (!draft.generatedAt) reasons.push('missing provenance (generatedAt)')
  if (draft.records.some((r) => !r.schemaValid)) reasons.push('one or more records failed schema validation')
  const classified = draft.records.every((r) => ['resolved', 'ambiguous', 'unresolved', 'conflicting'].includes(r.resolutionStatus))
  if (!classified) reasons.push('one or more identity outcomes are unclassified')
  if (draft.rejectedCount > 0 && draft.limitations.length === 0) reasons.push('unexplained rejects (no limitations recorded)')

  if (reasons.length > 0) return { certifiable: false, reasons }
  const checksum = snapshotChecksum(draft.records.map((r) => ({ canonicalKey: r.canonicalKey, contentHash: r.contentHash })))
  return { certifiable: true, checksum, counts: countSnapshot(draft) }
}
