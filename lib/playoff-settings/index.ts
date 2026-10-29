/**
 * [NEW] lib/playoff-settings/index.ts
 * League Playoff Settings — barrel exports.
 */

export * from './types'
export {
  getPlayoffStagesBySport,
  getPremiumPlayoffStages,
  getDefaultPlayoffStages,
  validateStageIds,
  hasPremiumStages,
} from './PlayoffStageRegistry'
export { calculateScheduleAdjustment } from './PlayoffScheduleRecalculator'
export { getPlayoffConfig, savePlayoffConfig, stageEditorPlayoffStartWeek } from './PlayoffConfigService'
export {
  resolvePlayoffStartWeek,
  readChosenPlayoffStartWeek,
  sportDefaultPlayoffStartWeek,
} from './resolvePlayoffStartWeek'
