/**
 * Group Advancement Calculator
 *
 * Given current group standings and remaining matches, determine which teams
 * have clinched advancement, which are eliminated, and which are still alive.
 *
 * Works for any group-stage competition: WC, Euro, Champions League, etc.
 * The advancingPerGroup param adapts to the format (2 for classic WC, 3 for WC 2026).
 */

type GroupTeamStanding = {
  teamName: string
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  points: number
}

type GroupAdvancementStatus = {
  teamName: string
  standing: GroupTeamStanding
  currentPosition: number
  /** "advanced" = clinched | "eliminated" = cannot advance | "alive" = still possible */
  status: "advanced" | "eliminated" | "alive"
  remainingGames: number
  maxPointsReachable: number
  /** Points needed to clinch (≥ 0, or 0 if already clinched). */
  pointsNeededToClinch: number
}

export type GroupAdvancementResult = {
  group: string
  teamsCount: number
  teamsAdvancing: number
  standings: GroupAdvancementStatus[]
  confirmedAdvanced: string[]
  confirmedEliminated: string[]
  undecided: string[]
  matchesRemaining: number
}

