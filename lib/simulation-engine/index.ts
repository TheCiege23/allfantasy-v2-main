/**
 * Simulation Engine — central export. Matchup & season modeling, playoff odds, score distribution.
 */

export * from './types'
export {
  getSimulationSports,
  resolveSportForSimulation,
  getDefaultScoreStdDev,
  getVolatilityTag,
} from './SportSimulationResolver'
export {
  sampleScoreDistribution,
  percentiles,
  buildScoreDistribution,
  type ScoreDistributionOutput,
} from './ScoreDistributionModel'
export { runMatchupSimulation } from './MatchupSimulator'
export { applyLeagueScoringToMatchupInput } from './applyLeagueScoringToMatchupInput'
export {
  calculatePlayoffOdds,
} from './SimulationEngine'
export {
  getMatchupSimulation,
  getLatestMatchupSimulationsForLeague,
  getSeasonSimulationForLeague,
  getLatestSeasonSimulation,
  getSimulationSummaryForAI,
} from './SimulationQueryService'
