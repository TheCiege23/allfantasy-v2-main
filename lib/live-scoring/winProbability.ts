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
 * Per-remaining-point variance.
 *
 * ⚠ RECALIBRATED FROM 0.55 TO 2.2 AGAINST MEASURED DATA — THE OLD VALUE MADE THIS
 * MODEL SYSTEMATICALLY OVERCONFIDENT. 0.55 was tuned for a "sane-looking" spread
 * rather than fitted to anything. Measuring real per-player weekly variance across
 * 253,000 player-games (see lib/projections/winProbability.ts, sd ≈ 1.19·mean^0.64)
 * and summing it over a lineup gives a standard deviation roughly DOUBLE what 0.55
 * produces, consistently across lineup sizes:
 *
 *     remaining pts   sd @ 0.55   sd measured   ratio
 *              27        3.85         7.21      1.87x
 *              45        4.97        10.00      2.01x
 *              81        6.67        14.57      2.18x
 *              24        3.63         7.49      2.06x
 *               8        2.10         4.50      2.15x
 *
 * Halving the spread pushes every probability toward 0 and 1 — a 75% that should
 * read 65%. On a live win-probability readout that is the difference between a
 * manager conceding a game that is still winnable and one they actually are.
 *
 * ⚠ AND 2.2 IS STILL A FLOOR, NOT A CEILING. The measurement assumes players score
 * INDEPENDENTLY, which is false — a QB and his WR1 score on the same plays, so real
 * lineup variance is higher again. The honest direction of remaining error is
 * "still slightly overconfident".
 *
 * ⚠ A CONSTANT PER POINT IS THE WRONG SHAPE, JUST A MUCH CLOSER ONE. Variance
 * scales with the NUMBER of players and each one's mean, not linearly with the
 * total — which is why the implied constant drifts 1.9→2.6 across the table above.
 * The correct fix is a per-player variance sum; this signature takes only an
 * aggregate, so recalibrating is the improvement available without changing every
 * caller.
 */
export const REMAINING_POINT_VARIANCE = 2.2

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
