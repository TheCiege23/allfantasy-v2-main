/**
 * User profile stats (PROMPT 308).
 * Record, rankings, achievements — no money rewards.
 */

export interface RecordSummary {
  wins: number
  losses: number
  ties: number
  /** Per-league breakdown when available. */
  byLeague: Array<{
    leagueId: string
    leagueName: string
    sport?: string
    wins: number
    losses: number
    ties: number
    rank?: number
    pointsFor?: number
  }>
}

export interface RankingEntry {
  leagueId: string
  leagueName: string
  season: string
  sport?: string
  /** Draft grade (e.g. A+, B). */
  grade: string
  /** 1-based rank in league draft. */
  rank: number
  /** Numeric score behind the grade. */
  score: number
}

/** Achievement with earned status (from achievement-system). */
interface AchievementWithEarned {
  id: string
  name: string
  description: string
  icon: string
  tier: string
  xpReward: number
  earned: boolean
  earnedAt?: string
  meta?: Record<string, unknown>
}

export interface ProfileStats {
  record: RecordSummary
  rankings: RankingEntry[]
  achievements: AchievementWithEarned[]
}
