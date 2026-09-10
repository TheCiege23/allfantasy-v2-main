import { describe, expect, it } from 'vitest'
import {
  bracketRounds,
  isConsecutiveSchedule,
  nextScheduledPeriod,
  resolveScheduledPeriods,
  type ScheduleInput,
} from '@/lib/decision-os/value-v2/periodCalendar'

const SCHEMA_BOUND = 25

const base: ScheduleInput = {
  playoffStartPeriod: 15,
  playoffTeams: 4,
  weeksPerRound: 1,
  leagueSize: 12,
  maxScheduledPeriod: SCHEMA_BOUND,
}

const input = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({ ...base, ...over })

const scheduleOf = (over: Partial<ScheduleInput> = {}) => {
  const r = resolveScheduledPeriods(input(over))
  if (r.kind !== 'schedule') throw new Error(`expected a schedule, got refusal ${r.reason}`)
  return r
}

const refusalOf = (over: Partial<ScheduleInput> = {}) => {
  const r = resolveScheduledPeriods(input(over))
  if (r.kind !== 'refused') throw new Error('expected a refusal, got a schedule')
  return r.reason
}

describe('bracketRounds handles byes without floating point', () => {
  it.each([
    [0, 0], [1, 0], [2, 1], [3, 2], [4, 2], [5, 3], [6, 3], [7, 3], [8, 3],
    [9, 4], [12, 4], [16, 4], [17, 5], [32, 5], [64, 6],
  ])('%i teams -> %i rounds', (teams, rounds) => {
    expect(bracketRounds(teams)).toBe(rounds)
  })

  it('gives a six-team field three rounds, not two', () => {
    // Two first-round games while the top two seeds idle, then semis, then the final.
    expect(bracketRounds(6)).toBe(3)
  })

  it('is exact at large powers of two, where Math.ceil(Math.log2(n)) is not reliable', () => {
    expect(bracketRounds(2 ** 29)).toBe(29)
    expect(bracketRounds(2 ** 29 + 1)).toBe(30)
  })
})

describe('playoff field sizes', () => {
  it.each([
    [1, 14], [2, 15], [4, 16], [6, 17], [7, 17], [8, 17], [12, 18], [16, 18],
  ])('%i playoff teams ends the schedule at period %i', (playoffTeams, lastPeriod) => {
    const s = scheduleOf({ playoffTeams, leagueSize: Math.max(12, playoffTeams) })
    expect(s.lastPeriod).toBe(lastPeriod)
    expect(s.periods[s.periods.length - 1]).toBe(lastPeriod)
  })

  it('supports a 32-team bracket when league size, provider policy and the bound permit it', () => {
    const s = scheduleOf({ playoffTeams: 32, leagueSize: 32, playoffStartPeriod: 15, maxScheduledPeriod: 25 })
    expect(s.playoffRounds).toBe(5)
    expect(s.lastPeriod).toBe(19)
    expect(s.playoffPeriods).toEqual([15, 16, 17, 18, 19])
  })

  it('treats zero and one playoff teams as no bracket at all', () => {
    for (const playoffTeams of [0, 1]) {
      const s = scheduleOf({ playoffTeams })
      expect(s.playoffRounds).toBe(0)
      expect(s.playoffPeriods).toEqual([])
      expect(s.lastPeriod).toBe(14) // regular season end
    }
  })

  it('multiplies rounds by weeks per round', () => {
    expect(scheduleOf({ playoffTeams: 4, weeksPerRound: 2 }).lastPeriod).toBe(18) // 2 rounds x 2
    expect(scheduleOf({ playoffTeams: 6, weeksPerRound: 2, maxScheduledPeriod: 25 }).lastPeriod).toBe(20)
  })
})

