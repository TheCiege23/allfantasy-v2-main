/**
 * Scheduled period calendar — pure, deterministic, dependency-free.
 *
 * ⚠ ADVANCEMENT FOLLOWS THE SCHEDULE, NEVER THE EVIDENCE. A period with no matchup rows is
 * still a scheduled period: it gets targeted, deferred and eventually closed by a durable
 * SKIP. Advancing over the weeks that happen to have evidence turns "weeks 5 and 6 are
 * missing" into "weeks 4 and 7 are consecutive", and hysteresis then reports a three-period
 * run that never happened.
 *
 * ⚠ THIS MODULE IMPORTS NOTHING. In particular it does not read `simulateApiCore.ts`. That
 * file's `z.number().min(2).max(16)` bounds a SIMULATION REQUEST, not a league's real
 * playoff field, and borrowing it here would silently cap real leagues at a limit no
 * provider ever stated. A provider limit is enforced only when an authoritative adapter
 * supplies one.
 */

export type ScheduleRefusal =
  | 'playoff_start_period_missing'
  | 'playoff_start_period_out_of_range'
  | 'playoff_teams_missing'
  | 'playoff_teams_out_of_range'
  | 'weeks_per_round_missing'
  | 'weeks_per_round_out_of_range'
  | 'league_size_missing'
  | 'league_size_out_of_range'
  | 'max_scheduled_period_invalid'
  | 'provider_playoff_limit_invalid'
  | 'playoff_teams_exceed_league_size'
  | 'playoff_teams_exceed_provider_limit'
  | 'schedule_exceeds_period_bound'

export interface ScheduleInput {
  /** First period of the playoff bracket. */
  playoffStartPeriod: number | null | undefined
  /** Teams in the playoff field. 0 and 1 are legal and mean "no playoffs". */
  playoffTeams: number | null | undefined
  weeksPerRound: number | null | undefined
  leagueSize: number | null | undefined
  /** Hard ceiling from the observation schema's period CHECK. */
  maxScheduledPeriod: number
  /**
   * Upper bound on the playoff field, supplied ONLY by an authoritative provider adapter.
   *
   * ⚠ `undefined`/`null` means "no provider has stated a limit", and NOTHING is substituted.
   * Whether a given platform actually permits, say, a 32-team bracket is an adapter and
   * import-certification question; this calendar answers only whether the bracket is
   * mathematically resolvable within the league and the schema bound.
   */
  providerPlayoffLimit?: number | null
}

export interface Schedule {
  kind: 'schedule'
  /** Consecutive, ascending, starting at 1. */
  periods: readonly number[]
  regularSeasonEndPeriod: number
  playoffRounds: number
  playoffPeriods: readonly number[]
  lastPeriod: number
}

export type ScheduleResolution = Schedule | { kind: 'refused'; reason: ScheduleRefusal }

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0
}

/**
 * Rounds needed to reduce `teams` to one winner, computed by doubling rather than
 * `Math.ceil(Math.log2(n))` — floating point makes that expression unreliable at exact
 * powers of two, and a bracket size is not a place to accept "usually right".
 *
 * Byes are implicit and correct: a 6-team field needs 3 rounds (two first-round games while
 * the top two seeds idle, then semis, then the final).
 */
export function bracketRounds(teams: number): number {
  if (teams <= 1) return 0
  let rounds = 0
  let capacity = 1
  while (capacity < teams) {
    capacity *= 2
    rounds += 1
  }
  return rounds
}

