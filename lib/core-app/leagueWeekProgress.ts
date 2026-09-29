import { leagueWeekFromSettings } from './seasonTimeline'
import { finishedWeekKey, type FinishedNflWeeks } from './finishedNflWeeks.types'

/**
 * A scored Thursday is still an unfinished fantasy week.
 *
 * ⚠ BUT A FULLY PLAYED WEEK IS FINISHED BEFORE THE PLATFORM SAYS SO. `currentWeek` is the league's
 * own period marker, and Sleeper does not advance it until Wednesday — so on the Tuesday after
 * week 3, every week-3 game final, "week < currentWeek" still read week 3 as in progress and the
 * home said "scores so far · 0% win" for games already lost (2026-09-29). `finishedNflWeeks`, when
 * a caller has it, is the schedule's answer (`loadFinishedNflWeeks`): the league's CURRENT week is
 * final once every regular-season NFL game in it is. NFL leagues only — it is the NFL schedule —
 * and never a week AHEAD of the league's marker, which the schedule cannot speak for.
 */
export function leagueWeekProgress(
  league: { settings?: unknown; season?: number | null; status?: string | null; sport?: string | null },
  finishedNflWeeks?: FinishedNflWeeks,
) {
  const currentWeek = leagueWeekFromSettings(league.settings)
  const complete = ['complete', 'completed', 'finished'].includes(String(league.status ?? '').toLowerCase())
  const nfl = String(league.sport ?? '').toUpperCase() === 'NFL'
  return {
    currentWeek,
    isFinal(season: number, week: number): boolean {
      if (league.season != null && season !== league.season) return season < league.season
      if (complete) return true
      if (currentWeek == null) return false
      if (week < currentWeek) return true
      return week === currentWeek && nfl && finishedNflWeeks?.has(finishedWeekKey(season, week)) === true
    },
  }
}
