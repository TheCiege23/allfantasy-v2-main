/**
 * THE one place a daily sport's redraft season length and playoff window are defined.
 *
 * 🛑 SIX FILES USED TO DISAGREE, AND THE TWO THAT WERE READ LIVE ENDED THE SEASON EARLY.
 * Season length came from `configs/<sport>.ts` (`defaultSeasonWeeks` 22/23/22) and the playoff start
 * from `DefaultPlayoffConfigResolver` via the `League.playoffStartWeek` column (22/23/22), so a native
 * NBA league's playoffs opened in its LAST week and the fantasy season ended about March 22 — three
 * weeks before the NBA's. `SportDefaultsRegistry`, `DefaultScheduleConfigResolver`,
 * `ScheduleTemplateResolver`, `lib/redraft/sportConfig.ts` and the commissioner panel each carried a
 * third, fourth and fifth answer. They all derive from this table now.
 *
 * Sized to the real calendars, in the 7-day weeks `lib/season-week/dailySportSeasonStarts.ts` counts
 * from the opener, so the last fantasy week contains the last regular-season day:
 *
 *   NBA 2026-27  Tue Oct 20 → Sun Apr 11   25 weeks  (week 25 = Apr 6–12)
 *   NHL 2026-27  Tue Sep 29 → Sat Apr 10   28 weeks  (84-game season; week 28 = Apr 6–12)
 *   MLB 2027     Wed Mar 24 → Sun Sep 26   27 weeks  (week 27 = Sep 22–28)
 *
 * `playoffWeeks` keeps each sport's existing bracket: 3 single-week rounds for NBA, and for MLB/NHL
 * two single-week rounds plus a two-week championship (`championship_length: 2`).
 *
 * Dependency-free on purpose: the sport configs, the creation registries and the client panels all
 * import it.
 */

export interface DailySportSeasonShape {
  /** Every fantasy week, regular season and playoffs. */
  totalWeeks: number
  playoffWeeks: number
  playoffTeams: number
}

export const DAILY_SPORT_SEASON_SHAPE = {
  NBA: { totalWeeks: 25, playoffWeeks: 3, playoffTeams: 6 },
  NHL: { totalWeeks: 28, playoffWeeks: 4, playoffTeams: 6 },
  MLB: { totalWeeks: 27, playoffWeeks: 4, playoffTeams: 6 },
} as const satisfies Record<string, DailySportSeasonShape>

export type DailySeasonSport = keyof typeof DAILY_SPORT_SEASON_SHAPE

/** The last regular-season week. */
export function regularSeasonWeeksFor(sport: DailySeasonSport): number {
  const s = DAILY_SPORT_SEASON_SHAPE[sport]
  return s.totalWeeks - s.playoffWeeks
}

/** The first playoff week. */
export function playoffStartWeekFor(sport: DailySeasonSport): number {
  return regularSeasonWeeksFor(sport) + 1
}
