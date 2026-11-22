/**
 * The calendar a planned Survivor season runs on. NFL weeks are pinned to the kickoffs measured in
 * production SportsGame (regular season, 2026): every first and last kickoff must land in its week.
 */
import { describe, expect, it } from 'vitest'
import { dailySportWeekForInstant, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { isSurvivorPlanSport, planRegularSeasonLastDay, planSeasonOpener, planWeekForInstant, planWeekWindow } from '@/lib/survivor/survivorPlanCalendar'
import { buildSurvivorFullSeasonPlan, readSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { doubleEliminationWeeks } from '@/lib/survivor/survivorEliminationSchedule'

/** [week, first kickoff, last kickoff], production SportsGame, measured 2026-10-22. */
const MEASURED_NFL_2026: Array<[number, string, string]> = [
  [1, '2026-09-10T00:20:00Z', '2026-09-15T00:15:00Z'], [2, '2026-09-18T00:15:00Z', '2026-09-22T00:15:00Z'],
  [3, '2026-09-25T00:15:00Z', '2026-09-29T00:15:00Z'], [4, '2026-10-02T00:15:00Z', '2026-10-06T00:15:00Z'],
  [5, '2026-10-09T00:15:00Z', '2026-10-13T00:15:00Z'], [6, '2026-10-16T00:15:00Z', '2026-10-20T00:15:00Z'],
  [7, '2026-10-23T00:15:00Z', '2026-10-27T00:15:00Z'], [8, '2026-10-30T00:15:00Z', '2026-11-03T01:15:00Z'],
  [9, '2026-11-06T01:15:00Z', '2026-11-10T01:15:00Z'], [10, '2026-11-13T01:15:00Z', '2026-11-17T01:15:00Z'],
  [11, '2026-11-20T01:15:00Z', '2026-11-24T01:15:00Z'], [12, '2026-11-26T01:00:00Z', '2026-12-01T01:15:00Z'],
  [13, '2026-12-04T01:15:00Z', '2026-12-08T01:15:00Z'], [14, '2026-12-11T01:15:00Z', '2026-12-15T01:15:00Z'],
  [15, '2026-12-18T01:15:00Z', '2026-12-22T01:15:00Z'], [16, '2026-12-25T01:15:00Z', '2026-12-29T01:15:00Z'],
  [17, '2027-01-01T01:15:00Z', '2027-01-05T01:15:00Z'], [18, '2027-01-10T00:00:00Z', '2027-01-11T02:00:00Z'],
]

describe('NFL plan calendar', () => {
  it('puts every measured 2026 kickoff in its own week, and the window agrees', () => {
    for (const [week, first, last] of MEASURED_NFL_2026) {
      expect(planWeekForInstant('NFL', 2026, new Date(first))).toBe(week)
      expect(planWeekForInstant('NFL', 2026, new Date(last))).toBe(week)
      const window = planWeekWindow('NFL', 2026, week)!
      expect(window.start.getTime()).toBeLessThanOrEqual(Date.parse(first))
      expect(window.end.getTime()).toBeGreaterThan(Date.parse(last))
    }
  })

  it('preseason is not a week, the last day is week 18, and an unverified season is unknown', () => {
    expect(planWeekForInstant('NFL', 2026, new Date('2026-08-13T23:00:00Z'))).toBeNull()
    expect(planWeekForInstant('NFL', 2026, new Date(`${planRegularSeasonLastDay('NFL', 2026)}T12:00:00Z`))).toBe(18)
    expect(planWeekWindow('NFL', 2026, 19)).toBeNull()
    expect(planWeekForInstant('NFL', 2027, new Date('2027-09-15T00:00:00Z'))).toBeNull()
    expect(planSeasonOpener('NFL', 2027)).toBeNull()
  })

  it('NBA and NHL still use the daily-sport calendar unchanged', () => {
    const instant = new Date('2026-12-01T12:00:00Z')
    for (const sport of ['NBA', 'NHL'] as const) {
      expect(planWeekForInstant(sport, 2026, instant)).toBe(dailySportWeekForInstant(sport, 2026, instant))
      expect(planWeekWindow(sport, 2026, 5)).toEqual(resolveDailySportWeekWindow(sport, 2026, 5))
    }
    expect(isSurvivorPlanSport('NFL')).toBe(true)
    expect(isSurvivorPlanSport('MLB')).toBe(true)
    expect(isSurvivorPlanSport('NCAAF')).toBe(false)
  })
})

describe('NFL planned season', () => {
  it('a full-season 24-player NFL cast fits weeks 1–18 with some double weeks', () => {
    const plan = buildSurvivorFullSeasonPlan({ sport: 'NFL', season: 2026, castSize: 24, now: new Date('2026-09-01T12:00:00Z'), exileEnabled: true, exileReturnWeek: 10 })
    expect([plan.startWeek, plan.endWeek]).toEqual([1, 18])
    expect(plan.eliminationWeeks).toHaveLength(22)
    expect(doubleEliminationWeeks(plan.eliminationWeeks).length).toBeGreaterThan(0)
    expect(readSurvivorFullSeasonPlan({ survivor_full_season_plan: plan })).toEqual(plan)
  })

  it('a league created in week 7 starts in week 8 and refuses a cast it cannot fit even at two per week', () => {
    const now = new Date('2026-10-22T12:00:00Z')
    const plan = buildSurvivorFullSeasonPlan({ sport: 'NFL', season: 2026, castSize: 16, now, exileEnabled: true, exileReturnWeek: 12 })
    expect(plan.startWeek).toBe(8)
    expect(plan.eliminationWeeks.every(w => w > 8 && w < 18)).toBe(true)
    expect(() => buildSurvivorFullSeasonPlan({ sport: 'NFL', season: 2026, castSize: 24, now })).toThrow('Not enough season remains')
  })
})

describe('Exile return week default', () => {
  it('keeps week 10 when it fits, and moves to the middle of what remains when it does not', async () => {
    const { defaultExileReturnWeek } = await import('@/lib/survivor/survivorFullSeasonPlan')
    expect(defaultExileReturnWeek(1, 18)).toBe(10)
    expect(defaultExileReturnWeek(11, 18)).toBe(15)
    // A November NFL league: week 10 has passed, so the plan no longer refuses a default nobody chose.
    const plan = buildSurvivorFullSeasonPlan({ sport: 'NFL', season: 2026, castSize: 12, now: new Date('2026-11-15T12:00:00Z'), exileEnabled: true })
    expect(plan.exileReturnWeek).toBeGreaterThan(plan.startWeek)
    expect(plan.exileReturnWeek).toBeLessThan(plan.endWeek - 1)
  })

  it('still refuses a return week the commissioner chose that has already passed', () => {
    expect(() => buildSurvivorFullSeasonPlan({ sport: 'NFL', season: 2026, castSize: 12, now: new Date('2026-11-15T12:00:00Z'), exileEnabled: true, exileReturnWeek: 10 }))
      .toThrow('Exile return week must follow the opening week')
  })
})

describe('MLB planned season', () => {
  it('uses the daily-sport calendar from Opening Night to the published last day', () => {
    const instant = new Date('2027-05-01T12:00:00Z')
    expect(planWeekForInstant('MLB', 2027, instant)).toBe(dailySportWeekForInstant('MLB', 2027, instant))
    expect(planWeekWindow('MLB', 2027, 5)).toEqual(resolveDailySportWeekWindow('MLB', 2027, 5))
    expect(planSeasonOpener('MLB', 2027)).toBe('2027-03-24T00:00:00.000Z')
    expect(planRegularSeasonLastDay('MLB', 2027)).toBe('2027-09-26')
    expect(planRegularSeasonLastDay('MLB', 2028)).toBeNull()
  })

  it('a 20-manager MLB cast drafted before Opening Night fits the 2027 season', () => {
    const plan = buildSurvivorFullSeasonPlan({ sport: 'MLB', season: 2027, castSize: 20, now: new Date('2027-03-10T12:00:00Z'), exileEnabled: true })
    expect(plan.sport).toBe('MLB')
    expect(plan.startWeek).toBe(1)
    expect(plan.eliminationWeeks.length).toBeGreaterThan(0)
    expect(plan.endWeek).toBe(planWeekForInstant('MLB', 2027, new Date('2027-09-26T16:00:00Z')))
    expect(readSurvivorFullSeasonPlan({ survivor_full_season_plan: plan })).toEqual(plan)
  })

  it('an unverified MLB season is refused rather than guessed', () => {
    expect(() => buildSurvivorFullSeasonPlan({ sport: 'MLB', season: 2028, castSize: 20, now: new Date('2028-03-01T12:00:00Z') })).toThrow('has not been verified')
  })
})
