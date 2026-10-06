import type { LeagueToolAccessErrorCode } from '@/lib/ai-tools/league-tool-context-types'
import type { LineupActionSummaryPayload } from '@/lib/lineup-actions/types'

/**
 * Tool ids for War Room deep links. These once mirrored `AIToolGridId` in
 * components/ai-tools/ai-tool-ids.ts; that grid was deleted 2026-10-06 (unmounted since 2026-07-06).
 */
export type WarRoomLinkToolId =
  | 'startSit'
  | 'trade'
  | 'waiver'
  | 'trending'
  | 'power'
  | 'injury'
  | 'matchupPrep'
  | 'warRoom'

export type WarRoomTeamContextId =
  | 'my_team'
  | 'specific_team'
  | 'league_wide'
  | 'opponent_view'
  | 'full_portfolio'

export type WarRoomStrategyId =
  | 'balanced'
  | 'win_now'
  | 'aggressive'
  | 'conservative'
  | 'rebuilder'
  | 'playoff_push'
  | 'streaming_focus'
  | 'prospect_focus'
  | 'dynasty_long_term'
  | 'neutral'

export type WarRoomTimeHorizonId =
  | 'today'
  | 'this_week'
  | 'next_2_weeks'
  | 'next_month'
  | 'rest_of_season'
  | 'playoff_window'
  | 'dynasty_long'

export type WarRoomViewTabId =
  | 'overview'
  | 'actions'
  | 'start_sit'
  | 'waivers'
  | 'trades'
  | 'injuries'
  | 'trends'
  | 'power'
  | 'schedule'
  | 'team_outlook'
  | 'ai_chat'

export type WarRoomToggles = {
  includeNews: boolean
  includeInjuries: boolean
  includeWaiverSuggestions: boolean
  includeTradeSuggestions: boolean
  includeStartSitRecommendations: boolean
  includePowerRankings: boolean
  includeTrendingPlayers: boolean
  includeRookieProspectIntel: boolean
  includePlayoffImpact: boolean
  includeDynastyWeighting: boolean
  /** Head-to-head projections, opponent edges, game plan (requires league). */
  includeMatchupPrep: boolean
  /** Lineup queue / locks / cross-tool actions from Today Actions engine. */
  includeTodayActions: boolean
}

export type WarRoomActionSource =
  | 'start_sit'
  | 'waiver'
  | 'injury'
  | 'trend'
  | 'power'
  | 'trade'
  | 'schedule'
  | 'matchup_prep'
  | 'today_actions'

export type WarRoomActionItem = {
  id: string
  rank: number
  urgency: number
  confidence: number
  title: string
  detail: string
  source: WarRoomActionSource
  linkTool?: WarRoomLinkToolId
  estimatedEdgePts?: number | null
  /** Tools that contributed (after merge / dedupe). */
  sourceTools?: WarRoomLinkToolId[]
  playerIds?: string[]
  urgencyTier?: 'critical' | 'high' | 'medium' | 'low'
  expectedPayoff?: string | null
  biggestRisk?: string | null
  biggestOpportunity?: string | null
  reasoning?: string | null
  confidenceNote?: string | null
}

export type WarRoomIngestionRow = {
  module: string
  status: 'ok' | 'skipped' | 'failed'
  detail?: string
  /**
   * Per-module sourceFlags extracted from the underlying dashboard output
   * (Start/Sit, Waiver, Injury, Trending, Power, Matchup Prep each expose their own).
   * Null when the module did not report flags or was skipped/failed.
   */
  sourceFlags?: Record<string, boolean> | null
}

/**
 * Aggregated provider-health summary at War Room level — pooled true/false across
 * every ingested module so the modal can render a compact coverage chip row.
 */
export type WarRoomAggregatedSourceFlags = {
  /** Any ingested module flagged projections ready. */
  projectionLayerReady: boolean
  /** Any ingested module saw injury/news data. */
  injuryNewsLayerReady: boolean
  /** Any ingested module saw weather data. */
  weatherLayerReady: boolean
  /** Every ingested module had league scoring rules applied (false = at least one skipped). */
  leagueScoringAppliedEverywhere: boolean
  /** AI envelope attached on any module that reported the flag. */
  aiEnvelopeReady: boolean
  /** Count of modules reporting each flag true — useful for "3/5 modules have weather" chips. */
  moduleCounts: {
    withProjections: number
    withInjuryNews: number
    withWeather: number
    withLeagueScoring: number
    total: number
  }
}