export function resolveScheduledPeriods(input: ScheduleInput): ScheduleResolution {
  const refuse = (reason: ScheduleRefusal) => ({ kind: 'refused' as const, reason })

  if (!isPositiveInt(input.maxScheduledPeriod) || input.maxScheduledPeriod < 1) {
    return refuse('max_scheduled_period_invalid')
  }
  if (input.playoffStartPeriod == null) return refuse('playoff_start_period_missing')
  if (!isPositiveInt(input.playoffStartPeriod) || input.playoffStartPeriod < 2 ||
      input.playoffStartPeriod > input.maxScheduledPeriod) {
    // A playoff starting at period 1 would leave no regular season to seed it.
    return refuse('playoff_start_period_out_of_range')
  }
  if (input.playoffTeams == null) return refuse('playoff_teams_missing')
  if (!isPositiveInt(input.playoffTeams)) return refuse('playoff_teams_out_of_range')
  if (input.weeksPerRound == null) return refuse('weeks_per_round_missing')
  if (!isPositiveInt(input.weeksPerRound) || input.weeksPerRound < 1) {
    return refuse('weeks_per_round_out_of_range')
  }
  if (input.leagueSize == null) return refuse('league_size_missing')
  if (!isPositiveInt(input.leagueSize) || input.leagueSize < 2) return refuse('league_size_out_of_range')

  if (input.providerPlayoffLimit != null) {
    if (!isPositiveInt(input.providerPlayoffLimit) || input.providerPlayoffLimit < 1) {
      return refuse('provider_playoff_limit_invalid')
    }
    if (input.playoffTeams > input.providerPlayoffLimit) {
      return refuse('playoff_teams_exceed_provider_limit')
    }
  }

  if (input.playoffTeams > input.leagueSize) return refuse('playoff_teams_exceed_league_size')

  const regularSeasonEndPeriod = input.playoffStartPeriod - 1
  const playoffRounds = bracketRounds(input.playoffTeams)
  const playoffWeeks = playoffRounds * input.weeksPerRound

  // 0 or 1 playoff team means no bracket at all: the season ends with the regular season.
  const lastPeriod = playoffWeeks === 0
    ? regularSeasonEndPeriod
    : input.playoffStartPeriod + playoffWeeks - 1

  if (lastPeriod > input.maxScheduledPeriod) return refuse('schedule_exceeds_period_bound')

  const periods: number[] = []
  for (let p = 1; p <= lastPeriod; p += 1) periods.push(p)

  const playoffPeriods = playoffWeeks === 0
    ? []
    : periods.filter(p => p >= input.playoffStartPeriod!)

  return {
    kind: 'schedule',
    periods,
    regularSeasonEndPeriod,
    playoffRounds,
    playoffPeriods,
    lastPeriod,
  }
}

export type PeriodAdvance =
  | { kind: 'period'; periodOrdinal: number }
  | { kind: 'no_period' }

/**
 * The immediate successor in the schedule.
 *
 * ⚠ NOT `current + 1`, and not "the next period that has evidence". This is the only place
 * advancement is computed; every caller uses this result rather than incrementing.
 */
export function nextScheduledPeriod(
  scheduled: readonly number[],
  current: number | null,
): PeriodAdvance {
  if (!scheduled.length) return { kind: 'no_period' }
  if (current == null) return { kind: 'period', periodOrdinal: scheduled[0] }
  const index = scheduled.indexOf(current)
  if (index < 0 || index === scheduled.length - 1) return { kind: 'no_period' }
  return { kind: 'period', periodOrdinal: scheduled[index + 1] }
}

/** Consecutive, ascending, starting at 1 — the invariant every lane range depends on. */
export function isConsecutiveSchedule(periods: readonly number[]): boolean {
  if (!periods.length) return false
  if (periods[0] !== 1) return false
  for (let i = 1; i < periods.length; i += 1) {
    if (periods[i] !== periods[i - 1] + 1) return false
  }
  return true
}

export type LookbackResolution =
  | { kind: 'lookback'; periods: readonly number[] }
  | { kind: 'refused'; reason: 'period_not_in_schedule' | 'lookback_invalid' | 'schedule_empty' }

/**
 * `current` plus its immediate scheduled PREDECESSORS, oldest first.
 *
 * ⚠ THIS REPLACES `week - 1, week - 2` ARITHMETIC. Counting backwards by one assumes every
 * integer below the current week is a period of this league's season. It is not: a schedule
 * ending at 16 makes "week 17 minus two" reach 15 and 16 and then claim 17 as a period that
 * does not exist, and a schedule whose first period is not 1 loses its floor entirely.
 *
 * Returns FEWER than `count` periods near the start of a season — that is the honest answer,
 * and the caller reports the shortfall rather than padding it.
 */
export function scheduledLookback(
  scheduled: readonly number[],
  current: number,
  count: number,
): LookbackResolution {
  if (!scheduled.length) return { kind: 'refused', reason: 'schedule_empty' }
  if (!Number.isInteger(count) || count < 1) return { kind: 'refused', reason: 'lookback_invalid' }
  const index = scheduled.indexOf(current)
  if (index < 0) return { kind: 'refused', reason: 'period_not_in_schedule' }
  const start = Math.max(0, index - (count - 1))
  return { kind: 'lookback', periods: scheduled.slice(start, index + 1) }
}
