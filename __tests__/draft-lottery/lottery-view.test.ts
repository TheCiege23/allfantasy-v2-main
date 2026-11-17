import { describe, expect, it } from 'vitest'
import {
  formatOdds,
  formatRecord,
  isSameSlotOrder,
  movementFor,
  oddsBarPercent,
  projectedSlots,
  revealSequence,
  stillIn,
  worstFirst,
} from '@/lib/draft-lottery/lotteryView'

const teams = [
  { rosterId: 'rz', displayName: 'Red Zone Rebels', rank: 5, wins: 7, losses: 7, oddsPercent: 10 },
  { rosterId: 'tp', displayName: 'Two-Point Try', rank: 10, wins: 3, losses: 11, oddsPercent: 25 },
  { rosterId: 'pp', displayName: 'Pocket Passers', rank: 8, wins: 5, losses: 9, oddsPercent: 17.5 },
  { rosterId: 'sf', displayName: 'Sunday Funday', rank: 9, wins: 4, losses: 10, oddsPercent: 20 },
]
const draws = [
  { pickSlot: 1, rosterId: 'pp', displayName: 'Pocket Passers' },
  { pickSlot: 2, rosterId: 'tp', displayName: 'Two-Point Try' },
  { pickSlot: 3, rosterId: 'sf', displayName: 'Sunday Funday' },
  { pickSlot: 4, rosterId: 'rz', displayName: 'Red Zone Rebels' },
]

describe('lottery view', () => {
  it('orders the odds table worst record first', () => {
    expect(worstFirst(teams).map((t) => t.rosterId)).toEqual(['tp', 'sf', 'pp', 'rz'])
  })

  it('projects where each team picks on record alone', () => {
    const p = projectedSlots(teams)
    expect(p.get('tp')).toBe(1)
    expect(p.get('pp')).toBe(3)
  })

  it('reports movement against the projection', () => {
    const p = projectedSlots(teams)
    expect(movementFor('pp', 1, p)).toEqual({ direction: 'up', by: 2, from: 3 })
    expect(movementFor('tp', 2, p)).toEqual({ direction: 'down', by: 1, from: 1 })
    expect(movementFor('rz', 4, p)).toEqual({ direction: 'same', by: 0, from: 4 })
    expect(movementFor('nobody', 4, p)).toEqual({ direction: 'same', by: 0, from: null })
  })

  it('reveals from the last lottery pick up to No. 1', () => {
    expect(revealSequence(draws).map((d) => d.pickSlot)).toEqual([4, 3, 2, 1])
  })

  it('lists who is still in after some picks are revealed', () => {
    const shown = revealSequence(draws).slice(0, 2)
    expect(stillIn(teams, shown).map((t) => t.rosterId)).toEqual(['tp', 'pp'])
  })

  it('formats records and odds', () => {
    expect(formatRecord({ wins: 3, losses: 11 })).toBe('3–11')
    expect(formatRecord({ wins: 6, losses: 7, ties: 1 })).toBe('6–7–1')
    expect(formatRecord({})).toBeNull()
    expect(formatOdds(25)).toBe('25%')
    expect(formatOdds(17.5)).toBe('17.5%')
    expect(formatOdds(12.4999)).toBe('12.5%')
    expect(oddsBarPercent(17.5, teams)).toBe(70)
    expect(oddsBarPercent(5, [])).toBe(0)
  })

  it('knows a locked order by roster per slot, ignoring names', () => {
    const a = [{ slot: 1, rosterId: 'pp', displayName: 'Pocket Passers' }, { slot: 2, rosterId: 'tp', displayName: 'Two-Point Try' }]
    const renamed = [{ slot: 2, rosterId: 'tp', displayName: 'Renamed' }, { slot: 1, rosterId: 'pp', displayName: 'PP' }]
    expect(isSameSlotOrder(a, renamed)).toBe(true)
    expect(isSameSlotOrder(a, [{ slot: 1, rosterId: 'tp', displayName: '' }, { slot: 2, rosterId: 'pp', displayName: '' }])).toBe(false)
    expect(isSameSlotOrder(a, a.slice(0, 1))).toBe(false)
    expect(isSameSlotOrder(null, a)).toBe(false)
  })
})
