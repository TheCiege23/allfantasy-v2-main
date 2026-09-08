import type { LeagueToolAccessErrorCode } from '@/lib/ai-tools/league-tool-context-types'
import type { AiTimeContextPayload } from '@/lib/time-engine/types'

export type MatchupLinkToolId = 'startSit' | 'trade' | 'waiver' | 'trending' | 'power' | 'injury' | 'warRoom'

export type MatchupTeamFocusId = 'my_team' | 'specific_team'

export type MatchupTimeHorizonId =
  | 'this_matchup'
  | 'next_matchup'
  | 'next_2_matchups'
  | 'playoff_window'
  | 'rest_of_season'

export type MatchupStrategyModeId =
  | 'balanced'
  | 'high_upside'
  | 'safe_floor'
  | 'aggressive'
  | 'injury_protected'
  | 'streaming_focus'
  | 'playoff_prep'
  | 'neutral'

export type MatchupPrepViewTabId =
  | 'overview'
  | 'game_plan'
  | 'lineup_edge'
  | 'opponent_weaknesses'
  | 'injuries'
  | 'schedule'
  | 'streaming'
  | 'ai_insights'

export type MatchupPrepToggles = {
  includeLiveNews: boolean
  includeInjuries: boolean
  includeScheduleAdjustments: boolean
  includeWeather: boolean
  includeStreamingRecommendations: boolean
  includeOpponentTrendAnalysis: boolean
  includePlayoffContext: boolean
  includeRookieProspectContext: boolean
}

export type MatchupPositionEdge = {
  position: string
  myPoints: number
  oppPoints: number
  edge: number
}

export type MatchupSlotEdge = {
  slotName: string
  myPoints: number
  oppPoints: number
  edge: number
  myStarterName: string | null
  oppStarterName: string | null
}

export type MatchupStreamingHint = {
  id: string
  title: string
  detail: string
  linkTool: MatchupLinkToolId
}

export type MatchupScoringSummary = {
  scoringModel: string
  receptionFormat: string | null
  superflex: boolean | null
  rawScoringColumn: string | null
}

/** Provider-health flags for UI chips — mirrors other AI tools. */
export type MatchupPrepSourceFlags = {
  /** Opponent resolved via Sleeper matchups API or native team_performances row. */
  opponentResolved: boolean
  /** My-team Start/Sit projection batch produced at least one row. */
  myProjectionReady: boolean
  /** Opponent Start/Sit projection batch produced at least one row. */
  oppProjectionReady: boolean
  /** Injury / news signals attached to at least one player on either side. */
  injuryNewsLayerReady: boolean
  /** Weather influence captured for at least one game in the matchup. */
  weatherLayerReady: boolean
  /** True when the market fed at least one starter's game environment. */
  marketLayerReady: boolean
  /** League scoring rules applied via normalized league context. */
  leagueScoringApplied: boolean
  /** AI time/league envelope attached to chimmyPayload. */
  aiEnvelopeReady: boolean
}

export type MatchupPeriodSnapshot = {
  season: number
  week: number
  weekLabel: string
  periodSource: string | null
}

export type WinProbabilityModelId = 'starter_spread_normal' | 'mean_edge_logistic'

export type MatchupFloorVsUpside = {
  floorLeanPlayer: string | null
  upsideLeanPlayer: string | null
  note: string
}

export type MatchupInjuryPivot = {
  player: string
  detail: string
  urgency: number
}

export type MatchupGamePlanAction = {
  id: string
  rank: number
  title: string
  detail: string
  urgency: number
  confidence: number
  source: 'start_sit' | 'injury' | 'projection' | 'schedule'
  linkTool?: MatchupLinkToolId
}

export type MatchupPrepDashboardInput = {
  userId: string
  sportFilter: 'ALL' | string
  leagueId: string | null
  teamFocus: MatchupTeamFocusId
  teamExternalId?: string | null
  opponentExternalId?: string | null
  timeHorizon: MatchupTimeHorizonId
  strategyMode: MatchupStrategyModeId
  toggles: MatchupPrepToggles
  skipAi?: boolean
}

export type MatchupPrepDashboardResult = {
  ok: true
  analysisScope: 'league' | 'general'
  leagueName: string | null
  sport: string | null
  week: number
  weekLabel: string
  matchupPeriod: MatchupPeriodSnapshot | null
  scoringSummary: MatchupScoringSummary | null
  opponentResolution: 'manual' | 'sleeper_matchup' | 'native_performance' | 'none'
  myTeamName: string | null
  oppTeamName: string | null
  myRecord: string | null
  oppRecord: string | null
  myProjectedTotal: number | null
  oppProjectedTotal: number | null
  projectedEdge: number | null
  winProbability: number | null
  winProbabilityModel: WinProbabilityModelId
  winProbabilityNotes: string | null
  confidence: number
  urgencyScore: number
  matchupDifficulty: 'favorable' | 'even' | 'tough'
  positionEdges: MatchupPositionEdge[]
  slotEdges: MatchupSlotEdge[]
  floorVsUpside: MatchupFloorVsUpside
  streamingOpportunities: MatchupStreamingHint[]
  gamePlan: MatchupGamePlanAction[]
  conflicts: Array<{ id: string; summary: string; primary: string; alternate: string }>
  injuryHighlights: Array<{ side: 'you' | 'opp'; name: string; status: string; note: string }>
  injuryPivots: MatchupInjuryPivot[]
  scheduleNotes: string[]
  weatherInfluence: Array<{ name: string; team: string; summary: string; risk: string | null }>
  /**
   * Game environment for your starters, from the betting market read as a FORECAST.
   *
   * `impliedTeamTotal` is how many points that player's offence is expected to
   * score — a projection input, and the reason this feed exists. It is NOT a
   * betting card: no prices, no sportsbook names, and nothing here should be
   * rendered as odds. See `lib/odds/gameOddsReads.ts` for the enforced boundary.
   *
   * ⚠ Do NOT confuse this with `winProbability` on the matchup itself. That one is
   * your fantasy head-to-head, derived from starter projection bands; this one is
   * whether an NFL team wins its game. They answer different questions and the
   * market has no opinion on the first.
   */
  marketContext: Array<{
    name: string
    team: string
    impliedTeamTotal: number | null
    spread: number | null
    gameTotal: number | null
    opponent: string | null
    isHome: boolean
    isStale: boolean
  }>
  dataGaps: string[]
  degraded: boolean
  modules: {
    myStartSit: Record<string, unknown> | null
    oppStartSit: Record<string, unknown> | null
  }
  aiSummary: string | null
  chimmyPayload: Record<string, unknown>
  timeContext: AiTimeContextPayload | null
  startSitValidation: {
    my: Record<string, unknown> | null
    opp: Record<string, unknown> | null
  }
  sourceFlags: MatchupPrepSourceFlags
  /** Time horizons the runner can honor; anything else gets clamped to `this_matchup` with a gap note. */
  horizonSupported: boolean
  computedAt: string
}

export type MatchupPrepDashboardError = {
  ok: false
  error: string
  code?: LeagueToolAccessErrorCode | 'VALIDATION'
  userMessage?: string
}

export type MatchupPrepDashboardOutput = MatchupPrepDashboardResult | MatchupPrepDashboardError
