/**
 * Trajectory Foundation — public API.
 *
 * The reusable, provider-agnostic "what changed, and why" layer. Consume the
 * service with any adapter; every result is the same honest `Trajectory` shape.
 * See AUDIT.md for the supported/unsupported inventory and
 * ADR_TRAJECTORY_FOUNDATION.md for the design rationale.
 */

export type {
  Trajectory,
  TrajectoryPoint,
  TrajectoryDelta,
  TrajectoryDirection,
  TrajectoryAdapter,
} from './types'

export { computeDelta, deriveTrajectoryCore } from './delta'
export type { DeltaOptions } from './delta'

export { resolveWhyChanged } from './explain'

export { getTrajectory } from './service'

export { summarizeTrajectory } from './summarize'
export type { TrajectorySummary } from './summarize'

// Adapters
export {
  createSeasonForecastAdapter,
  mapSeasonForecastPoints,
} from './adapters/seasonForecast'
export type {
  SeasonForecastMetricField,
  SeasonForecastTrajectoryParams,
  SeasonForecastHistoryRow,
  SeasonForecastAdapterDeps,
} from './adapters/seasonForecast'

export {
  createLeagueEngagementAdapter,
  mapLeagueEngagementPoints,
} from './adapters/leagueEngagement'

export { createCurrentStateAdapter } from './adapters/currentState'

// Consumer composition
export {
  buildTeamForecastTrajectory,
} from './consumers/seasonForecast'
export type { TeamForecastTrajectory } from './consumers/seasonForecast'
