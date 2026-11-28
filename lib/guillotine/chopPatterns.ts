/**
 * Repeating chop weeks (owner's request, 2026-11-25): "every odd week", "every week starting week 10", "a double
 * chop on week 13" — set once, so the commissioner never chops a team by hand.
 *
 * The engine already reads two things (./chopSchedule.ts): steps ("from week N, X teams a week") and exact-week
 * overrides ("week 13: 2 teams", "week 9: no chop"). A repeating pattern is nothing the engine has to learn: it is
 * a set of exact weeks, written as overrides in one go. So this file only FILLS the schedule the engine already
 * runs — a league's chops are still decided by `scheduledChops`, and the season preview on the rules page
 * (./calendarFit.ts `guillotineSeasonPreview`) shows the result before it is saved.
 *
 * Pure.
 */
import { MAX_CHOPS_PER_WEEK, type GuillotineAdvanced } from './chopSchedule'
import { isPeriodEndWeek } from './eliminationPeriods'

export type ChopPatternKind = 'every_week' | 'every_other_week' | 'odd_weeks' | 'even_weeks'

export const CHOP_PATTERN_OPTIONS: ReadonlyArray<{ value: ChopPatternKind; label: string }> = [
  { value: 'every_week', label: 'Every week' },
  { value: 'every_other_week', label: 'Every other week' },
  { value: 'odd_weeks', label: 'Odd weeks' },
  { value: 'even_weeks', label: 'Even weeks' },
]

export type ChopPattern = {
  kind: ChopPatternKind
  /** First and last week the pattern covers, inclusive. "Every other week" counts from `fromWeek`. */
  fromWeek: number
  toWeek: number
}

/**
 * The weeks a pattern names, oldest first. In a two-week-period league (MLB, ./eliminationPeriods.ts) only a
 * period's last week can chop, and the save refuses a chop count on any other week, so those are left out.
 */
export function chopPatternWeeks(pattern: ChopPattern, period?: { startWeek: number; periodWeeks: number }): number[] {
  const from = Math.max(1, Math.floor(pattern.fromWeek))
  const to = Math.floor(pattern.toWeek)
  const weeks: number[] = []
  for (let week = from; week <= to; week += 1) {
    const hit =
      pattern.kind === 'every_week' ||
      (pattern.kind === 'every_other_week' && (week - from) % 2 === 0) ||
      (pattern.kind === 'odd_weeks' && week % 2 === 1) ||
      (pattern.kind === 'even_weeks' && week % 2 === 0)
    if (!hit) continue
    if (period && period.periodWeeks > 1 && !isPeriodEndWeek(week, period.startWeek, period.periodWeeks)) continue
    weeks.push(week)
  }
  return weeks
}

/** The schedule with `chops` teams (0 = no chop) on each of `weeks`. Other weeks, steps and rules are untouched. */
export function applyChopPattern(advanced: GuillotineAdvanced, weeks: readonly number[], chops: number): GuillotineAdvanced {
  const n = Math.max(0, Math.min(MAX_CHOPS_PER_WEEK, Math.floor(chops)))
  const overrides = { ...advanced.overrides }
  for (const week of weeks) overrides[week] = n
  return { ...advanced, overrides }
}

/** "Weeks 5, 7 and 9" for the line that says what a pattern will set, before it is applied. */
export function describeWeeks(weeks: readonly number[]): string {
  if (weeks.length === 0) return 'No weeks'
  if (weeks.length === 1) return `Week ${weeks[0]}`
  return `Weeks ${weeks.slice(0, -1).join(', ')} and ${weeks[weeks.length - 1]}`
}
