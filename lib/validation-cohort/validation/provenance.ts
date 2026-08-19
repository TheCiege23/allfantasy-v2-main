/**
 * Fantasy OS Suite — Phase V8.3: recommendation provenance (engineering-only traceability).
 *
 * Every recommendation/signal the corpus runner captures carries provenance so an engineer can trace it
 * to the exact observed evidence — traceability, not explanation theater, and never customer-facing. No
 * raw provider identifiers appear (league references are already anonymized `lg_` tokens).
 */
import { createHash } from 'node:crypto'

export type RecommendationScope = 'league' | 'manager'
export type RecommendationAvailability = 'available' | 'partial' | 'unavailable'

export type RecommendationRecord = {
  recommendationType: string
  /** The real Decision OS subsystem that produced it (only pure subsystems are runnable over the corpus). */
  sourceSubsystem: 'league-health-engine' | 'league-attention-signals'
  leagueReference: string
  season: string
  scope: RecommendationScope
  priority: string | null
  severity: string | null
  availability: RecommendationAvailability
  /** Corpus evidence categories that fed this output. */
  evidenceCategories: string[]
  /** The concrete observed facts supporting it (provider-neutral). */
  observedFacts: string[]
  /** Evidence whose absence would raise confidence (documented, not fabricated). */
  missingEvidence: string[]
  /** Deterministic fingerprint of the derivation input — identical input ⇒ identical fingerprint. */
  inputFingerprint: string
  message: string
}

/** Stable short fingerprint of a derivation input (deterministic; no wall-clock, no randomness). */
export function fingerprint(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 12)
}
