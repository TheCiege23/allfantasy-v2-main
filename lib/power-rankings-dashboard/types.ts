import type { PowerRankingsOutput, PowerRankingTeam } from '@/lib/league-power-rankings/types'
import type { LeagueToolAccessErrorCode } from '@/lib/ai-tools/league-tool-context-types'
import type { AiTimeContextPayload } from '@/lib/time-engine/types'

export type RankingModeId =
  | 'current_power'
  | 'weekly_power'
  | 'rest_of_season'
  | 'playoff_odds'
  | 'championship_odds'
  | 'dynasty_power'
  | 'rebuild_index'
  | 'contender_index'
  | 'momentum'
  | 'all_around'

export type TimeWindowId = 'this_week' | 'last_2' | 'last_4' | 'season' | 'playoff_window' | 'dynasty_long'

export type TeamContextId =
  | 'full_league'
  | 'my_team'
  | 'specific_team'
  | 'division'
  | 'playoff_teams'
  | 'bubble'
  | 'bottom'

/** Rank tertile — data-derived from standings position, not marketing tiers. */
type RankThirdLabel = 'upper_third' | 'middle_third' | 'lower_third'

type PlayoffFieldStatus = 'inside' | 'bubble' | 'outside' | 'unknown'

type ContenderSignal = 'firm' | 'bubble' | 'longshot'

type ProjectionTruthSource = 'sleeper_engine' | 'af_normalized' | 'standings_only'

type EnrichedTeamRow = PowerRankingTeam & {
  teamName: string
  avatarUrl: string | null
  externalId: string | null
  isCurrentUser: boolean
  /** Human label from rank tertile */
  tierLabel: string
  rankThird: RankThirdLabel
  momentumLabel: 'surging' | 'hot' | 'stable' | 'cold' | 'fading'
  snippet: string
  /** We do not emit sportsbook-style odds; use `playoffFieldStatus` + standings. */
  playoffOddsPct: null
  championshipOddsPct: null
  playoffFieldStatus: PlayoffFieldStatus
  contenderSignal: ContenderSignal
  contenderFactors?: ContenderFactors
  /** OUT/IR starters currently on this team's roster (null when projections skipped). */
  injuryDrag?: { outIrCount: number; questionableCount: number } | null
  /** 0–100 based on projection coverage / engine path */
  rowConfidence: number
}

type PowerRankingsScoringSummary = {
  scoringModel: string
  receptionFormat: string | null
  superflex: boolean | null
}

/** Provider-health flags for UI chips — mirrors other AI tools. */
type PowerRankingsSourceFlags = {
  /** Standings (W/L/PF/PA) resolved from DB or Sleeper */
  standingsReady: boolean
  /** Rosters resolved for roster-strength blend */
  rostersReady: boolean
  /** Projection engine attached to at least one team row (league-scored) */
  projectionLayerReady: boolean
  /** Injury-aware projections: roster batch saw at least one injury status */
  injuryNewsLayerReady: boolean
  /** Prior snapshot found — enables rankDelta movement */
  priorSnapshotReady: boolean
  /** League scoring rules applied via normalized league context */
  leagueScoringApplied: boolean
  /** AI time/league envelope attached to chimmyPayload */
  aiEnvelopeReady: boolean
}

/** Per-team factors that drive contender/pretender classification — all data-derived. */
type ContenderFactors = {
  /** Win% vs expected from PF distribution (1.0 = in-line, >1 = overperforming, <1 = underperforming). */
  luckFactor: number | null
  /** Strength of remaining schedule (0–1, higher = tougher). Null when SOS not computed. */
  remainingSosHigh: boolean | null
  /** Roster strength percentile within league (0–100) from projection engine. */
  rosterStrengthPct: number | null
  /** One-line reason for the classification. */
  rationale: string
}

export type PowerRankingsDashboardResult = {
  ok: true
  analysisScope: 'league' | 'none'
  engine: 'sleeper_v2' | 'af_projection_truth' | 'league_team_fallback' | 'none'
  projectionTruth: ProjectionTruthSource
  leagueName: string | null
  sport: string | null
  season: string | null
  week: number | null
  rankingMode: RankingModeId
  teams: EnrichedTeamRow[]
  raw: PowerRankingsOutput | null
  aiNarrative: string | null
  chimmyPayload: Record<string, unknown>
  dataGaps: string[]
  degraded: boolean
  computedAt: string
  scoringSummary: PowerRankingsScoringSummary | null
  timeContext: AiTimeContextPayload | null
  aggregateConfidence: number
  engineNotes: string[]
  sourceFlags: PowerRankingsSourceFlags
}

export type PowerRankingsDashboardError = {
  ok: false
  error: string
  code?: LeagueToolAccessErrorCode | 'VALIDATION'
  userMessage?: string
}

