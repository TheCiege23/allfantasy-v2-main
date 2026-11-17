/**
 * Max Possible Points Calculator
 *
 * For each entry, computes the maximum score achievable given remaining matches,
 * whether they are mathematically eliminated from first place, and how far back
 * they are from the leader.
 *
 * "Eliminated" means even a perfect run can't beat the current leader's score.
 * "Can still win" means their max possible >= the leader's max possible.
 */
import type { InsightPool } from "./types"

type MaxPossibleResult = {
  entryId: string
  displayName: string
  rank: number
  currentScore: number
  maxPossible: number
  pointsStillAvailable: number
  /** True if this entry can no longer reach 1st place, even with all correct picks. */
  isEliminated: boolean
  /** True if they can still tie or beat the leader's best-case score. */
  canStillWin: boolean
  gapToFirst: number
  isCurrentUser: boolean
}

type MaxPossibleSummary = {
  entries: MaxPossibleResult[]
  eliminatedCount: number
  stillAliveCount: number
  /** Eliminated but still scoring points — jockeying for lower-rank prizes. */
  jockeyingForPositionCount: number
  /** Points separating 1st from 2nd right now. */
  leaderMargin: number
}

export function computeMaxPossiblePoints(pool: InsightPool): MaxPossibleSummary {
  const sorted = [...pool.entries].sort((a, b) => a.rank - b.rank)
  const leader = sorted[0] ?? null
  const second = sorted[1] ?? null
  const leaderCurrentScore = leader?.currentScore ?? 0
  const leaderMaxPossible = leader?.maxPossible ?? 0

  const entries: MaxPossibleResult[] = pool.entries
    .map((entry) => {
      const isEliminated = entry.maxPossible < leaderCurrentScore
      // Can still win = their ceiling >= leader's ceiling
      const canStillWin = entry.maxPossible >= leaderMaxPossible
      return {
        entryId: entry.entryId,
        displayName: entry.displayName,
        rank: entry.rank,
        currentScore: entry.currentScore,
        maxPossible: entry.maxPossible,
        pointsStillAvailable: Math.max(0, entry.maxPossible - entry.currentScore),
        isEliminated,
        canStillWin,
        gapToFirst: Math.max(0, leaderCurrentScore - entry.currentScore),
        isCurrentUser: entry.isCurrentUser,
      }
    })
    .sort((a, b) => a.rank - b.rank)

  const eliminatedCount = entries.filter((e) => e.isEliminated).length
  const stillAliveCount = entries.length - eliminatedCount

  return {
    entries,
    eliminatedCount,
    stillAliveCount,
    jockeyingForPositionCount: entries.filter(
      (e) => e.isEliminated && e.pointsStillAvailable > 0,
    ).length,
    leaderMargin: Math.max(0, (leader?.currentScore ?? 0) - (second?.currentScore ?? 0)),
  }
}