export type WarRoomOrchestrationMeta = {
  serverTimeIso: string
  /** `league` = roster-aware tools on a selected league; `portfolio` = cross-league / global where applicable. */
  analysisMode: 'league' | 'portfolio'
  /** Human-readable mode for UI (kept in sync with analysisScope). */
  analysisModeLabel: string
  /** Short line from normalized league context engine (scoring rules). */
  leagueScoringDigest: string | null
  /** Legacy single-line scoring note from waiver/start-sit snapshots (may duplicate digest). */
  leagueScoringNote: string | null
  /** Account TZ + sport window + lock proximity from time engine. */
  timeContextSummary: string | null
  /** Which tool modules produced usable data vs skipped/failed (ground-truth for coverage). */
  ingestionHealth: WarRoomIngestionRow[]
  /** Deterministic description of how actions are ordered (no ML). */
  prioritizationModel: string
  /** How per-action confidence is interpreted when merging tools. */
  confidenceModel: string
  lockWindowSummary: string | null
  weatherNotes: string | null
  strategyAlignmentNote: string | null
  projectionContext: string | null
  aggregatedSourceFlags: WarRoomAggregatedSourceFlags
}

export type WarRoomConflict = {
  id: string
  summary: string
  primaryAction: string
  alternateAction: string
  /** 0–100 — how strongly the primary action should win when tools disagree. */
  recommendedConfidence?: number
  /** Short rationale for the resolution (deterministic, data-grounded). */
  resolutionNote?: string
}

export type WarRoomCommandCenterInput = {
  userId: string
  sportFilter: 'ALL' | string
  leagueId: string | null
  teamContext: WarRoomTeamContextId
  strategyMode: WarRoomStrategyId
  timeHorizon: WarRoomTimeHorizonId
  specificTeamExternalId?: string | null
  opponentTeamExternalId?: string | null
  toggles: WarRoomToggles
  skipAi?: boolean
  /**
   * When provided (e.g. Today Actions already computed lineup + Chimmy advice), War Room reuses it
   * for `includeTodayActions` instead of re-fetching lineup scans.
   */
  precomputedTodayLineup?: LineupActionSummaryPayload | null
}

export type WarRoomModuleSnapshot = {
  startSit: Record<string, unknown> | null
  waiver: Record<string, unknown> | null
  injury: Record<string, unknown> | null
  trending: Record<string, unknown> | null
  power: Record<string, unknown> | null
  matchupPrep: Record<string, unknown> | null
  todayActions: Record<string, unknown> | null
  /** League scoring + roster linkage for Trade Value (no synthetic trade sides). */
  tradeValue: Record<string, unknown> | null
}

export type WarRoomCommandCenterResult = {
  ok: true
  analysisScope: 'league' | 'general'
  leagueName: string | null
  sportLabel: string
  teamContextLabel: string
  strategyMode: WarRoomStrategyId
  timeHorizon: WarRoomTimeHorizonId
  overview: {
    teamName: string | null
    record: string | null
    standingRank: number | null
    powerScore: number | null
    momentumLabel: string | null
    injuryRisk: number | null
    commandPriority: number
    nextMatchupNote: string | null
    topActions: string[]
    dataFreshness: string
    degraded: boolean
    biggestRisk: string | null
    biggestOpportunity: string | null
    /** Mirrors orchestration analysis mode for UI badges. */
    analysisMode: 'league' | 'portfolio'
    analysisModeLabel: string
  }
  scores: {
    commandPriority: number
    teamRisk: number | null
    waiverOpportunity: number | null
    contenderSignal: number | null
    trendSignal: number | null
  }
  actions: WarRoomActionItem[]
  conflicts: WarRoomConflict[]
  modules: WarRoomModuleSnapshot
  orchestration: WarRoomOrchestrationMeta
  dataGaps: string[]
  aiSummary: string | null
  chimmyPayload: Record<string, unknown>
  computedAt: string
}

export type WarRoomCommandCenterError = {
  ok: false
  error: string
  code?: LeagueToolAccessErrorCode | 'VALIDATION'
  userMessage?: string
}

export type WarRoomCommandCenterOutput = WarRoomCommandCenterResult | WarRoomCommandCenterError
