/**
 * [NEW] lib/fantasy-schedule/index.ts
 * Sport-agnostic fantasy scheduling intelligence — barrel exports.
 * Works for NBA, NHL, MLB, NFL, NCAAF, NCAAB, SOCCER.
 */

export * from './types'
export {
  getWeekVolumeProfile,
  getLeastBusyDay,
  getMostBusyDay,
  getBalancedScoringDays,
  getWeekGameCounts,
  getSeasonVolumeProfiles,
} from './GameVolumeService'
export {
  getScheduleConfigForLeague,
  updateScheduleConfigForLeague,
} from './ScheduleConfigService'
export { resolveFantasyWeek } from './FantasyWeekResolver'
export { getScheduleAdapter } from './adapters'
