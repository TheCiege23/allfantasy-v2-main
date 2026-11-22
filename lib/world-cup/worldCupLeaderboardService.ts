/**
 * Client-safe leaderboard helpers (display math + rank movement).
 */
import type { WorldCupRound, WorldCupScoringValues } from "./types"
import { WORLD_CUP_ROUND_LABELS, WORLD_CUP_ROUNDS } from "./types"
import { getWorldCupRoundPoints } from "./worldCupBracketBuilder"

export function getWorldCupPossiblePointsRemaining(
  totalScore: number,
  maxPossibleScore: number
): number {
  return Math.max(0, Math.round((maxPossibleScore ?? 0) - (totalScore ?? 0)))
}

type WorldCupRankMovement = "up" | "down" | "same" | "new" | "unknown"

export function getWorldCupRankMovement(
  previousRank: number | null | undefined,
  currentRank: number
): WorldCupRankMovement {
  if (!currentRank || currentRank < 1) return "unknown"
  if (previousRank == null || previousRank < 1) return "new"
  if (previousRank === currentRank) return "same"
  return currentRank < previousRank ? "up" : "down"
}

type WorldCupRoundBreakdownRow = {
  round: WorldCupRound | string
  label: string
  pointsEarned: number
  pointsPerCorrect: number
}

/**
 * Ordered rows for UI: earned points from breakdown + configured weight per round.
 */
export function buildWorldCupRoundBreakdownRows(
  roundBreakdown: Record<string, number> | null | undefined,
  scoring: WorldCupScoringValues,
  opts?: { includeThirdPlace?: boolean }
): WorldCupRoundBreakdownRow[] {
  const includeThird = Boolean(opts?.includeThirdPlace)
  const rounds = WORLD_CUP_ROUNDS.filter(
    (r) => r !== "third_place" || includeThird
  )
  return rounds.map((round) => ({
    round,
    label: WORLD_CUP_ROUND_LABELS[round] ?? round,
    pointsEarned: Math.round(roundBreakdown?.[round] ?? 0),
    pointsPerCorrect: getWorldCupRoundPoints(round, scoring),
  }))
}
