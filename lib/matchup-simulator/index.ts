/**
 * Matchup Simulator UX — view service, comparison, result renderer, position resolver, AI bridge, sport UI.
 */

export {
  getViewState,
  getDisplayPayload,
  formatScoreRangeLabel,
  MATCHUP_SIMULATOR_MESSAGES,
} from './MatchupSimulatorViewService'

export {
  resolveComparisonSummary,
} from './TeamComparisonResolver'

export {
  resultToDisplayProps,
} from './SimulationResultRenderer'

export {
  getPositionSlotsForSport,
  getPositionSlotWeight,
  buildPositionComparisonRows,
} from './PositionComparisonResolver'

export {
  getMatchupAIChatUrl,
  buildMatchupSummaryForAI,
} from './SimulatorToAIContextBridge'

export {
  getSportOptionsForSimulation,
  getSimulationTeamPresets,
  getScheduleFactorDefinitionsForSport,
  getDefaultScheduleFactorsForPreset,
  buildLineupForSimulationPreset,
  type SimulationTeamPreset,
} from './SportSimulationUIResolver'
