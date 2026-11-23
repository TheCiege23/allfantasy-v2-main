import { describe, expect, it } from 'vitest'
import { applyImmunity, describeSchedule, faabAfterChop, immuneRosterIds, isDefault, normalizeAdvanced, readAdvanced, scheduledChops, type GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'

const rules = (over: Partial<GuillotineAdvanced> = {}): GuillotineAdvanced => ({ steps: [], overrides: {}, immunity: 'off', faab: { mode: 'unchanged', amount: 0 }, ...over })

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
    expect(n).toEqual({ ok: true, value: { steps: [{ fromWeek: 9, chops: 3 }, { fromWeek: 12, chops: 2 }], overrides: { 6: 0 }, immunity: 'top_scorer', faab: { mode: 'unchanged', amount: 0 } } })
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

  describe('FAAB after a chop', () => {
    it('reads a rule saved before FAAB existed as unchanged, and accepts top-up and reset', () => {
      expect(normalizeAdvanced({ immunity: 'off' })).toMatchObject({ ok: true, value: { faab: { mode: 'unchanged', amount: 0 } } })
      expect(normalizeAdvanced({ faab: { mode: 'add', amount: 50 } })).toMatchObject({ ok: true, value: { faab: { mode: 'add', amount: 50 } } })
      expect(normalizeAdvanced({ faab: { mode: 'set', amount: 0 } })).toMatchObject({ ok: true, value: { faab: { mode: 'set', amount: 0 } } })
      expect(normalizeAdvanced({ faab: { mode: 'unchanged', amount: 999 } })).toMatchObject({ ok: true, value: { faab: { mode: 'unchanged', amount: 0 } } })
    })
    it('refuses a bad mode, a $0 top-up, fractions and amounts over the cap', () => {
      for (const faab of [{ mode: 'double', amount: 5 }, { mode: 'add', amount: 0 }, { mode: 'set', amount: 2.5 }, { mode: 'set', amount: 10_001 }, { mode: 'add', amount: '5' }, 'add']) {
        expect(normalizeAdvanced({ faab })).toEqual({ ok: false, error: 'bad_faab' })
      }
    })
    it('a FAAB rule alone is not the default season', () => {
      expect(isDefault(rules({ faab: { mode: 'add', amount: 10 } }))).toBe(false)
      expect(isDefault(rules())).toBe(true)
    })
    it('tops up from the current balance (none counts as $0) or resets to the amount', () => {
      expect(faabAfterChop({ mode: 'add', amount: 25 }, 40)).toBe(65)
      expect(faabAfterChop({ mode: 'add', amount: 25 }, null)).toBe(25)
      expect(faabAfterChop({ mode: 'set', amount: 100 }, 3)).toBe(100)
      expect(faabAfterChop({ mode: 'set', amount: 100 }, 400)).toBe(100)
      expect(faabAfterChop({ mode: 'unchanged', amount: 0 }, 40)).toBe(40)
    })
    it('says the rule in the season summary', () => {
      expect(describeSchedule(rules({ faab: { mode: 'add', amount: 25 } }), 1, 1)).toContain('After each chop, every surviving team gets $25 more FAAB.')
      expect(describeSchedule(rules({ faab: { mode: 'set', amount: 100 } }), 1, 1)).toContain('After each chop, every surviving team’s FAAB resets to $100.')
    })
  })
})
