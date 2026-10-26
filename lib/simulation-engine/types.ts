/**
 * Simulation Engine — shared types. Sport-aware across NFL, NHL, NBA, MLB, NCAAB, NCAAF, Soccer.
 */
import {
  DEFAULT_SPORT,
  SUPPORTED_SPORTS,
  normalizeToSupportedSport,
  type SupportedSport,
} from '@/lib/sport-scope'

export const SIMULATION_SPORTS: readonly SupportedSport[] = [...SUPPORTED_SPORTS]

export type SimulationSport = SupportedSport

export function normalizeSportForSimulation(sport: string): SimulationSport {
  const u = sport?.toUpperCase?.() || DEFAULT_SPORT
  if (SIMULATION_SPORTS.includes(u as SimulationSport)) return normalizeToSupportedSport(u)
  const map: Record<string, SimulationSport> = {
    NFL: 'NFL',
    NHL: 'NHL',
    NBA: 'NBA',
    MLB: 'MLB',
    NCAAB: 'NCAAB',
    NCAAF: 'NCAAF',
    SOCCER: 'SOCCER',
  }
  return normalizeToSupportedSport(map[u] ?? u)
}

export interface MatchupSimulationInput {
  sport: string
  leagueId?: string
  weekOrPeriod: number
  teamA: MatchupSimulationTeamInput
  teamB: MatchupSimulationTeamInput
  iterations?: number
  deterministicSeed?: string
}

/** Upside/downside scenario (Prompt 133). */
export interface ScenarioScore {
  teamA: number
  teamB: number
  /** e.g. 90 = upside, 10 = downside */
  percentile: number
}

export interface MatchupScheduleFactorsInput {
  /** -1 = strong road drag, 0 = neutral, 1 = strong home/venue edge */
  venue?: number
  /** -1 = poor rest / congested schedule, 0 = neutral, 1 = extra rest */
  rest?: number
  /** -1 = difficult matchup, 0 = neutral, 1 = favorable matchup */
  matchup?: number
  /** -1 = low-event environment, 0 = neutral, 1 = high-event environment */
  tempo?: number
}

export interface MatchupLineupSlotInput {
  slotId: string
  slotLabel?: string
  playerName?: string
  /** Fantasy points for this slot; optional when sending `projectedStats` with `leagueId` (server fills before sim). */
  projection?: number
  floor?: number
  ceiling?: number
  /** 1 = baseline slot volatility; >1 widens range, <1 tightens it. */
  volatility?: number
  /**
   * Optional projected raw stat line (keys aligned with league scoring template, e.g. `pass_yd`, `passing_td`).
   * When the simulation request includes `leagueId`, the server recomputes `projection` via the league’s
   * effective rules (`resolveScoringRulesForLeague` + `computeFantasyPointsFromStats`) before Monte Carlo.
   */
  projectedStats?: Record<string, unknown>
}

export interface MatchupSimulationTeamInput {
  mean?: number
  stdDev?: number
  teamId?: string
  teamName?: string
  lineup?: MatchupLineupSlotInput[]
  scheduleFactors?: MatchupScheduleFactorsInput
}

export interface MatchupLineupSlotSummary {
  slotId: string
  slotLabel: string
  playerName: string
  projection: number
  adjustedProjection: number
  floor: number
  ceiling: number
  sampleStdDev: number
  volatility: number
  scheduleImpact: number
}

export interface MatchupSimulationTeamSummary {
  baselineMean: number
  adjustedMean: number
  adjustedFloor: number
  adjustedCeiling: number
  derivedStdDev: number
  scheduleAdjustment: number
  scheduleMultiplier: number
  scheduleFactors: Required<MatchupScheduleFactorsInput>
  lineup: MatchupLineupSlotSummary[]
}

export interface MatchupSlotComparisonRow {
  slotId: string
  slotLabel: string
  teamAPlayerName: string
  teamBPlayerName: string
  teamAScore: number
  teamBScore: number
  edge: number
  advantage: 'A' | 'B' | 'even'
  edgeLabel: string
}

export interface MatchupProviderInsights {
  aiUsed?: boolean
  deepseek: string
  grok: string
  openai: string
}

export interface MatchupSimulationOutput {
  simulationId?: string
  sport: string
  leagueId?: string
  weekOrPeriod: number
  expectedScoreA: number
  expectedScoreB: number
  winProbabilityA: number
  winProbabilityB: number
  scoreDistributionA?: number[]
  scoreDistributionB?: number[]
  marginMean: number
  marginStdDev: number
  upsetChance: number
  volatilityTag: 'low' | 'medium' | 'high'
  iterations: number
  createdAt?: string
  /** Upside scenario (e.g. 90th percentile scores). */
  upsideScenario?: ScenarioScore
  /** Downside scenario (e.g. 10th percentile scores). */
  downsideScenario?: ScenarioScore
  scoreRangeA?: [number, number]
  scoreRangeB?: [number, number]
  teamSummaryA?: MatchupSimulationTeamSummary
  teamSummaryB?: MatchupSimulationTeamSummary
  slotComparisons?: MatchupSlotComparisonRow[]
  deterministicSeed?: number
  providerInsights?: MatchupProviderInsights
}

export interface SeasonSimulationInput {
  leagueId: string
  sport: string
  season: number
  weekOrPeriod: number
  totalWeeks?: number
  playoffSpots?: number
  byeSpots?: number
  simulations?: number
}

export interface SeasonSimulationTeamOutput {
  teamId: string
  playoffProbability: number
  championshipProbability: number
  expectedWins: number
  expectedRank: number
}

export interface SeasonSimulationOutput {
  resultId?: string
  sport: string
  leagueId: string
  season: number
  weekOrPeriod: number
  teamResults: SeasonSimulationTeamOutput[]
  simulationsRun: number
  createdAt?: string
}
