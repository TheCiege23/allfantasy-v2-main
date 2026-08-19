/**
 * Decision OS Manager Intelligence Platform — Phase 3: Weekly Outlook.
 * Display-only, deterministic, observational. No AI, no recommendations.
 */
export {
  MANAGER_WEEKLY_OUTLOOK_VERSION,
  type ManagerWeeklyOutlookV1,
  type MatchupState,
  type ProjectedMargin,
  type LineupReadiness,
  type SchedulePressure,
  type WeeklyOutlookAggregationInput,
  type WeeklyOutlookMatchupInput,
  type WeeklyOutlookLineupInput,
} from './types'
export { aggregateWeeklyOutlook } from './weeklyOutlookAggregator'
export {
  createLiveWeeklyOutlookDataProvider,
  type WeeklyOutlookDataProvider,
  type WeeklyOutlookResolverArgs,
} from './weeklyOutlookResolver'
