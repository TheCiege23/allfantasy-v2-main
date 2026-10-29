/**
 * Canonical DTOs for the live-scoring pipeline.
 * API routes and client components consume these; route files do NOT define their own types.
 * All surfaces (Dashboard, League, Matchup, Team, Mobile) share these shapes.
 */

/** Per-league live score entry shown in the dashboard widget. */
export type DashboardLiveScore = {
  leagueId: string
  leagueName: string
  sport: string
  week: number
  myPts: number
  oppPts: number | null
  oppTeamName: string | null
  myRecord: { wins: number; losses: number; ties: number }
  myRank: number | null
  totalTeams: number
  matchupStatus: string
  /** An odd-team native league's extra matchup this week: "Extra matchup vs <team> (<reason>) · 112.4–98.0". */
  extraMatchupLabel?: string
}

/** Per-player score breakdown returned by the roster-scores endpoint. */
export type RosterScorePlayer = {
  playerName: string
  position: string
  slotType: string
  pts: number
  isFinalized: boolean
  hasStats: boolean
}
