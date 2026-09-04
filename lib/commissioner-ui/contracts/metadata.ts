import type { CommissionerModuleId } from './navigation'

/**
 * The four-tier confidence vocabulary established throughout the
 * architecture (Recommendations Center §9, reused verbatim by Manager
 * Intelligence and the League Relationship Graph) — formalized here as a
 * shared contract so every module expresses confidence with the same
 * four words, never a raw percentage.
 */
export type CommissionerConfidenceLevel = 'developing_signal' | 'moderate' | 'high' | 'very_high'

/** Shared evidence metadata attached to any claim a module surfaces. */
export interface CommissionerEvidenceMetadata {
  confidence: CommissionerConfidenceLevel
  asOf: string
  sourceModuleId: CommissionerModuleId
}
