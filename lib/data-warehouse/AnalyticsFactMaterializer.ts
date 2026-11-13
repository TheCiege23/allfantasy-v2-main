/**
 * AnalyticsFactMaterializer — precomputes analytics-ready datasets from warehouse facts.
 * Feeds dashboard analytics, trend detection, and AI narrative.
 */

export interface MaterializedPlayerTrend {
  playerId: string
  sport: string
  season: number
  totalFantasyPoints: number
  gameCount: number
  avgPointsPerGame: number
  lastWeekPoints: number | null
}

export interface MaterializedLeagueSummary {
  leagueId: string
  sport: string
  season: number
  matchupCount: number
  teamCount: number
  totalPointsScored: number
}

