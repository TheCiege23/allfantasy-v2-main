/**
 * Per-league week resolution.
 *
 * The one question this repo has never had a single answer to: *what week is
 * this league on right now?* Four callers need it and each currently guesses —
 * `RedraftSeason.currentWeek` (a column nothing increments, so every season in
 * production reads 1), a month check, or a bare `|| 1`.
 *
 * Import from here, not from the individual files.
 */

export { resolveSportWeek, resolveSeasonWeekForRedraftSeason } from './seasonWeekService'
export type { SeasonWeekDeps } from './seasonWeekService'

export {
  resolveSportWeekFromSchedule,
  sportHasWeekSignal,
  toScheduleSportKey,
  MAX_PLAUSIBLE_SPORT_WEEK,
} from './sportWeekSignal'

export { mapSportWeekToLeagueWeek, resolveRegularSeasonEndWeek } from './leagueSeasonWeek'

export type {
  LeagueSeasonShape,
  LeagueSeasonWeekResolution,
  ScheduleRow,
  ScheduleSeasonType,
  SeasonWeekPhase,
  SeasonWeekUnknownReason,
  SportWeekResolution,
  SportWeekSlate,
  SportWeekState,
} from './types'
