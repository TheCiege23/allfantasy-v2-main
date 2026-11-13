/**
 * Season + Playoff Probability Engine — shared types
 */

export interface TeamSeasonForecast {
  teamId: string
  /** Optional display name for the team */
  teamName?: string
  playoffProbability: number
  firstPlaceProbability: number
  championshipProbability: number
  expectedWins: number
  expectedFinalSeed: number
  finishRange: { min: number; max: number }
  eliminationRisk: number
  byeProbability: number
  confidenceScore: number
  /** Optional: division win probability when league has divisions */
  divisionWinProbability?: number
  /** Optional: current season record for display */
  wins?: number
  losses?: number
  ties?: number
  /** Optional: current standing rank */
  currentRank?: number
}

export interface LeagueForecastContext {
  leagueId: string
  season: number
  currentWeek: number
  totalWeeks: number
  playoffSpots: number
  byeSpots: number
  teamCount: number
  /** rosterId / teamId -> current wins, losses, pointsFor */
  standings: Map<string, { wins: number; losses: number; ties: number; pointsFor: number }>
  /** Team strength for simulation: mean and stdDev of weekly score projection */
  teamProjections: Map<string, { mean: number; stdDev: number }>
  /** Remaining matchups: for each week, list of [teamAId, teamBId] */
  remainingSchedule: Array<[string, string][]>
  /** Division by team (optional). teamId -> divisionId */
  divisionByTeam?: Map<string, string>
  /** Number of divisions (for division odds) */
  divisionCount?: number
}

export interface SimulatedStanding {
  teamId: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  seed: number
  divisionRank?: number
}
