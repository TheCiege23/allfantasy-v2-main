/**
 * consensusConfidence — how much to trust a blended ADP figure.
 *
 * Pure, and deliberately in its own module: the value it produces is the only thing that
 * separates a figure five platforms agreed on from one that a single source volunteered,
 * and that distinction deserves a test that does not need a database to run.
 *
 * 🛑 NO SPREAD IS NOT THE SAME AS NO DISAGREEMENT, AND SCORING IT AS ZERO INVERTED THE SCALE.
 *
 * The caller computed `spread` as 0 whenever one source priced the player, and 0 then flowed
 * in as the most favourable value the penalty term can take. Measured against production at
 * season week 35, a lone provider therefore outscored two real ones:
 *
 *     providerCount 1   4,476 rows   avg confidence 0.438
 *     providerCount 2     443 rows   avg confidence 0.371   <- better data, worse score
 *     providerCount 3      73 rows   avg confidence 0.470
 *     providerCount 4     100 rows   avg confidence 0.621
 *
 * Not a rounding artifact: `0.3 + (1/4)*0.55 - 0` is exactly 0.4375. Every 2026 rookie sits
 * in the first row, because `data/nfl-adp-multiplatform.csv` is dated 2026-03-08 — before
 * the April 2026 draft — so `ffc` prices that whole class alone. The players we knew least
 * about were scored as the most certain.
 *
 * So `spread` is `null` when there was nothing to compare against, and an uncorroborated
 * figure is capped below anything a genuine multi-source consensus can reach.
 */

/** No single-source figure may score at or above this; the weakest real consensus starts higher. */
export const UNCORROBORATED_CONFIDENCE_CEILING = 0.35

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * @param providerCount distinct sources behind the figure, NOT the number of rows.
 * @param spread range across those sources, or `null` when fewer than two priced the player.
 */
export function confidenceForConsensus(providerCount: number, spread: number | null): number {
  // More independent providers with tighter spread => higher confidence.
  const providerScore = clamp(providerCount / 4, 0, 1)

  if (providerCount < 2 || spread == null) {
    // One source agrees with itself by construction; the spread term simply does not apply.
    const raw = 0.2 + providerScore * 0.15
    return Number(clamp(raw, 0.2, UNCORROBORATED_CONFIDENCE_CEILING).toFixed(3))
  }

  const spreadPenalty = clamp(spread / 60, 0, 1)
  const raw = 0.3 + providerScore * 0.55 - spreadPenalty * 0.25
  return Number(clamp(raw, 0.2, 0.98).toFixed(3))
}
