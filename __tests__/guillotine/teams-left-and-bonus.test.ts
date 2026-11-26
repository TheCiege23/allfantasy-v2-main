/**
 * Two of the owner's automations (2026-11-25):
 *   - chop rules that trigger "when N teams remain", not only "in week N" (lib/guillotine/chopSchedule.ts);
 *   - bonus FAAB for the week's top scorer (lib/guillotine/faabBonus.ts).
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_ADVANCED, describeSchedule, isDefault, normalizeAdvanced, readAdvanced, scheduledChops, type GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'
import { guillotineCalendarFit, guillotineSeasonPreview } from '@/lib/guillotine/calendarFit'
import { buildChopPreview } from '@/lib/guillotine/chopPreview'
import { topScorerBonus } from '@/lib/guillotine/faabBonus'

const adv = (over: Partial<GuillotineAdvanced> = {}): GuillotineAdvanced => ({ ...DEFAULT_ADVANCED, ...over })

describe('"when N teams remain"', () => {
  const twoUntilEight = adv({ steps: [{ fromWeek: 1, chops: 2 }], remaining: [{ teamsLeft: 8, chops: 1 }] })

  it('two a week while more than 8 are left, then one', () => {
    expect(scheduledChops(twoUntilEight, 3, 1, 12)).toBe(2)
    expect(scheduledChops(twoUntilEight, 3, 1, 9)).toBe(2)
    expect(scheduledChops(twoUntilEight, 3, 1, 8)).toBe(1)
    expect(scheduledChops(twoUntilEight, 3, 1, 4)).toBe(1)
  })

  it('the rule for the fewest teams that applies wins', () => {
    const a = adv({ remaining: [{ teamsLeft: 8, chops: 2 }, { teamsLeft: 3, chops: 0 }] })
    expect([scheduledChops(a, 9, 1, 10), scheduledChops(a, 9, 1, 8), scheduledChops(a, 9, 1, 3), scheduledChops(a, 9, 1, 2)]).toEqual([1, 2, 0, 0])
  })

  it('an exact-week override still wins over it', () => {
    const a = adv({ remaining: [{ teamsLeft: 8, chops: 1 }], overrides: { 10: 3 } })
    expect(scheduledChops(a, 10, 1, 6)).toBe(3)
  })

  it('[control] a caller that does not know the field size gets the week-only answer, as before', () => {
    expect(scheduledChops(twoUntilEight, 3, 1)).toBe(2)
  })

  it('the season preview and the calendar check walk the field down and switch at the right week', () => {
    const input = { teamCount: 12, startWeek: 1, endWeek: 17, baseChops: 1, advanced: twoUntilEight, threshold: 1, finalPeriods: 0 }
    const { weeks } = guillotineSeasonPreview(input)
    // 12 → 10 → 8 (two a week), then one a week from 8 left.
    expect(weeks.slice(0, 4).map((w) => [w.week, w.chops, w.aliveAfter])).toEqual([[1, 2, 10], [2, 2, 8], [3, 1, 7], [4, 1, 6]])
    expect(guillotineCalendarFit(input)).toMatchObject({ fits: true, lastChopWeek: 9 })
  })

  it('"no more chops once 3 are left" is a season that cannot finish, and the check says so', () => {
    const input = { teamCount: 12, startWeek: 1, endWeek: 17, baseChops: 1, advanced: adv({ remaining: [{ teamsLeft: 3, chops: 0 }] }), threshold: 1, finalPeriods: 0 }
    expect(guillotineCalendarFit(input)).toMatchObject({ fits: false, survivorsAtEnd: 3 })
  })

  it('the chop preview uses the teams alive now', () => {
    const teams = Array.from({ length: 6 }, (_, i) => ({ rosterId: `r${i}`, name: `T${i}`, periodPoints: 100 - i * 10, seasonPointsCumul: 100, faab: null, playerCount: 9 }))
    const p = buildChopPreview({
      week: 9, weekState: 'live', eliminationStartWeek: 1, eliminationEndWeek: 18, teamsPerChop: 1,
      advanced: adv({ remaining: [{ teamsLeft: 6, chops: 2 }] }),
      endgame: { format: 'last_team_standing', threshold: 1 }, tiebreakerOrder: ['season_points'], dangerMarginPoints: 10,
      faabOnChop: 'keep', rosterReleaseTiming: 'next_waiver_run', previousWeek: [], draftSlotByRoster: new Map(), blockers: [], teams,
    } as Parameters<typeof buildChopPreview>[0])
    expect(p.chopCount).toBe(2)
    expect(p.rows.filter((r) => r.status === 'chopped').map((r) => r.rosterId)).toEqual(['r5', 'r4'])
  })

  it('saved, read back and described', () => {
    const n = normalizeAdvanced({ remaining: [{ teamsLeft: 3, chops: 0 }, { teamsLeft: 8, chops: 1 }] })
    expect(n.ok && n.value.remaining).toEqual([{ teamsLeft: 8, chops: 1 }, { teamsLeft: 3, chops: 0 }])
    expect(describeSchedule(n.ok ? n.value : DEFAULT_ADVANCED, 2, 1)).toEqual([
      'From week 1: 2 teams a week.',
      'Once 8 teams are left: 1 team a week.',
      'Once 3 teams are left: no more chops.',
    ])
  })

  it.each([
    ['a teams-left of 1', [{ teamsLeft: 1, chops: 1 }]],
    ['two rules for one count', [{ teamsLeft: 6, chops: 1 }, { teamsLeft: 6, chops: 2 }]],
    ['five chops', [{ teamsLeft: 6, chops: 5 }]],
  ])('refuses %s', (_name, remaining) => {
    expect(normalizeAdvanced({ remaining })).toEqual({ ok: false, error: 'bad_remaining' })
  })
})

describe('bonus FAAB for the week’s top scorer', () => {
  it('the survivor with the top score gets it', () => {
    expect([...topScorerBonus(25, [{ rosterId: 'a', points: 110, faab: 40 }, { rosterId: 'b', points: 130, faab: 10 }])]).toEqual([['b', 25]])
  })

  it('a tie splits it in whole dollars, the leftover to the lower balance', () => {
    expect(Object.fromEntries(topScorerBonus(25, [{ rosterId: 'a', points: 130, faab: 40 }, { rosterId: 'b', points: 130, faab: 10 }]))).toEqual({ a: 12, b: 13 })
  })

  it('nothing when it is off, or nobody scored', () => {
    expect(topScorerBonus(0, [{ rosterId: 'a', points: 130, faab: 0 }]).size).toBe(0)
    expect(topScorerBonus(25, []).size).toBe(0)
  })

  it('saved, read back and described; and a schedule saved before it reads exactly as stored', () => {
    const n = normalizeAdvanced({ topScorerBonus: 20 })
    expect(n.ok && n.value.topScorerBonus).toBe(20)
    expect(describeSchedule(n.ok ? n.value : DEFAULT_ADVANCED, 1, 1)).toContain('After each chop, the week’s top scorer gets $20 more FAAB.')
    expect(isDefault(n.ok ? n.value : DEFAULT_ADVANCED)).toBe(false)
    const old = { steps: [{ fromWeek: 5, chops: 2 }], overrides: {}, immunity: 'off', faab: { mode: 'unchanged', amount: 0 } }
    expect(readAdvanced({ guillotine_advanced: old })).toEqual(old)
    expect(normalizeAdvanced({ topScorerBonus: -1 })).toEqual({ ok: false, error: 'bad_bonus' })
    expect(normalizeAdvanced({ topScorerBonus: 2.5 })).toEqual({ ok: false, error: 'bad_bonus' })
  })
})
