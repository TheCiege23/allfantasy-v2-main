import { describe, expect, it } from 'vitest'
import { applyImmunity, describeSchedule, immuneRosterIds, normalizeAdvanced, readAdvanced, scheduledChops, type GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'

const rules = (over: Partial<GuillotineAdvanced> = {}): GuillotineAdvanced => ({ steps: [], overrides: {}, immunity: 'off', ...over })

describe('scheduledChops', () => {
  const a = rules({ steps: [{ fromWeek: 10, chops: 2 }, { fromWeek: 14, chops: 3 }], overrides: { 8: 0, 12: 4 } })
  it('base, then each step from its week, with exact weeks winning', () => {
    expect([1, 7, 8, 9, 10, 12, 13, 14, 17].map((w) => scheduledChops(a, w, 1))).toEqual([1, 1, 0, 1, 2, 4, 2, 3, 3])
  })
  it('no rules = the league’s single teams-per-chop', () => {
    expect(scheduledChops(rules(), 5, 2)).toBe(2)
  })
})

describe('normalizeAdvanced — strict on input', () => {
  it('sorts steps and reads week keys', () => {
    const n = normalizeAdvanced({ steps: [{ fromWeek: 12, chops: 2 }, { fromWeek: 9, chops: 3 }], overrides: { '6': 0 }, immunity: 'top_scorer' })
    expect(n).toEqual({ ok: true, value: { steps: [{ fromWeek: 9, chops: 3 }, { fromWeek: 12, chops: 2 }], overrides: { 6: 0 }, immunity: 'top_scorer' } })
  })
  it('refuses bad rows rather than dropping them', () => {
    expect(normalizeAdvanced({ steps: [{ fromWeek: 0, chops: 1 }] })).toEqual({ ok: false, error: 'bad_step' })
    expect(normalizeAdvanced({ steps: [{ fromWeek: 5, chops: 0 }] })).toEqual({ ok: false, error: 'bad_step' })
    expect(normalizeAdvanced({ steps: [{ fromWeek: 5, chops: 1 }, { fromWeek: 5, chops: 2 }] })).toEqual({ ok: false, error: 'duplicate_step' })
    expect(normalizeAdvanced({ overrides: { 3: 9 } })).toEqual({ ok: false, error: 'bad_override' })
    expect(normalizeAdvanced({ immunity: 'everyone' })).toEqual({ ok: false, error: 'bad_immunity' })
  })
  it('anything unreadable in storage reads as the default, never a broken chop', () => {
    expect(readAdvanced({ guillotine_advanced: { steps: 'nope', immunity: 'x' } })).toEqual(rules())
    expect(readAdvanced(null)).toEqual(rules())
  })
})

describe('immunity', () => {
  const prev = [{ rosterId: 'a', periodPoints: 140 }, { rosterId: 'b', periodPoints: 140 }, { rosterId: 'c', periodPoints: 90 }, { rosterId: 'gone', periodPoints: 200 }]
  it('last week’s top scorer among teams still alive; ties share it', () => {
    expect(immuneRosterIds(rules({ immunity: 'top_scorer' }), prev, ['a', 'b', 'c'])).toEqual(['a', 'b'])
    expect(immuneRosterIds(rules(), prev, ['a', 'b', 'c'])).toEqual([])
    expect(immuneRosterIds(rules({ immunity: 'top_scorer' }), [], ['a'])).toEqual([])
  })
  it('never at the cost of the chop', () => {
    const c = [{ rosterId: 'a' }, { rosterId: 'b' }, { rosterId: 'c' }]
    expect(applyImmunity(c, ['a'], 1)).toEqual({ candidates: [{ rosterId: 'b' }, { rosterId: 'c' }], protectedIds: ['a'] })
    expect(applyImmunity(c, ['a', 'b'], 2)).toEqual({ candidates: c, protectedIds: [] })
  })
})

describe('describeSchedule', () => {
  it('reads like the rules card', () => {
    expect(describeSchedule(rules({ steps: [{ fromWeek: 10, chops: 2 }], overrides: { 8: 0, 15: 2 }, immunity: 'top_scorer' }), 1, 1)).toEqual([
      'From week 1: 1 team a week.',
      'From week 10: 2 teams a week.',
      'Week 8: no chop.',
      'Week 15: 2 teams chopped.',
      'Each week’s top scorer cannot be chopped the next week.',
    ])
  })
})
