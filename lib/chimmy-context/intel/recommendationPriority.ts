/**
 * Phase 2C Batch 4 — Recommendation prioritization SCAFFOLD.
 *
 * Pure helper used by future AI recommendation flows to classify how
 * urgent / important a single recommendation is. Per Phase 2C Batch 4
 * constraints we do NOT finalize the priority formula here; this module
 * only:
 *   - Defines the recommendation-priority type vocabulary.
 *   - Emits factual rationale strings derived from inputs.
 *   - Returns `priority: "unknown"` + `score: null` until tuned.
 *
 * Contract: pure, never throws, no I/O.
 */

import type { OpponentStrengthOutput } from "./opponentStrength"
import type { UrgencyOutput } from "./urgency"

type RecommendationPriority =
  | "critical"
  | "important"
  | "optional"
  | "watchlist"
  | "unknown"

type RecommendationCategory =
  | "lineup"
  | "waiver"
  | "trade"
  | "drop"
  | "general"

type PrioritizeInput = {
  category: RecommendationCategory
  urgency: UrgencyOutput | null
  opponentStrength: OpponentStrengthOutput | null
  /** Projected margin (you - opponent) for the relevant matchup. */
  projectionMargin: number | null
}

type PrioritizeOutput = {
  category: RecommendationCategory
  priority: RecommendationPriority
  /** 0-100 priority score; `null` until formula lands. */
  score: number | null
  /** Factual derived rationale strings (no fabricated weights). */
  rationale: string[]
  inputs: PrioritizeInput
}

export function prioritizeRecommendation(
  input: PrioritizeInput
): PrioritizeOutput {
  const rationale: string[] = []

  if (input.urgency?.signals?.length) {
    for (const sig of input.urgency.signals) {
      rationale.push(`urgency:${sig}`)
    }
  }

  if (input.opponentStrength) {
    rationale.push(`opponent_rating:${input.opponentStrength.rating}`)
    if (input.opponentStrength.factors.afPowerScore != null) {
      rationale.push(
        `opponent_af_power:${input.opponentStrength.factors.afPowerScore}`
      )
    }
  }

  if (input.projectionMargin != null) {
    if (Math.abs(input.projectionMargin) <= 3) {
      rationale.push("projection_margin:tight")
    } else if (input.projectionMargin > 0) {
      rationale.push("projection_margin:favorable")
    } else {
      rationale.push("projection_margin:unfavorable")
    }
  }

  // TODO(Phase 2C Batch 5+): map (urgency.level, opponentStrength.rating,
  // projectionMargin, category) to a tunable RecommendationPriority once
  // the priority formula is approved.
  return {
    category: input.category,
    priority: "unknown",
    score: null,
    rationale,
    inputs: input,
  }
}
