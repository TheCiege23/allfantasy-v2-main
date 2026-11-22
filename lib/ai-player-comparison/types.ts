import type { ScoringFormat } from '@/lib/player-comparison-lab/types'

/** Client / API strategy mode — adjusts deterministic weights (does not invent stats). */
export type AiPlayerComparisonStrategyMode =
  | 'balanced'
  | 'need_upside'
  | 'need_floor'
  | 'need_safety'
  | 'underdog'
  | 'favored'

type AiPlayerComparisonLeagueFormat = 'redraft' | 'keeper' | 'dynasty'

type AiPlayerComparisonLineupSlot =
  | 'QB'
  | 'RB'
  | 'WR'
  | 'TE'
  | 'FLEX'
  | 'SUPERFLEX'
  | 'K'
  | 'DST'
  | 'IDP_FLEX'
  | 'BENCH'
  | 'UTIL'
  | 'OTHER'

type AiPlayerComparisonLeagueContext = {
  format?: AiPlayerComparisonLeagueFormat | null
  /** e.g. league name for display only */
  leagueName?: string | null
  leagueId?: string | null
  teamId?: string | null
  week?: number | null
}

export type AiPlayerComparisonRequest = {
  playerA: string
  playerB: string
  sport: string
  scoringFormat?: ScoringFormat | string | null
  lineupSlot?: AiPlayerComparisonLineupSlot | string | null
  strategyMode?: AiPlayerComparisonStrategyMode | string | null
  leagueContext?: AiPlayerComparisonLeagueContext | null
  /** When true, runs optional AI narrative on top of deterministic engine (feature-gated server-side). */
  includeAiNarrative?: boolean
}

export type AiCategoryBattle = {
  id: 'projection' | 'matchup' | 'usage' | 'floor' | 'ceiling' | 'risk'
  label: string
  winner: 'playerA' | 'playerB' | 'tie'
  /** Plain-language edge for the UI table */
  detail: string
  /** Approximate edge -1..1 from deterministic rows (positive favors A) */
  edgeSignal: number | null
}

export type AiScenarioAdviceBlock = {
  needUpside: string
  needFloor: string
  needSafety: string
  favored: string
  underdog: string
}

export type AiPlayerComparisonPlayerBlock = {
  name: string
  position: string | null
  team: string | null
  projectedPoints: number | null
  rank: number | null
  volatility: number | null
  injuryRisk: number | null
  injuryStatus: string | null
}

/**
 * Structured Start A vs B response — deterministic-first; AI only enriches copy when enabled.
 */
export type AiPlayerComparisonResponse = {
  ok: true
  sport: string
  scoringFormat: ScoringFormat | null
  strategyMode: AiPlayerComparisonStrategyMode
  lineupSlot: string | null
  recommendedPlayer: string | null
  recommendedSide: 'playerA' | 'playerB' | 'tie'
  confidencePct: number
  verdict: string
  summary: string
  categories: {
    projection: AiCategoryBattle
    matchup: AiCategoryBattle
    usage: AiCategoryBattle
    floor: AiCategoryBattle
    ceiling: AiCategoryBattle
    risk: AiCategoryBattle
  }
  scenarioAdvice: AiScenarioAdviceBlock
  playerA: AiPlayerComparisonPlayerBlock
  playerB: AiPlayerComparisonPlayerBlock
  reasoningBullets: string[]
  riskNotes: string[]
  dataSources: string[]
  /** Original engine explanation (deterministic or AI layer from lab) */
  narrative: string
  narrativeSource: 'deterministic' | 'ai'
  /** Raw deterministic rows for power users / Chimmy */
  engine: {
    statComparisons: import('@/lib/player-comparison-lab/types').DeterministicStatComparisonRow[]
    comparisonSummaryLines: string[]
  }
}

