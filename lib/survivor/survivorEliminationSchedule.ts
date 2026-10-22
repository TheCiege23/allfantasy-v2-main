/**
 * Which scoring periods of a planned Survivor season send someone home, and how many.
 *
 * A plan lists one entry per elimination in `eliminationWeeks`. A week listed twice is a
 * double-elimination week: two councils run back to back on that week's scores. One per week is
 * always preferred; a week doubles up only when the season has fewer elimination periods than the
 * cast needs eliminations (an NFL season, or a late draft), and never more than twice.
 *
 * Pure: no database, no clock. The plan builder, the plan reader and the settings route all use it,
 * so a saved plan can only ever hold a schedule this function would produce.
 */

/** Councils one scoring period may hold. Two keeps a double-boot week watchable. */
export const SURVIVOR_MAX_ELIMINATIONS_PER_WEEK = 2

/** The periods between the opening week and the finale, which are the only ones that may vote. */
export function eliminationPeriods(startWeek: number, endWeek: number): number[] {
  return Array.from({ length: Math.max(0, endWeek - startWeek - 1) }, (_, i) => startWeek + 1 + i)
}

/**
 * Spread `required` eliminations across the season, ascending, a week repeated once per extra
 * council. Returns null when even two per week cannot fit.
 *
 * With room for one per week this returns exactly what the plan builder always produced, so every
 * saved one-per-week plan still validates.
 */
export function spreadEliminationWeeks(startWeek: number, endWeek: number, required: number): number[] | null {
  const available = endWeek - startWeek - 1
  if (!Number.isInteger(required) || required < 0) return null
  if (required === 0) return []
  if (available < 1 || required > available * SURVIVOR_MAX_ELIMINATIONS_PER_WEEK) return null
  if (required <= available) {
    return Array.from({ length: required }, (_, index) => startWeek + Math.ceil((index + 1) * available / required))
  }
  // Every period votes once; the extras are spaced across the season the same way single votes are.
  const doubles = required - available
  const extra = Array.from({ length: doubles }, (_, index) => startWeek + Math.ceil((index + 1) * available / doubles))
  return [...eliminationPeriods(startWeek, endWeek), ...extra].sort((a, b) => a - b)
}

/** How many councils `week` holds under `weeks` (0, 1 or 2). */
export function eliminationsInWeek(weeks: readonly number[], week: number): number {
  let count = 0
  for (const w of weeks) if (w === week) count++
  return count
}

/** Distinct weeks that vote, ascending. */
export function distinctEliminationWeeks(weeks: readonly number[]): number[] {
  return [...new Set(weeks)].sort((a, b) => a - b)
}

/** Weeks that hold two councils, ascending. */
export function doubleEliminationWeeks(weeks: readonly number[]): number[] {
  return distinctEliminationWeeks(weeks).filter(week => eliminationsInWeek(weeks, week) > 1)
}

/** Periods from the opening week up to the finale that send nobody home. */
export function noEliminationWeeksFor(startWeek: number, endWeek: number, weeks: readonly number[]): number[] {
  const voting = new Set(weeks)
  return Array.from({ length: endWeek - startWeek }, (_, i) => startWeek + i).filter(week => !voting.has(week))
}

/** The message for a season too short even at two per week. */
export function seasonTooShortMessage(castSize: number, required: number, startWeek: number, endWeek: number): string {
  const periods = Math.max(0, endWeek - startWeek - 1)
  return `Not enough season remains for ${castSize} managers: ${required} eliminations need at least ${Math.ceil(required / SURVIVOR_MAX_ELIMINATIONS_PER_WEEK)} voting periods at two per week, but only ${periods} remain between the opening week and the finale. Choose a smaller cast, an earlier draft, or next season.`
}

export interface WeekCouncilCounts {
  /** Councils the plan schedules this week. */
  planned: number
  /** `player_eliminated` audit rows written for this week. */
  eliminated: number
  /** The plan skipped the rest of the week because only three managers remain. */
  skipped: boolean
  /** Councils opened this week, not counting revotes (a revote belongs to the council it re-runs). */
  opened: number
}

export interface WeekCouncilState {
  /** Every scheduled council this week has sent someone home, or the rest were skipped. */
  done: boolean
  /** Another council may open now: one is still owed and every earlier one has resolved. */
  canOpenNext: boolean
  /** 1-based number of the council that would open next, for copy ("the second vote this week"). */
  nextOrdinal: number
}

/** Pure: where a planned elimination week stands. */
export function weekCouncilState(counts: WeekCouncilCounts): WeekCouncilState {
  const done = counts.skipped || counts.eliminated >= counts.planned
  return {
    done,
    canOpenNext: !done && counts.opened < counts.planned && counts.opened <= counts.eliminated,
    nextOrdinal: counts.opened + 1,
  }
}

function listWeeks(weeks: readonly number[]): string {
  if (weeks.length <= 1) return weeks.join('')
  return `${weeks.slice(0, -1).join(', ')} and ${weeks[weeks.length - 1]}`
}

/** One sentence for the season screens: "10 votes across 8 periods; weeks 9 and 14 have two." */
export function describeEliminationSchedule(weeks: readonly number[]): string {
  const periods = distinctEliminationWeeks(weeks).length
  const doubles = doubleEliminationWeeks(weeks)
  const base = `${weeks.length} ${weeks.length === 1 ? 'vote' : 'votes'} across ${periods} elimination ${periods === 1 ? 'period' : 'periods'}`
  if (!doubles.length) return base
  return `${base}; ${doubles.length === 1 ? 'week' : 'weeks'} ${listWeeks(doubles)} ${doubles.length === 1 ? 'has' : 'have'} two back-to-back votes`
}
