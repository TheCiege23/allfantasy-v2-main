/**
 * Guilly elimination periods: one week (every sport, the default) or two weeks (MLB only).
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
 * Stored as `League.settings.guillotine_period_weeks` = 2; absent means one week. Written only for MLB
 * (creation and the League rules page refuse it elsewhere) and fixed once the first chop has happened.
 *
 * Pure.
 */

export const PERIOD_WEEKS_KEY = 'guillotine_period_weeks'

export type PeriodWeeks = 1 | 2

/** Sports whose Guilly leagues may use two-week elimination periods. */
export function supportsTwoWeekPeriods(sport: string | null | undefined): boolean {
  return String(sport ?? '').toUpperCase() === 'MLB'
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
