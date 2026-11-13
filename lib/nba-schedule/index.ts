/**
 * [NEW] lib/nba-schedule/index.ts
 * NBA scheduling intelligence layer — barrel exports.
 */

export * from './types'
export {
  getWeekVolumeProfile,
  getLeastBusyDay,
  getMostBusyDay,
  getBalancedScoringDays,
  getWeekGameCounts,
  getSeasonVolumeProfiles,
  classifyDay,
} from './NbaGameVolumeService'
export {
  getNbaScheduleConfig,
  updateNbaScheduleConfig,
} from './NbaScheduleConfigService'
export {
  resolveNbaFantasyWeek,
} from './NbaFantasyWeekResolver'
export { getScheduleAdapter } from './adapters'
