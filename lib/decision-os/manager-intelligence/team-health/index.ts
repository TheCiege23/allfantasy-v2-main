/**
 * Decision OS Manager Intelligence Platform — Phase 2: Team Health.
 * Display-only, deterministic, observational. No AI, no recommendations.
 */
export {
  MANAGER_TEAM_HEALTH_VERSION,
  type ManagerTeamHealthV1,
  type BenchAvailability,
  type RosterCompleteness,
  type TeamHealthAggregationInput,
  type TeamHealthRosterPlayerInput,
} from './types'
export { aggregateManagerTeamHealth } from './teamHealthAggregator'
export {
  createLiveTeamHealthDataProvider,
  type TeamHealthDataProvider,
  type TeamHealthResolverArgs,
} from './teamHealthResolver'
