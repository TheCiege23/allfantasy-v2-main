/**
 * Weeks played BEFORE a late-starting league existed ("pre-league weeks") — the pure rules.
 *
 * A league drafted mid-season starts at its sport's current week (`seasonStartWeek.ts`). The weeks
 * already played before the draft are still loaded — each team's drafted roster is scored on those
 * weeks' real stats — so managers can see what their team would have scored (owner's call,
 * 2026-11-22). Those matchups carry `type: 'pre_league'`.
 *
 * Whether they COUNT is the commissioner's toggle, `settings.pre_league_weeks_count`, off unless
 * stored true:
 *   - off: viewing only. No wins, losses, ties, points for/against, and no median result.
 *   - on:  they count exactly like regular weeks — head-to-head AND the league median.
 *
 * ⚠ A DISTINCT `type` IS THE SAFETY MECHANISM, NOT A LABEL. Every reader that already filters to
 * `type: 'regular'` (playoff seeding inputs, schedule runtime, recaps) skips these rows with no change.
 * The readers that do not filter by type are the ones handled explicitly: standings (here), the median
 * switch lock (`medianGameSwitch.ts`) and the week finalizer's open-week sweep (`weekFinalizer.ts`).
 */

export const PRE_LEAGUE_MATCHUP_TYPE = 'pre_league'

export const PRE_LEAGUE_WEEKS_COUNT_SETTINGS_KEY = 'pre_league_weeks_count'

/**
 * How many pre-league weeks the league has loaded (weeks 1..N), written by the backfill. The settings
 * screens read it to decide whether the toggle means anything; 0 for a league that started on week 1.
 */
export const PRE_LEAGUE_WEEKS_LOADED_SETTINGS_KEY = 'pre_league_weeks_loaded'

export function readPreLeagueWeeksLoaded(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 0
  const n = Number((settings as Record<string, unknown>)[PRE_LEAGUE_WEEKS_LOADED_SETTINGS_KEY])
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** The commissioner's toggle. False unless stored exactly `true`. */
export function readPreLeagueWeeksCount(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false
  return (settings as Record<string, unknown>)[PRE_LEAGUE_WEEKS_COUNT_SETTINGS_KEY] === true
}

export function isPreLeagueMatchup(row: { type?: string | null }): boolean {
  return row.type === PRE_LEAGUE_MATCHUP_TYPE
}

/**
 * The matchups standings may count. Off: pre-league rows are dropped. On: they are kept and read as
 * `regular`, so the median (`medianEligibleRows`) and every other per-type rule treat them as the
 * ordinary regular-season weeks they stand in for.
 */
export function countedStandingsMatchups<T extends { type?: string | null }>(rows: readonly T[], countPreLeague: boolean): T[] {
  if (!countPreLeague) return rows.filter((row) => !isPreLeagueMatchup(row))
  return rows.map((row) => (isPreLeagueMatchup(row) ? { ...row, type: 'regular' } : row))
}

/** Weeks 1..firstLeagueWeek-1, or none for a league that started on week 1. */
export function preLeagueWeekNumbers(firstLeagueWeek: number): number[] {
  const last = Math.floor(firstLeagueWeek) - 1
  return last >= 1 ? Array.from({ length: last }, (_, i) => i + 1) : []
}
