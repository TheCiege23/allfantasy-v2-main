/**
 * CAN THIS GUILLY CALENDAR REACH A CHAMPION?
 *
 * 🛑 NOTHING CHECKED. Creation wrote one chop a week from week 1 to the sport's last regular-season week
 * (NFL 18, NBA/NHL 24, MLB 26) whatever the team count, and the chop-schedule and rules editors checked
 * only syntax. The team-count limits allow 27 teams on single chops and 35 "with double-elimination
 * weeks" — but nothing set those weeks up. An NFL Guilly with 20+ teams reached its end week with
 * several teams alive, and `finishGuillotineSeason` crowned the points leader instead of the last team
 * standing.
 *
 * The rule mirrors the engine (GuillotineEliminationEngine):
 *   - each week from `startWeek` chops `scheduledChops(advanced, week, baseChops)`, capped so the field
 *     never drops below the endgame's size (1 for last team standing, N for a Final N);
 *   - a Final N then plays `finalPeriods` more weeks, starting the week after the last chop;
 *   - everything has to finish by `endWeek`.
 *
 * Two-week periods (MLB, ./eliminationPeriods.ts): only a period's LAST week can chop, and a Final N's
 * periods are two weeks each.
 *
 * Pure: no database, so creation, both editors and tests share one answer.
 */
import { MAX_CHOPS_PER_WEEK, scheduledChops, type GuillotineAdvanced } from './chopSchedule'

type CalendarFitInput = {
  teamCount: number
  startWeek: number
  endWeek: number
  baseChops: number
  advanced: GuillotineAdvanced
  /** Teams left when eliminations stop: 1, or N for a Final N. */
  threshold: number
  /** Periods the final plays after the last chop: 0 for last team standing, 3 for a Final N. */
  finalPeriods: number
  /** Weeks per elimination period (./eliminationPeriods.ts). Absent = 1. */
  periodWeeks?: number
}

type CalendarFit = {
  fits: boolean
  /** Teams still alive at `endWeek` if the schedule runs out first; `threshold` when it fits. */
  survivorsAtEnd: number
  lastChopWeek: number | null
  /** The week the season's final result is known. */
  finishWeek: number | null
}

export function guillotineCalendarFit(input: CalendarFitInput): CalendarFit {
  let alive = Math.max(0, Math.floor(input.teamCount))
  let lastChopWeek: number | null = null
  const periodWeeks = Math.max(1, Math.floor(input.periodWeeks ?? 1))
  // A period's chop lands on its last week, so a period that ends after `endWeek` never chops.
  for (let week = input.startWeek + periodWeeks - 1; week <= input.endWeek && alive > input.threshold; week += periodWeeks) {
    const chops = Math.min(scheduledChops(input.advanced, week, input.baseChops), alive - input.threshold)
    if (chops > 0) {
      alive -= chops
      lastChopWeek = week
    }
  }
  if (alive > input.threshold) return { fits: false, survivorsAtEnd: alive, lastChopWeek, finishWeek: null }
  const finishWeek = (lastChopWeek ?? input.startWeek - 1) + input.finalPeriods * periodWeeks
  return { fits: finishWeek <= input.endWeek, survivorsAtEnd: alive, lastChopWeek, finishWeek }
}

/** The sentence an editor shows when a calendar cannot finish. */
export function calendarFitMessage(input: CalendarFitInput, fit: CalendarFit): string {
  if (fit.survivorsAtEnd > input.threshold) {
    return `With ${input.teamCount} teams this chop schedule still has ${fit.survivorsAtEnd} alive after week ${input.endWeek}. Add double-chop weeks or move the last chop week later.`
  }
  return `The final needs ${input.finalPeriods * Math.max(1, input.periodWeeks ?? 1)} weeks after the last chop (week ${fit.lastChopWeek}), which runs past week ${input.endWeek}. Chop faster or move the last week later.`
}

/**
 * The schedule creation should use: the default (no steps) when it fits; otherwise the fewest opening
 * weeks of 2 (then 3, then 4) chops that make it fit, then `baseChops` a week. Null when even
 * `MAX_CHOPS_PER_WEEK` every week cannot finish — the league cannot be created as asked.
 */
export function planGuillotineChopSchedule(input: Omit<CalendarFitInput, 'advanced'>): GuillotineAdvanced | null {
  const base: GuillotineAdvanced = { steps: [], overrides: {}, immunity: 'off' }
  if (guillotineCalendarFit({ ...input, advanced: base }).fits) return base
  const span = input.endWeek - input.startWeek + 1
  for (let chops = Math.max(2, input.baseChops + 1); chops <= MAX_CHOPS_PER_WEEK; chops += 1) {
    for (let weeks = 1; weeks <= span; weeks += 1) {
      const steps =
        weeks >= span
          ? [{ fromWeek: input.startWeek, chops }]
          : [{ fromWeek: input.startWeek, chops }, { fromWeek: input.startWeek + weeks, chops: input.baseChops }]
      const advanced: GuillotineAdvanced = { steps, overrides: {}, immunity: 'off' }
      if (guillotineCalendarFit({ ...input, advanced }).fits) return advanced
    }
  }
  return null
}
