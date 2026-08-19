/**
 * Decision OS Manager Intelligence Platform — Phase 4: Transaction Readiness.
 * Display-only, deterministic, observational. No AI, no recommendations.
 */
export {
  MANAGER_TRANSACTION_READINESS_VERSION,
  type ManagerTransactionReadinessV1,
  type PressureLevel,
  type BenchFlexibility,
  type TransactionReadinessAggregationInput,
  type TransactionReadinessRosterPlayerInput,
  type TransactionReadinessRosterConfigInput,
} from './types'
export { aggregateTransactionReadiness } from './transactionReadinessAggregator'
export {
  createLiveTransactionReadinessDataProvider,
  type TransactionReadinessDataProvider,
  type TransactionReadinessResolverArgs,
} from './transactionReadinessResolver'
