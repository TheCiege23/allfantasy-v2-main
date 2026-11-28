/**
 * Guilly elimination periods: one week (the default) or two weeks, in every sport (MLB only until the owner's
 * list of 2026-11-25: "two-week chops for every sport").
 *
 * An MLB season is ~26 weeks. One chop a week finishes a 10-team league by week 9 and leaves the rest of
 * the season unplayed; a two-week period scores both weeks together and chops once at the end of each pair,
 * so the same league runs to week 18 and a slow week of rainouts weighs half as much.
 *
 * ⚠ NO NEW COLUMN. A period is KEYED BY ITS LAST WEEK everywhere the engine already keys a week:
 * `GuillotinePeriodScore.weekOrPeriod`, `GuillotineRosterState.choppedInPeriod`,
 * `GuillotineSeason.currentScoringPeriod`, the chop audit and the chop lock. So "chopped in week 4" stays a
 * true sentence, a one-week league is byte-for-byte what it was (its period's last week IS its week), and
 * the only thing a two-week league changes is which weeks are chop weeks (startWeek+1, startWeek+3, …) and
 * that a chop week's score is the sum of both weeks. The first week of a period has no score row of its own.
 *
 * Periods are counted from the league's first chop week (`eliminationStartWeek`). That week only moves
 * before the first chop (./draftWeekFloor.ts), so the pairing never shifts under a running season.
 *
 * Stored as `League.settings.guillotine_period_weeks` = 2; absent means one week. Fixed once the first chop has
 * happened. Each week of a period is scored on its own and the two are added (./nativeGuillotineWeek.ts), which is
 * the same for a week-keyed sport (NFL, NCAAF) as for a date-windowed one; the season still has to fit, which the
 * calendar check refuses or plans around (./calendarFit.ts): a 12-team NFL league needs two chops a period.
 *
 * Pure.
 */

export const PERIOD_WEEKS_KEY = 'guillotine_period_weeks'

type PeriodWeeks = 1 | 2

/** Sports whose Guilly leagues may use two-week elimination periods: every one (owner, 2026-11-25). */
export function supportsTwoWeekPeriods(_sport?: string | null): boolean {
  return true
}

/**
 * The last week the "later draft slot is chopped" tiebreak applies: week 1, where nothing else tells two teams
 * apart. A two-week league that starts in week 1 first chops in week 2, so for it the first period's last week.
 */
export function draftSlotTiebreakLastWeek(startWeek: number, periodWeeks: number): number {
  return periodWeeks > 1 && startWeek <= 1 ? periodEndWeek(1, 1, periodWeeks) : 1
}

/** The league's period length. Anything but an explicit 2 reads as one week, so every existing league is unchanged. */
export function readPeriodWeeks(settings: unknown): PeriodWeeks {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : null
  return s?.[PERIOD_WEEKS_KEY] === 2 ? 2 : 1
}

/** The last week of the period `week` falls in. One-week periods: the week itself. */
export function periodEndWeek(week: number, startWeek: number, periodWeeks: number): number {
  if (periodWeeks <= 1 || week < startWeek) return week
  const offset = week - startWeek
  return startWeek + Math.floor(offset / periodWeeks) * periodWeeks + periodWeeks - 1
}

/** True when a chop can land at the end of `week`. */
export function isPeriodEndWeek(week: number, startWeek: number, periodWeeks: number): boolean {
  return periodEndWeek(week, startWeek, periodWeeks) === week
}

/** The weeks scored together for the period that ends at `endWeek`, oldest first. */
export function weeksInPeriod(endWeek: number, periodWeeks: number): number[] {
  const n = Math.max(1, periodWeeks)
  return Array.from({ length: n }, (_, i) => endWeek - n + 1 + i)
}

/** The key (last week) of the period before the one ending at `endWeek`. */
export function previousPeriodEnd(endWeek: number, periodWeeks: number): number {
  return endWeek - Math.max(1, periodWeeks)
}
