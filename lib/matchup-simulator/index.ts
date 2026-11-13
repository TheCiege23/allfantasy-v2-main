/**
 * Matchup Simulator UX — view service, comparison, result renderer, position resolver, AI bridge, sport UI.
 */

export {
  getViewState,
  getDisplayPayload,
  formatScoreRangeLabel,
  MATCHUP_SIMULATOR_MESSAGES,
  type ViewState,
  type MatchupDisplayPayload,
} from './MatchupSimulatorViewService'

export {
  resolveComparisonSummary,
  type ComparisonSummary,
} from './TeamComparisonResolver'

export {
  resultToDisplayProps,
  type SimulationDisplayProps,
} from './SimulationResultRenderer'

export {
  getPositionSlotsForSport,
  getPositionSlotWeight,
  buildPositionComparisonRows,
  type PositionSlot,
  type PositionComparisonRow,
} from './PositionComparisonResolver'

export {
  getMatchupAIChatUrl,
  buildMatchupSummaryForAI,
  type MatchupContextForAI,
} from './SimulatorToAIContextBridge'

export {
  getSportOptionsForSimulation,
  getSportLabel,
  getVolatilityLabel,
  getSimulationTeamPresets,
  getScheduleFactorDefinitionsForSport,
  getDefaultScheduleFactorsForPreset,
  buildLineupForSimulationPreset,
  type SportOption,
  type SimulationTeamPreset,
  type SimulationScheduleFactorDefinition,
} from './SportSimulationUIResolver'
