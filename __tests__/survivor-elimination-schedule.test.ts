/**
 * The elimination schedule of a planned Survivor season: one vote per period while the season is
 * long enough, two in some periods when it is not, never three, and the same answer from the plan
 * builder, the plan reader and the settings route.
 */
import { describe, expect, it } from 'vitest'
import {
  SURVIVOR_MAX_ELIMINATIONS_PER_WEEK,
  describeEliminationSchedule,
  distinctEliminationWeeks,
  doubleEliminationWeeks,
  eliminationsInWeek,
  noEliminationWeeksFor,
  spreadEliminationWeeks,
  weekCouncilState,
} from '@/lib/survivor/survivorEliminationSchedule'
import { buildSurvivorFullSeasonPlan, readSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'

/** What the plan builder produced before double weeks existed. */
const legacySpread = (start: number, end: number, required: number) => {
  const available = end - start - 1
  return Array.from({ length: required }, (_, index) => start + Math.ceil((index + 1) * available / required))
}

describe('spreadEliminationWeeks', () => {
  it('reproduces the old one-per-period schedule exactly whenever it fits', () => {
    for (let start = 1; start <= 6; start++) {
      for (let end = start + 3; end <= start + 26; end++) {
        for (let required = 1; required <= end - start - 1; required++) {
          expect(spreadEliminationWeeks(start, end, required)).toEqual(legacySpread(start, end, required))
        }
      }
    }
  })

  it('doubles some periods when votes outnumber periods, spaced across the season', () => {
    // NFL-shaped: weeks 1–18, opening week 1, finale week 18, 21 votes for a 24-player cast.
    const weeks = spreadEliminationWeeks(1, 18, 21)!
    expect(weeks).toHaveLength(21)
    expect(distinctEliminationWeeks(weeks)).toEqual(Array.from({ length: 16 }, (_, i) => i + 2))
    expect(doubleEliminationWeeks(weeks)).toHaveLength(5)
    expect(weeks).toEqual([...weeks].sort((a, b) => a - b))
    // Spread, not bunched at one end: no two double weeks are adjacent with 16 periods and 5 doubles.
    const doubles = doubleEliminationWeeks(weeks)
    for (let i = 1; i < doubles.length; i++) expect(doubles[i]! - doubles[i - 1]!).toBeGreaterThan(1)
  })

  it('never schedules more than two in a period, and refuses what cannot fit', () => {
    for (let required = 1; required <= 32; required++) {
      const weeks = spreadEliminationWeeks(1, 18, required)
      if (required > 16 * SURVIVOR_MAX_ELIMINATIONS_PER_WEEK) expect(weeks).toBeNull()
      else for (const w of weeks!) expect(eliminationsInWeek(weeks!, w)).toBeLessThanOrEqual(2)
    }
    expect(spreadEliminationWeeks(1, 18, 33)).toBeNull()
    expect(spreadEliminationWeeks(1, 2, 1)).toBeNull()
    expect(spreadEliminationWeeks(1, 18, 0)).toEqual([])
  })

  it('lists rest periods once, ignoring how many votes a period holds', () => {
    expect(noEliminationWeeksFor(1, 6, [2, 3, 3, 5])).toEqual([1, 4])
  })
})

describe('weekCouncilState', () => {
  it('opens councils one at a time until the week is paid', () => {
    expect(weekCouncilState({ planned: 2, eliminated: 0, skipped: false, opened: 0 })).toEqual({ done: false, canOpenNext: true, nextOrdinal: 1 })
    // First council open, not yet resolved: the second must wait.
    expect(weekCouncilState({ planned: 2, eliminated: 0, skipped: false, opened: 1 }).canOpenNext).toBe(false)
    expect(weekCouncilState({ planned: 2, eliminated: 1, skipped: false, opened: 1 })).toEqual({ done: false, canOpenNext: true, nextOrdinal: 2 })
    expect(weekCouncilState({ planned: 2, eliminated: 2, skipped: false, opened: 2 })).toMatchObject({ done: true, canOpenNext: false })
    expect(weekCouncilState({ planned: 1, eliminated: 1, skipped: false, opened: 1 })).toMatchObject({ done: true, canOpenNext: false })
  })

  it('treats the final-three skip as paying the rest of the week', () => {
    expect(weekCouncilState({ planned: 2, eliminated: 1, skipped: true, opened: 1 })).toMatchObject({ done: true, canOpenNext: false })
  })
})

describe('describeEliminationSchedule', () => {
  it('names the double weeks only when there are any', () => {
    expect(describeEliminationSchedule([3, 5, 7])).toBe('3 votes across 3 elimination periods')
    expect(describeEliminationSchedule([3, 3, 5])).toBe('3 votes across 2 elimination periods; week 3 has two back-to-back votes')
    expect(describeEliminationSchedule([3, 3, 5, 7, 7, 9, 9])).toBe('7 votes across 4 elimination periods; weeks 3, 7 and 9 have two back-to-back votes')
  })
})

describe('planned season with double weeks', () => {
  const late = { sport: 'NBA' as const, season: 2026, castSize: 24, now: new Date('2027-01-10T12:00:00Z') }

  it('a late draft that used to be refused now builds, and the reader accepts it', () => {
    const plan = buildSurvivorFullSeasonPlan(late)
    expect(plan.eliminationWeeks).toHaveLength(plan.castSize - plan.finalistCount)
    expect(doubleEliminationWeeks(plan.eliminationWeeks).length).toBeGreaterThan(0)
    expect(readSurvivorFullSeasonPlan({ survivor_full_season_plan: plan })).toEqual(plan)
  })

  it('the reader rejects a period with three votes', () => {
    const plan = buildSurvivorFullSeasonPlan(late)
    const doubled = doubleEliminationWeeks(plan.eliminationWeeks)[0]!
    const single = distinctEliminationWeeks(plan.eliminationWeeks).find(w => eliminationsInWeek(plan.eliminationWeeks, w) === 1)!
    const tripled = [...plan.eliminationWeeks]
    tripled.splice(tripled.indexOf(single), 1, doubled)
    tripled.sort((a, b) => a - b)
    expect(readSurvivorFullSeasonPlan({ survivor_full_season_plan: { ...plan, eliminationWeeks: tripled, noEliminationWeeks: noEliminationWeeksFor(plan.startWeek, plan.endWeek, tripled) } })).toBeNull()
  })
})
