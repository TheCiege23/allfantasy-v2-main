import type { LeagueToolAccessErrorCode } from '@/lib/ai-tools/league-tool-context-types'
import type { SupportedSport } from '@/lib/sport-scope'

export type TrendSportFilter = 'ALL' | SupportedSport

export type TrendTypeId =
  | 'all'
  | 'add'
  | 'drop'
  | 'start'
  | 'sit'
  | 'trade'
  | 'performance'
  | 'usage'
  | 'injury_replacement'
  | 'rookie'

export type TimeWindowId =
  | 'today'
  | '24h'
  | '3d'
  | '7d'
  | '14d'
  | '30d'
  | 'season'
  | 'dynasty_long'

export type ContextModeId =
  | 'general'
  | 'my_leagues'
  | 'my_team'
  | 'league_wide'
  | 'opponent_watch'
  | 'waiver_watch'
  | 'trade_market'
  | 'start_sit_market'

export type TrendReasonChip =
  | 'Injury Opportunity'
  | 'Role Growth'
  | 'Breakout'
  | 'Trade Buzz'
  | 'Waiver Surge'
  | 'Start Surge'
  | 'Prospect Rise'
  | 'Lineup Promotion'
  | 'Minutes Jump'
  | 'Target Spike'
  | 'Matchup Risk'
  | 'Role Loss'
  | 'Injury Concern'
  | 'Demotion'
  | 'Volatile'
  | 'Performance Swing'
  | 'Usage Shift'

export type TrendLeagueRelevance = 'on_your_roster' | 'rostered_elsewhere' | 'likely_available' | 'unknown'

export type TrendActionRecommendation = 'add' | 'hold' | 'sell' | 'monitor' | 'watch'

export type TrendPlayerCard = {
  rank: number
  playerId: string
  sport: SupportedSport | string
  name: string
  position: string
  team: string
  headshotUrl: string | null
  logoUrl: string | null
  trendScore: number
  trendDelta: number
  confidence: number
  rosteredPct: number | null
  snippet: string
  chips: TrendReasonChip[]
  sources: string[]
  injuryStatus: string | null
  isRookie: boolean | null
  dataFreshness: string
  /** League-scored effective projection when normalization resolves */
  projectedFantasyPoints?: number | null
  /** Deterministic explanation lines (no invented narratives) */
  structuredWhy?: string[]
  identityConfidence?: 'full' | 'degraded' | 'ambiguous'
  identityNotes?: string[]
  actionRecommendation?: TrendActionRecommendation
  leagueRelevance?: TrendLeagueRelevance
  integrationHints?: {
    waiverWire: boolean
    tradeValue: boolean
    injuryImpact: boolean
  }
}

/** Provider-health flags for UI chips — mirrors other AI tools. */
export type TrendingSourceFlags = {
  /** FantasyCalc value-trend feed returned rows. */
  fantasyCalcReady: boolean
  /** Sleeper `trending_players` table returned rows for this sport window. */
  sleeperTrendingReady: boolean
  /** `player_meta_trends` rollup provided additional signals. */
  metaTrendsReady: boolean
  /** Normalized projection batch attached to at least one card. */
  projectionLayerReady: boolean
  /** Injury / news signal attached to at least one card. */
  injuryNewsLayerReady: boolean
  /** League scoring rules applied via normalized league context. */
  leagueScoringApplied: boolean
  /** AI time/league envelope attached to chimmyPayload. */
  aiEnvelopeReady: boolean
}

export type TrendingDashboardResult = {
  ok: true
  analysisScope: 'general' | 'league'
  sportLabel: string
  leagueName: string | null
  summary: {
    riserCount: number
    fallerCount: number
    biggestGainer: TrendPlayerCard | null
    biggestFaller: TrendPlayerCard | null
  }
  risers: TrendPlayerCard[]
  fallers: TrendPlayerCard[]
  aiNarrative: string | null
  chimmyPayload: Record<string, unknown>
  dataGaps: string[]
  degraded: boolean
  fetchedAt: string
  sourceFlags: TrendingSourceFlags
}

export type TrendingDashboardError = {
  ok: false
  error: string
  code?: LeagueToolAccessErrorCode | 'VALIDATION'
  userMessage?: string
}

export type TrendingDashboardOutput = TrendingDashboardResult | TrendingDashboardError
