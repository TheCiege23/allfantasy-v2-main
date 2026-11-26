/**
 * Repeating chop weeks and the season preview (owner's request, 2026-11-25): "every odd week", "every week
 * starting week 10", "a double chop on week 13" are set once and the rules page shows the season they make
 * before it is saved.
 *
 * A pattern is not a new engine rule: it fills exact-week overrides, which `scheduledChops` already reads. The
 * preview is `guillotineCalendarFit`'s own walk, week by week, so the strip and the save's refusal cannot disagree.
 */
import { describe, expect, it } from 'vitest'
import { applyChopPattern, chopPatternWeeks, describeWeeks } from '@/lib/guillotine/chopPatterns'
import { DEFAULT_ADVANCED, normalizeAdvanced, scheduledChops, type GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'
import { guillotineCalendarFit, guillotineSeasonPreview } from '@/lib/guillotine/calendarFit'

describe('which weeks a pattern names', () => {
  it('every week, every other week (counted from the first week), odd weeks, even weeks', () => {
    expect(chopPatternWeeks({ kind: 'every_week', fromWeek: 10, toWeek: 13 })).toEqual([10, 11, 12, 13])
    expect(chopPatternWeeks({ kind: 'every_other_week', fromWeek: 4, toWeek: 11 })).toEqual([4, 6, 8, 10])
    expect(chopPatternWeeks({ kind: 'every_other_week', fromWeek: 5, toWeek: 11 })).toEqual([5, 7, 9, 11])
    expect(chopPatternWeeks({ kind: 'odd_weeks', fromWeek: 4, toWeek: 11 })).toEqual([5, 7, 9, 11])
    expect(chopPatternWeeks({ kind: 'even_weeks', fromWeek: 4, toWeek: 11 })).toEqual([4, 6, 8, 10])
  })

  it('an empty or backwards range names no week', () => {
    expect(chopPatternWeeks({ kind: 'every_week', fromWeek: 9, toWeek: 8 })).toEqual([])
    expect(chopPatternWeeks({ kind: 'odd_weeks', fromWeek: 6, toWeek: 6 })).toEqual([])
  })

  it('🛑 in a two-week-period league only a period’s last week can chop, so only those are named', () => {
    // Periods from week 1: (1,2) (3,4) (5,6) (7,8). Their last weeks are the even ones.
    expect(chopPatternWeeks({ kind: 'every_week', fromWeek: 1, toWeek: 8 }, { startWeek: 1, periodWeeks: 2 })).toEqual([2, 4, 6, 8])
    expect(chopPatternWeeks({ kind: 'odd_weeks', fromWeek: 1, toWeek: 8 }, { startWeek: 1, periodWeeks: 2 })).toEqual([])
    // [control] with one-week periods the same pattern names every odd week.
    expect(chopPatternWeeks({ kind: 'odd_weeks', fromWeek: 1, toWeek: 8 }, { startWeek: 1, periodWeeks: 1 })).toEqual([1, 3, 5, 7])
  })

  it('reads as words', () => {
    expect(describeWeeks([])).toBe('No weeks')
    expect(describeWeeks([13])).toBe('Week 13')
    expect(describeWeeks([5, 7])).toBe('Weeks 5 and 7')
    expect(describeWeeks([5, 7, 9])).toBe('Weeks 5, 7 and 9')
  })
})

describe('a pattern is written as special weeks the engine already runs', () => {
  const base: GuillotineAdvanced = { ...DEFAULT_ADVANCED, steps: [{ fromWeek: 12, chops: 2 }], overrides: { 6: 0 }, immunity: 'top_scorer' }

  it('🛑 "a double chop every odd week from 5 to 11" makes the engine chop two in exactly those weeks', () => {
    const weeks = chopPatternWeeks({ kind: 'odd_weeks', fromWeek: 5, toWeek: 11 })
    const next = applyChopPattern(DEFAULT_ADVANCED, weeks, 2)
    expect([4, 5, 6, 7, 8, 9, 10, 11, 12].map((w) => scheduledChops(next, w, 1))).toEqual([1, 2, 1, 2, 1, 2, 1, 2, 1])
    // What is saved is what the save accepts.
    expect(normalizeAdvanced(next)).toEqual({ ok: true, value: next })
  })

  it('leaves the steps, the other special weeks and immunity alone, and does not change its input', () => {
    const next = applyChopPattern(base, [7, 9], 3)
    expect(next.overrides).toEqual({ 6: 0, 7: 3, 9: 3 })
    expect(next.steps).toEqual(base.steps)
    expect(next.immunity).toBe('top_scorer')
    expect(base.overrides).toEqual({ 6: 0 })
  })

  it('a later pattern on the same week wins, "no chop" is 0, and the count is kept in the engine’s range', () => {
    expect(applyChopPattern(applyChopPattern(DEFAULT_ADVANCED, [7], 2), [7], 0).overrides).toEqual({ 7: 0 })
    expect(applyChopPattern(DEFAULT_ADVANCED, [7], 99).overrides).toEqual({ 7: 4 })
    expect(applyChopPattern(DEFAULT_ADVANCED, [7], -3).overrides).toEqual({ 7: 0 })
  })
})

describe('the season preview is the calendar check, week by week', () => {
  const input = (over: Partial<Parameters<typeof guillotineCalendarFit>[0]> = {}) => ({
    teamCount: 12,
    startWeek: 1,
    endWeek: 18,
    baseChops: 1,
    advanced: DEFAULT_ADVANCED,
    threshold: 1,
    finalPeriods: 0,
    ...over,
  })

  it('one chop a week: 12 teams are down to the last one in week 11, and the strip stops there', () => {
    const { weeks, fit } = guillotineSeasonPreview(input())
    expect(weeks.map((w) => w.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(weeks.every((w) => w.kind === 'chop' && w.chops === 1)).toBe(true)
    expect(weeks.map((w) => w.aliveAfter)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(fit).toEqual(guillotineCalendarFit(input()))
    expect(fit).toMatchObject({ fits: true, lastChopWeek: 11, finishWeek: 11 })
  })

  it('a double chop, a holiday week and a later step show in their weeks', () => {
    const advanced: GuillotineAdvanced = { ...DEFAULT_ADVANCED, steps: [{ fromWeek: 6, chops: 2 }], overrides: { 2: 0, 4: 3 } }
    const { weeks } = guillotineSeasonPreview(input({ advanced }))
    expect(weeks.map((w) => [w.week, w.kind, w.chops, w.aliveAfter])).toEqual([
      [1, 'chop', 1, 11],
      [2, 'no_chop', 0, 11],
      [3, 'chop', 1, 10],
      [4, 'chop', 3, 7],
      [5, 'chop', 1, 6],
      [6, 'chop', 2, 4],
      [7, 'chop', 2, 2],
      // Never below the endgame's size: the step calls for two, one is left to chop.
      [8, 'chop', 1, 1],
    ])
  })

  it('a Final Four stops chopping at four and plays its three weeks', () => {
    const { weeks, fit } = guillotineSeasonPreview(input({ teamCount: 8, threshold: 4, finalPeriods: 3 }))
    expect(weeks.map((w) => [w.week, w.kind, w.aliveAfter])).toEqual([[1, 'chop', 7], [2, 'chop', 6], [3, 'chop', 5], [4, 'chop', 4], [5, 'final', 4], [6, 'final', 4], [7, 'final', 4]])
    expect(fit).toMatchObject({ fits: true, lastChopWeek: 4, finishWeek: 7 })
  })

  it('🛑 a schedule that cannot finish runs to the last week with teams still alive, and says it does not fit', () => {
    const { weeks, fit } = guillotineSeasonPreview(input({ teamCount: 20, endWeek: 10 }))
    expect(weeks.length).toBe(10)
    expect(weeks[weeks.length - 1]).toMatchObject({ week: 10, aliveAfter: 10 })
    expect(fit).toMatchObject({ fits: false, survivorsAtEnd: 10 })
  })

  it('two-week periods: the first week of each period waits, the second chops', () => {
    const { weeks, fit } = guillotineSeasonPreview(input({ teamCount: 3, periodWeeks: 2 }))
    expect(weeks.map((w) => [w.week, w.kind, w.aliveAfter])).toEqual([[1, 'waiting', 3], [2, 'chop', 2], [3, 'waiting', 2], [4, 'chop', 1]])
    expect(fit).toEqual(guillotineCalendarFit(input({ teamCount: 3, periodWeeks: 2 })))
  })

  it('the strip and the check agree on every schedule tried here', () => {
    const schedules: GuillotineAdvanced[] = [
      DEFAULT_ADVANCED,
      { ...DEFAULT_ADVANCED, steps: [{ fromWeek: 9, chops: 2 }] },
      { ...DEFAULT_ADVANCED, overrides: { 3: 0, 5: 0, 7: 4 } },
      applyChopPattern(DEFAULT_ADVANCED, chopPatternWeeks({ kind: 'every_other_week', fromWeek: 2, toWeek: 16 }), 2),
    ]
    for (const advanced of schedules) {
      for (const teamCount of [4, 12, 18, 27]) {
        for (const [threshold, finalPeriods] of [[1, 0], [4, 3]] as const) {
          const i = input({ advanced, teamCount, threshold, finalPeriods })
          const { weeks, fit } = guillotineSeasonPreview(i)
          expect(fit).toEqual(guillotineCalendarFit(i))
          const chopWeeks = weeks.filter((w) => w.kind === 'chop')
          expect(chopWeeks.length ? chopWeeks[chopWeeks.length - 1]!.week : null).toBe(fit.lastChopWeek)
          expect(weeks.length ? weeks[weeks.length - 1]!.aliveAfter : teamCount).toBe(fit.survivorsAtEnd)
        }
      }
    }
  })
})
