/**
 * In a devy or campus-to-canton league Chimmy answers on the trade screen's own grade
 * (lib/inactive-manager/chimmyGradeDecision.ts).
 */
import { describe, expect, it } from 'vitest'
import { decideOnLeagueGrade } from '@/lib/inactive-manager/chimmyGradeDecision'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'

const ME = 'chimmy'
const items = [
  { itemType: 'player', itemReference: '612', fromRosterId: ME, toRosterId: 'them' },
  { itemType: 'player', itemReference: 'espn:ncaab:4433', fromRosterId: 'them', toRosterId: ME },
]
const graded = (giveValue: number, getValue: number) => ({ graded: true, giveValue, getValue } as unknown as TradeGradeView)
const decide = (grade: TradeGradeView, over: Partial<Parameters<typeof decideOnLeagueGrade>[0]> = {}) =>
  decideOnLeagueGrade({ grade, rosterId: ME, items, starterIds: [], fairness: 0.05, ...over })

describe('decideOnLeagueGrade', () => {
  it('accepts when the grade gives Chimmy more than its fairness margin', () => {
    expect(decide(graded(100, 110)).code).toBe('accepted')
  })

  it('declines a deal inside the margin', () => {
    expect(decide(graded(100, 103)).code).toBe('not_enough')
  })

  it('declines with the screen\'s own reason when the screen cannot grade it', () => {
    const answer = decide({ graded: false, reason: 'A verified Campus projection and replacement level are required for Cooper Flagg.', basis: null } as TradeGradeView)
    expect(answer.code).toBe('cannot_value')
    expect(answer.reason).toContain('Cooper Flagg')
  })

  it('separate standings: a gain in one division never pays for a loss in the other', () => {
    const split = (campus: [number, number], canton: [number, number]) => ({
      graded: false, reason: 'separate', basis: null,
      divisionImpacts: [
        { division: 'Campus', giveValue: campus[0], getValue: campus[1] },
        { division: 'Canton', giveValue: canton[0], getValue: canton[1] },
      ],
    } as unknown as TradeGradeView)
    expect(decide(split([0, 500], [100, 50])).code).toBe('not_enough')
    expect(decide(split([0, 500], [100, 100])).code).toBe('not_enough')
    expect(decide(split([0, 500], [100, 106])).code).toBe('accepted')
    expect(decide(split([0, 500], [0, 0])).code).toBe('accepted')
  })

  it('keeps the roster rules: never more starters out than players back', () => {
    const twoForOne = [
      { itemType: 'player', itemReference: '612', fromRosterId: ME, toRosterId: 'them' },
      { itemType: 'player', itemReference: '833', fromRosterId: ME, toRosterId: 'them' },
      { itemType: 'player', itemReference: 'espn:ncaab:4433', fromRosterId: 'them', toRosterId: ME },
    ]
    expect(decide(graded(100, 200), { items: twoForOne, starterIds: ['612', '833'] }).code).toBe('lineup_hole')
  })

  it('a pick coming back is not a player back', () => {
    const forPick = [
      { itemType: 'player', itemReference: '612', fromRosterId: ME, toRosterId: 'them' },
      { itemType: 'future_pick', itemReference: 'fdp:2027:1:x', fromRosterId: 'them', toRosterId: ME },
    ]
    expect(decide(graded(100, 200), { items: forPick, starterIds: ['612'] }).code).toBe('lineup_hole')
    expect(decide(graded(100, 200), { items: forPick, starterIds: [] }).code).toBe('accepted')
  })
})
