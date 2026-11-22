/**
 * Pool Parity Calculator
 *
 * How competitive / close is this pool?
 *
 * parityScore 0–100:
 *   100 = everyone is tied (perfect parity)
 *   0   = one entry has a perfect score, everyone else has 0
 *
 * parityLabel:
 *   "elite"       = parityScore ≥ 75 — extremely tight, anyone can win
 *   "competitive" = parityScore ≥ 50 — close race, multiple contenders
 *   "moderate"    = parityScore ≥ 25 — a leader exists but it's not over
 *   "runaway"     = parityScore < 25  — dominant leader, predictable finish
 *
 * entriesWithinStrikeRange = entries within 15% of the leader's score.
 * These are the active contenders Chimmy should highlight.
 */
import type { InsightPool } from "./types"

type PoolParityResult = {
  /** 0–100 composite parity score. */
  parityScore: number
  parityLabel: "elite" | "competitive" | "moderate" | "runaway"
  /** Standard deviation of current scores. Lower = tighter pool. */
  scoreStdDev: number
  /** Points between 1st and 2nd place right now. */
  leaderMargin: number
  /** Points between 1st and last place right now. */
  topToBottomSpread: number
  /** Entries within striking range of the leader (within 15% of leader score). */
  entriesWithinStrikeRange: number
  /** Entries that cannot mathematically reach 1st. */
  eliminatedCount: number
  /** Entry count still mathematically alive for the win. */
  aliveCount: number
}

export function computePoolParity(pool: InsightPool): PoolParityResult {
  if (pool.entries.length === 0) {
    return {
      parityScore: 0,
      parityLabel: "runaway",
      scoreStdDev: 0,
      leaderMargin: 0,
      topToBottomSpread: 0,
      entriesWithinStrikeRange: 0,
      eliminatedCount: 0,
      aliveCount: 0,
    }
  }

  const scores = pool.entries.map((e) => e.currentScore)
  const maxScore = Math.max(...scores)
  const minScore = Math.min(...scores)
  const spread = maxScore - minScore

  const sorted = [...pool.entries].sort((a, b) => a.rank - b.rank)
  const leaderScore = sorted[0]?.currentScore ?? 0
  const secondScore = sorted[1]?.currentScore ?? 0
  const leaderMargin = leaderScore - secondScore

  const mean = scores.reduce((s, v) => s + v, 0) / scores.length
  const variance = scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / scores.length
  const stdDev = Math.round(Math.sqrt(variance))

  const eliminatedCount = pool.entries.filter((e) => {
    const leader = sorted[0]
    return leader && e.maxPossible < leader.currentScore
  }).length
  const aliveCount = pool.entries.length - eliminatedCount

  // Parity = how small is the spread relative to the max possible score?
  const maxPossibleScore = Math.max(...pool.entries.map((e) => e.maxPossible), 1)
  const normalizedSpread = spread / maxPossibleScore
  const parityScore = Math.max(0, Math.min(100, Math.round((1 - normalizedSpread) * 100)))

  const parityLabel: PoolParityResult["parityLabel"] =
    parityScore >= 75
      ? "elite"
      : parityScore >= 50
        ? "competitive"
        : parityScore >= 25
          ? "moderate"
          : "runaway"

  const strikeRange = Math.max(10, leaderScore * 0.15)
  const entriesWithinStrikeRange = pool.entries.filter(
    (e) => e.rank > 1 && leaderScore - e.currentScore <= strikeRange,
  ).length

  return {
    parityScore,
    parityLabel,
    scoreStdDev: stdDev,
    leaderMargin,
    topToBottomSpread: spread,
    entriesWithinStrikeRange,
    eliminatedCount,
    aliveCount,
  }
}
