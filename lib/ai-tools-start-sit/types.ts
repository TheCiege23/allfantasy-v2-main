import type { LeagueToolAccessErrorCode } from '@/lib/ai-tools/league-tool-context-types'
import type { SupportedSport } from '@/lib/sport-scope'
import type { AiTimeContextPayload } from '@/lib/time-engine/types'
import type { StartSitUnresolvedDecision } from '@/lib/ai-tools-start-sit/startSitUnresolved'

export type StartSitMode = 'balanced' | 'safe' | 'upside'

export type StartSitPlayerRow = {
  playerId: string
  recordId: string | null
  name: string
  position: string
  team: string
  projectedPoints: number | null
  floor: number | null
  ceiling: number | null
  recentFantasyAvg: number | null
  injuryStatus: string | null
  rollingFppg: number | null
  headshotUrl: string | null
  weatherAdjustedPoints: number | null
  weatherRiskLevel: string | null
  weatherSummary: string | null
  injuryNewsAdjustedPoints: number | null
  scoringRuleAdjustedProjection: number | null
  scheduleAdjustedProjection: number | null
  matchupAdjustedProjection: number | null
  projectionConfidence: number | null
  injuryNewsFreshnessAt: string | null
  projectionNotes: string[]
  injuryNewsSummary: string | null
}

export type StartSitAnalysisMode = 'league' | 'global'

export type StartSitValidationSnapshot = {
  leagueContextResolved: boolean
  scoringRulesPresent: boolean
  rosterLoaded: boolean
  lineupTemplateResolved: boolean
  timeContextPresent: boolean
  projectionBatchPresent: boolean
}

export type StartSitSourceFlags = {
  sportsDataReady: boolean
  injuryNewsLayerReady: boolean
  weatherLayerReady: boolean
  leagueScoringApplied: boolean
  aiEnvelopeReady: boolean
  /**
   * True when the long-term `strategicCoaching` snapshot was successfully attached to
   * `aiEnvelope.standard.strategicCoaching`. Null when not requested; false when requested but it failed.
   */
  strategicCoachingReady: boolean | null
}

export type StartSitRec = {
  player: StartSitPlayerRow
  reason: string
  confidence: number
}

export type StartSitStructuredDecision = {
  bestStart: { name: string; why: string; confidence: number }
  safest: { name: string; why: string; confidence: number }
  highestUpside: { name: string; why: string; confidence: number }
  fallback: { name: string; why: string }
  weatherNote: string | null
  scoringRuleNote: string | null
  lockTimeNote: string | null
  lineupBehaviorNote: string | null
}

type StartSitLineupSlotAnalysis = {
  slotName: string
  allowedPositions: string[]
  topCandidates: string[]
  canLateSwap: boolean | null
  topCandidateGameStart: string | null
}

export type StartSitAnalyzeResult = {
  ok: true
  analysisMode: StartSitAnalysisMode
  sport: SupportedSport
  leagueId: string | null
  teamId: string | null
  leagueName: string
  week: number
  weekLabel: string
  generalAnalysis: boolean
  mode: StartSitMode
  leagueSettingsSnapshot: Record<string, unknown> | null
  teamContext: {
    teamName: string | null
    record: string | null
    rank: number | null
    pointsFor: number | null
  }
  opponent: { name: string | null; notes: string[] } | null
  recommendations: {
    bestStart: StartSitRec | null
    bestSit: StartSitRec | null
    safest: StartSitRec | null
    upside: StartSitRec | null
    floorOption: StartSitRec | null
    fallback: StartSitRec | null
  }
  structuredDecision: StartSitStructuredDecision
  lineupSlotAnalysis: StartSitLineupSlotAnalysis[]
  matchupNotes: string[]
  injuryNewsNotes: string[]
  reasoning: { league: string; team: string }
  confidenceScore: number
  players: StartSitPlayerRow[]
  dataGaps: string[]
  dataFreshness: string
  chimmyPayload: Record<string, unknown>
  timeContext: AiTimeContextPayload
  validation: StartSitValidationSnapshot
  sourceFlags: StartSitSourceFlags
  summary: string
  unresolvedDecisions: StartSitUnresolvedDecision[]
  bestBallInformational: boolean
  lockStatusLabel: string | null
  dataQuality: 'full' | 'partial' | 'degraded'
}

export type StartSitAnalyzeError = {
  ok: false
  error: string
  code?: LeagueToolAccessErrorCode | 'VALIDATION' | 'SPORT_MISMATCH'
  userMessage?: string
}
