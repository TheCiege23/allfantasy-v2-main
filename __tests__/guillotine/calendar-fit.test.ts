/**
 * A Guilly calendar must reach a champion (lib/guillotine/calendarFit.ts). Creation used one chop a week
 * through the sport's last week whatever the team count, so an NFL league of 20+ ended with several
 * teams alive; nothing in the editors checked either.
 */
import { describe, expect, it } from 'vitest'
import { calendarFitMessage, guillotineCalendarFit, planGuillotineChopSchedule } from '@/lib/guillotine/calendarFit'

const NONE = { steps: [], overrides: {}, immunity: 'off' as const }
const nfl = (teamCount: number, over: Partial<Parameters<typeof guillotineCalendarFit>[0]> = {}) => ({
  teamCount, startWeek: 1, endWeek: 18, baseChops: 1, advanced: NONE, threshold: 1, finalPeriods: 0, ...over,
})

describe('does the calendar reach a champion', () => {
  it('19 NFL teams on single chops finish in week 18; 20 do not', () => {
    expect(guillotineCalendarFit(nfl(19))).toMatchObject({ fits: true, lastChopWeek: 18, finishWeek: 18 })
    const twenty = guillotineCalendarFit(nfl(20))
    expect(twenty).toMatchObject({ fits: false, survivorsAtEnd: 2 })
    expect(calendarFitMessage(nfl(20), twenty)).toMatch(/still has 2 alive after week 18/)
  })

  it('a Final Four needs three weeks after the last chop', () => {
    // 16 teams -> 12 chops to reach four; last chop week 12, final weeks 13-15.
    expect(guillotineCalendarFit(nfl(16, { threshold: 4, finalPeriods: 3 }))).toMatchObject({ fits: true, lastChopWeek: 12, finishWeek: 15 })
    // 20 teams -> 16 chops, last chop week 16, final would end week 19.
    const late = guillotineCalendarFit(nfl(20, { threshold: 4, finalPeriods: 3 }))
    expect(late).toMatchObject({ fits: false, finishWeek: 19 })
    expect(calendarFitMessage(nfl(20, { threshold: 4, finalPeriods: 3 }), late)).toMatch(/runs past week 18/)
  })

  it('honours double-chop steps, overrides and holidays the way the engine does', () => {
    const doubled = { steps: [{ fromWeek: 1, chops: 2 }, { fromWeek: 3, chops: 1 }], overrides: {}, immunity: 'off' as const }
    expect(guillotineCalendarFit(nfl(21, { advanced: doubled })).fits).toBe(true)
    const holiday = { steps: [], overrides: { 10: 0 }, immunity: 'off' as const }
    expect(guillotineCalendarFit(nfl(19, { advanced: holiday })).fits).toBe(false)
  })
})

describe('planning the schedule at creation', () => {
  it('keeps the default when it already fits', () => {
    expect(planGuillotineChopSchedule(nfl(12))).toEqual(NONE)
  })

  it('adds the fewest opening double-chop weeks that make it fit', () => {
    const planned = planGuillotineChopSchedule(nfl(24))!
    expect(planned.steps).toEqual([{ fromWeek: 1, chops: 2 }, { fromWeek: 6, chops: 1 }])
    expect(guillotineCalendarFit(nfl(24, { advanced: planned })).fits).toBe(true)
    // One fewer double week would leave a survivor too many.
    const short = { ...planned, steps: [{ fromWeek: 1, chops: 2 }, { fromWeek: 5, chops: 1 }] }
    expect(guillotineCalendarFit(nfl(24, { advanced: short })).fits).toBe(false)
  })

  it('fits every team count the limits allow, in every sport, for both endgames', () => {
    for (const endWeek of [18, 24, 26]) {
      for (let teams = 4; teams <= 35; teams += 1) {
        for (const [threshold, finalPeriods] of [[1, 0], [4, 3]]) {
          const input = nfl(teams, { endWeek, threshold, finalPeriods })
          const planned = planGuillotineChopSchedule(input)
          expect(planned, `${teams} teams / ${endWeek} weeks / final ${threshold}`).not.toBeNull()
          expect(guillotineCalendarFit({ ...input, advanced: planned! }).fits).toBe(true)
        }
      }
    }
  })

  it('returns null only when four chops every week cannot finish', () => {
    expect(planGuillotineChopSchedule(nfl(80))).toBeNull()
  })
})
