/**
 * Phase 6F — Matchmaking tunable weights.
 *
 * Every weight that influences league-fit scoring lives here. Tune
 * once, propagate everywhere. Keep weights summing to ~1.0 per group
 * so aggregate scores stay in [0, 1].
 */

import type { LeagueFitBreakdown } from "./types"

/**
 * Dimension weights for `LeagueFitBreakdown`. Sum = 1.0. Adjusting any
 * weight shifts the engine's emphasis instantly.
 */
export const LEAGUE_FIT_WEIGHTS: Readonly<Record<keyof LeagueFitBreakdown, number>> = {
  ratingProximity: 0.18,
  difficultyFit: 0.14,
  formatOverlap: 0.1,
  sportOverlap: 0.1,
  activityAlignment: 0.1,
  reliabilityAlignment: 0.08,
  competitivenessAlignment: 0.08,
  commissionerFit: 0.08,
  credibilityFit: 0.08,
  leagueTypeOverlap: 0.06,
}

/**
 * Confidence penalty applied per missing input. Confidence starts at 1
 * and decays as inputs are absent. Floor: 0.2 (never claim zero
 * confidence on a non-empty match).
 */
export const FIT_CONFIDENCE = {
  missingProfilePenalty: 0.35,
  missingRatingPenalty: 0.15,
  unverifiedPenalty: 0.1,
  unknownCommissionerPenalty: 0.05,
  floor: 0.2,
} as const

/**
 * Hard-reject thresholds applied when commissioner preferences are
 * specified. Values below the bar return a 0-scored, hardRejected
 * result so the candidate never surfaces to the commissioner.
 */
export const COMMISSIONER_REJECT_BUFFER = 0.02

/** Discovery rail caps. */
export const DISCOVERY_RAIL_CAPS = {
  perRailMax: 10,
  candidatePoolMax: 60,
  minFitToInclude: 0.45,
} as const

