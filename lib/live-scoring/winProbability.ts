/**
 * Live Scoring — variance-aware win probability (Phase 3).
 *
 * The audited service used a naive projection-ratio (`projA / (projA+projB)`) for
 * win %, which ignores the current score and uncertainty. This replaces it with a
 * normal-approximation model: each side's projected final is a random variable
 * whose variance shrinks as the game completes, and WP is the probability that
 * side A's final exceeds side B's. Pure, deterministic, sport/concept-agnostic.
 */

export type SideLiveScore = {
  /** Points already scored (locked in). */
  currentPoints: number
  /** Projected points still to come (>= 0). 0 ⇒ all games final. */
  projectedRemaining: number
}

/**
 * Per-remaining-point variance. Fantasy weekly totals have high variance; tuned so
 * a typical full lineup (~40 remaining proj pts) yields a sane standard deviation
 * (~√(40·0.55) ≈ 4.7 pts per side). When little remains, variance collapses and WP
 * approaches a deterministic 0/0.5/1.
 */
export const REMAINING_POINT_VARIANCE = 0.55

/** Abramowitz & Stegun 7.1.26 erf approximation (max error ~1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax)
  return sign * y
}

/** Standard normal CDF via erf. */
function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

/**
 * Probability that side A finishes ahead of side B.
 *
 * meanFinal_i = current_i + projectedRemaining_i
 * var_i       = REMAINING_POINT_VARIANCE × projectedRemaining_i
 * WP_A        = Φ( (meanA − meanB) / √(varA + varB) )
 *
 * When no points remain on either side (variance 0) the result is deterministic:
 * 1 if A leads, 0 if B leads, 0.5 on an exact tie. Result is clamped to
 * [0.005, 0.995] while games remain so the UI never shows a misleading 0/100%.
 */
export function estimateWinProbability(sideA: SideLiveScore, sideB: SideLiveScore): number {
  const meanA = sideA.currentPoints + Math.max(0, sideA.projectedRemaining)
  const meanB = sideB.currentPoints + Math.max(0, sideB.projectedRemaining)
  const varA = REMAINING_POINT_VARIANCE * Math.max(0, sideA.projectedRemaining)
  const varB = REMAINING_POINT_VARIANCE * Math.max(0, sideB.projectedRemaining)
  const totalVar = varA + varB

  if (totalVar <= 1e-9) {
    if (meanA > meanB) return 1
    if (meanA < meanB) return 0
    return 0.5
  }

  const z = (meanA - meanB) / Math.sqrt(totalVar)
  const p = normalCdf(z)
  return round4(Math.max(0.005, Math.min(0.995, p)))
}
