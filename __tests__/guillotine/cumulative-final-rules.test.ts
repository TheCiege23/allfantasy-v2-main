import { describe, expect, it } from 'vitest'
import { resolveGuillotineEndgame, resolveCumulativeFinalWinner } from '@/lib/guillotine/endgameRules'
const ids = ['a', 'b', 'c', 'd']
const scores = ids.flatMap((rosterId, index) => [15,16,17].map(weekOrPeriod => ({ rosterId, weekOrPeriod, periodPoints: 100 + index * 10 })))
describe('guillotine cumulative final rules', () => {
  it('preserves the wizard endgame ahead of an old hardcoded column', () => {
    expect(resolveGuillotineEndgame({ settings: { eliminationSettings: { endgame: 'last_team_standing' } }, guillotineEndgame: 'final_two' }).threshold).toBe(1)
    expect(resolveGuillotineEndgame({ settings: { conceptSetup: { guillotine: { endgame: 'final_three' } } } }).threshold).toBe(3)
    expect(resolveGuillotineEndgame({ guillotineEndgame: 'final_four' })).toMatchObject({ threshold: 4, cumulativePeriods: 3 })
  })
  it('requires all three completed periods and scores for every finalist', () => {
    expect(resolveCumulativeFinalWinner(ids, 15, 16, 3, scores)).toBeNull()
    expect(resolveCumulativeFinalWinner(ids, 15, 17, 3, scores.slice(1))).toBeNull()
    expect(resolveCumulativeFinalWinner(ids, 15, 17, 3, scores)).toBe('d')
  })
  it('a tied final goes to the higher season total; a tie on that too stays unresolved (2026-10-29)', () => {
    const tied = scores.map(row => ({ ...row, periodPoints: 100 }))
    expect(resolveCumulativeFinalWinner(ids, 15, 17, 3, tied, new Map([['a', 900], ['b', 1200], ['c', 1100], ['d', 1000]]))).toBe('b')
    expect(resolveCumulativeFinalWinner(ids, 15, 17, 3, tied, new Map([['a', 1200], ['b', 1200], ['c', 1100], ['d', 1000]]))).toBeNull()
    // A finalist with no season total is not guessed at.
    expect(resolveCumulativeFinalWinner(ids, 15, 17, 3, tied, new Map([['a', 900], ['b', 1200], ['c', 1100]]))).toBeNull()
    // Only finalists level on the final count: a lower final total never wins on season points.
    const bLeads = scores.map(row => ({ ...row, periodPoints: row.rosterId === 'b' ? 50 : 100 }))
    expect(resolveCumulativeFinalWinner(ids, 15, 17, 3, bLeads, new Map([['a', 900], ['b', 5000], ['c', 1100], ['d', 1000]]))).toBe('c')
  })
  it('does not manufacture a winner on a cumulative tie or count pre-final scores', () => {
    const tied = scores.map(row => ({ ...row, periodPoints: 100 }))
    expect(resolveCumulativeFinalWinner(ids, 15, 17, 3, tied)).toBeNull()
    expect(resolveCumulativeFinalWinner(ids, 15, 17, 3, [...scores, { rosterId: 'a', weekOrPeriod: 14, periodPoints: 9999 }])).toBe('d')
  })
})
