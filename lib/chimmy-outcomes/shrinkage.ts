/**
 * RATES THAT ONE RESULT CANNOT DOMINATE.
 *
 * Chimmy brief item 10: learn from outcomes "without allowing one result to dominate". Every rate
 * Chimmy acts on — how often you take its advice, how often its calls are right — goes through
 * here, and two guards apply to all of them:
 *
 * - **A minimum sample.** Below it the rate is `null`, never a number. One accepted
 *   recommendation used to read as a 100% accept rate and flip the user's answer style.
 * - **Shrinkage toward a prior** (beta-binomial): `(hits + prior·w) / (n + w)`. With `w = 10`,
 *   ten straight hits read as 0.75, not 1.0, and the estimate only approaches the raw rate as
 *   evidence accumulates.
 *
 * Pure and dependency-free, so a client component, a cron and a prompt builder all share one rule.
 * ⚠ Always recompute from the full window. Never add a new result onto a stored rate — that is the
 * repeat-counting pattern `lib/trade-engine/accept-calibration.ts` falls into, where only a clamp
 * keeps the value bounded.
 */

export type ShrinkageOptions = {
  /** The rate assumed before any evidence. */
  priorRate: number
  /** How many pseudo-observations the prior is worth. */
  priorWeight: number
  /** Fewer real observations than this returns null. */
  minSample: number
}

/** A neutral prior worth ten observations, silent below ten real ones. */
export const BEHAVIOR_RATE_DEFAULTS: ShrinkageOptions = { priorRate: 0.5, priorWeight: 10, minSample: 10 }

export function shrunkRate(hits: number, n: number, opts: ShrinkageOptions = BEHAVIOR_RATE_DEFAULTS): number | null {
  if (!Number.isFinite(hits) || !Number.isFinite(n) || n < opts.minSample || n <= 0) return null
  const h = Math.max(0, Math.min(hits, n))
  const prior = Math.max(0, Math.min(1, opts.priorRate))
  const w = Math.max(0, opts.priorWeight)
  return (h + prior * w) / (n + w)
}

/**
 * Exponential time decay: a result `ageDays` old counts `0.5^(ageDays / halfLifeDays)`.
 * Used where results span a season, so last month's run cannot outweigh this week's.
 */
export function decayWeight(ageDays: number, halfLifeDays: number): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 1
  return Math.pow(0.5, ageDays / halfLifeDays)
}