describe('bounds', () => {
  it('refuses a playoff field larger than the league', () => {
    expect(refusalOf({ playoffTeams: 14, leagueSize: 12 })).toBe('playoff_teams_exceed_league_size')
  })

  it('enforces a provider limit only when one is supplied', () => {
    expect(refusalOf({ playoffTeams: 12, providerPlayoffLimit: 8 }))
      .toBe('playoff_teams_exceed_provider_limit')
    expect(scheduleOf({ playoffTeams: 12, providerPlayoffLimit: 12 }).playoffRounds).toBe(4)
  })

  it('does NOT substitute the simulation endpoint max(16) when no provider limit is given', () => {
    // A 32-team field with no stated provider limit resolves. Borrowing simulateApiCore's
    // request-validation bound here would silently cap a real league at a limit no provider
    // ever stated.
    const s = scheduleOf({ playoffTeams: 32, leagueSize: 32, providerPlayoffLimit: undefined })
    expect(s.playoffRounds).toBe(5)
    expect(scheduleOf({ playoffTeams: 32, leagueSize: 32, providerPlayoffLimit: null }).playoffRounds).toBe(5)
  })

  it('refuses an invalid provider limit rather than ignoring it', () => {
    expect(refusalOf({ providerPlayoffLimit: 0 })).toBe('provider_playoff_limit_invalid')
    expect(refusalOf({ providerPlayoffLimit: 4.5 })).toBe('provider_playoff_limit_invalid')
  })

  it('refuses a schedule that would exceed the schema period bound', () => {
    expect(refusalOf({ playoffTeams: 32, leagueSize: 32, playoffStartPeriod: 22, maxScheduledPeriod: 25 }))
      .toBe('schedule_exceeds_period_bound')
  })

  it('refuses an invalid schema bound', () => {
    expect(refusalOf({ maxScheduledPeriod: 0 })).toBe('max_scheduled_period_invalid')
  })
})

describe('missing and malformed settings are named, never guessed', () => {
  it.each([
    [{ playoffStartPeriod: null }, 'playoff_start_period_missing'],
    [{ playoffStartPeriod: 1 }, 'playoff_start_period_out_of_range'],
    [{ playoffStartPeriod: 14.5 }, 'playoff_start_period_out_of_range'],
    [{ playoffStartPeriod: 99 }, 'playoff_start_period_out_of_range'],
    [{ playoffTeams: null }, 'playoff_teams_missing'],
    [{ playoffTeams: -1 }, 'playoff_teams_out_of_range'],
    [{ playoffTeams: 4.5 }, 'playoff_teams_out_of_range'],
    [{ weeksPerRound: null }, 'weeks_per_round_missing'],
    [{ weeksPerRound: 0 }, 'weeks_per_round_out_of_range'],
    [{ weeksPerRound: 1.5 }, 'weeks_per_round_out_of_range'],
    [{ leagueSize: null }, 'league_size_missing'],
    [{ leagueSize: 1 }, 'league_size_out_of_range'],
  ])('%o -> %s', (over, reason) => {
    expect(refusalOf(over as Partial<ScheduleInput>)).toBe(reason)
  })
})

describe('generated periods', () => {
  it('are consecutive and start at 1', () => {
    const s = scheduleOf({ playoffTeams: 6 })
    expect(s.periods[0]).toBe(1)
    expect(isConsecutiveSchedule(s.periods)).toBe(true)
    expect(s.periods.length).toBe(s.lastPeriod)
  })

  it('ends before NFL week 18 when the league schedule does', () => {
    const s = scheduleOf({ playoffStartPeriod: 15, playoffTeams: 4, weeksPerRound: 1 })
    expect(s.lastPeriod).toBe(16)
    expect(s.periods).not.toContain(17)
    expect(s.periods).not.toContain(18)
  })

  it('rejects a non-consecutive list', () => {
    expect(isConsecutiveSchedule([1, 2, 4])).toBe(false)
    expect(isConsecutiveSchedule([2, 3, 4])).toBe(false)  // must start at 1
    expect(isConsecutiveSchedule([])).toBe(false)
  })
})

describe('advancement uses the immediate scheduled successor', () => {
  const periods = scheduleOf({ playoffTeams: 6 }).periods // 1..17

  it('starts at the first period when there is no current', () => {
    expect(nextScheduledPeriod(periods, null)).toEqual({ kind: 'period', periodOrdinal: 1 })
  })

  it('advances one scheduled step at a time', () => {
    expect(nextScheduledPeriod(periods, 4)).toEqual({ kind: 'period', periodOrdinal: 5 })
    expect(nextScheduledPeriod(periods, 16)).toEqual({ kind: 'period', periodOrdinal: 17 })
  })

  it('exhausts at the final scheduled period', () => {
    expect(nextScheduledPeriod(periods, 17)).toEqual({ kind: 'no_period' })
  })

  it('does not skip a period that lacks evidence', () => {
    // Weeks 5 and 6 having no matchups changes nothing here: the calendar is the schedule.
    expect(nextScheduledPeriod(periods, 4)).toEqual({ kind: 'period', periodOrdinal: 5 })
  })

  it('refuses to advance from a period outside the schedule', () => {
    expect(nextScheduledPeriod(periods, 99)).toEqual({ kind: 'no_period' })
  })

  it('returns no_period for an empty schedule', () => {
    expect(nextScheduledPeriod([], null)).toEqual({ kind: 'no_period' })
  })
})
