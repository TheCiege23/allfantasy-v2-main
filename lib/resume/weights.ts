/**
 * Phase 6B — Resume + Aggregation Weights
 *
 * All tunable knobs for the resume aggregation, credibility, and matchmaking
 * layers. NO MAGIC NUMBERS may live outside this file. Tuning happens here.
 */

/** Weights for matchmaking compatibility. */
export const MATCHMAKING_WEIGHTS = {
  ratingProximity: 0.3,
  difficultyPreference: 0.2,
  formatOverlap: 0.2,
  sportOverlap: 0.15,
  activityAlignment: 0.1,
  reliability: 0.05,
} as const

/** Hard bands used to clamp normalized scores. */
export const SCORE_RANGE = { min: 0, max: 1 } as const

/** Rating clamp matches `lib/ranking/snapshot/weights.RATING_RANGE`. */
export const RATING_RANGE = { min: 0, max: 10_000 } as const

