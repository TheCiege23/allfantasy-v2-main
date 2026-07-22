/**
 * Shared types for the league hub Matchup tab + `/api/leagues/[leagueId]/matchup-center`.
 */

export type MatchupGameStatus = 'upcoming' | 'live' | 'final' | 'unknown'

export type MatchupPlayerSlot = {
  playerId: string
  name: string
  position: string
  team: string | null
  opponent: string | null
  headshotUrl: string | null
  currentPoints: number
  projectedPoints: number
  /** False when projectedPoints fell back to a flat per-position estimate (no real provider projection for this player/week). */
  hasRealProjection: boolean
  injuryStatus: string | null
  newsBlurb: string | null
  weatherSummary: string | null
  gameStatus: MatchupGameStatus
  gameLabel: string
  /** Start/sit or edge hint — AI/decision layer; never overrides official scoring. */
  aiInsight: string | null
}

export type MatchupSidePayload = {
  rosterId: string
  teamName: string
  avatarUrl: string | null
  record: { wins: number; losses: number; ties: number }
  winPct: number
  totalPoints: number
  projectedTotal: number
  starters: MatchupPlayerSlot[]
  remainingStarters: number
}

/** Deterministic AI-style copy + risk framing — does not replace official scoring or medical designations. */
export type MatchupInsightsBlock = {
  matchupEdge: string
  startSit: string
  weather: string
  injuryNews: string
  /** High-variance players that could swing the week (names + one-line reason). */
  swingPlayers: string[]
  /** Heuristic volatility for the week. */
  riskLevel: 'low' | 'medium' | 'high'
  /** Floor vs ceiling narrative for roster construction. */
  floorVsCeiling: string
}

export type MatchupCenterPayload = {
  leagueId: string
  season: number
  week: number
  sport: string
  matchupStatus: 'upcoming' | 'live' | 'final'
  /** Specialty / concept overlay copy (guillotine, survivor, tournament, …). */
  conceptOverlay: string | null
  left: MatchupSidePayload
  right: MatchupSidePayload
  winProbabilityLeft: number | null
  insights: MatchupInsightsBlock
  /** True when upstream AI or weather failed — UI should soften messaging. */
  partialData: boolean
  /** Client poll interval when matchup is live (ms). */
  refreshIntervalMs: number
}
