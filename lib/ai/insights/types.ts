/**
 * Shared input/output types for all AllFantasy deterministic insight calculators.
 *
 * Sport plugins translate their native DB types to these shapes before calling
 * calculators. This keeps every calculator independently testable — no Prisma,
 * no AI, no network calls.
 *
 * null  = "not loaded / not available"
 * []    = "loaded but empty"
 */

/** One entry in a pool or bracket competition. */
export type InsightEntry = {
  entryId: string
  displayName: string
  currentScore: number
  /** Max points achievable if all remaining picks are correct. Pre-computed. */
  maxPossible: number
  rank: number
  /** True only for the requesting user's own entry. */
  isCurrentUser: boolean
  picks: InsightPick[]
}

/** One pick an entry has made for a specific match. */
type InsightPick = {
  matchId: string
  pickedTeam: string
  round: string
  /** Points awarded IF this pick is correct. */
  pointsAtStake: number
  /** null for pending/unresolved picks. */
  pointsEarned: number | null
  /** null for pending/unresolved picks. */
  isCorrect: boolean | null
}

/** One match / game in the competition. */
type InsightMatch = {
  matchId: string
  homeTeam: string
  awayTeam: string
  round: string
  status: "scheduled" | "live" | "final"
  kickoffUtc: string | null
  /** Points entries earn for a correct pick on this match. */
  pointsAtStake: number
  /** How pool entries are split on this match. */
  pickDistribution: { home: number; away: number }
  homeScore: number | null
  awayScore: number | null
}

/** Full competition context — what calculators receive. */
export type InsightPool = {
  entries: InsightEntry[]
  matches: InsightMatch[]
  totalEntries: number
}
