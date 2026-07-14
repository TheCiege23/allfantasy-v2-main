export type {
  HistoricalTradeSample,
  HistoricalTradeRealOutcome,
  SkippedTradeSample,
  HistoricalTradeLoadResult,
  BacktestSampleFailure,
  BacktestRunSummary,
  BacktestThresholds,
  DivergenceCategory,
  GraderParitySummary,
  GroupedDivergenceCounts,
  BacktestDivergenceSummary,
} from './types'
export { DEFAULT_BACKTEST_THRESHOLDS } from './types'

export { loadHistoricalTradeSamples, type LoadHistoricalTradeSamplesOptions } from './HistoricalTradeLoader'
export { runTradeShadowBacktest, type BacktestRunOptions } from './TradeShadowBacktestRunner'
export { summarizeDivergence, classifyDivergence } from './DivergenceAnalyzer'
