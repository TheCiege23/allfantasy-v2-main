import { describe, expect, it } from 'vitest'
import { buildWaiverRunReport } from '@/lib/waivers/waiverRunReport'

const results = [
  { claimId: '1', rosterId: 'A', success: true, addPlayerId: 'X', dropPlayerId: 'D', faabSpent: 12, faabBid: 12 },
  { claimId: '2', rosterId: 'B', success: false, addPlayerId: 'X', faabBid: 11 },
  { claimId: '3', rosterId: 'C', success: false, addPlayerId: 'X', faabBid: 4 },
]
const names: Record<string, string> = { A: 'Aces', B: 'Bombers', C: 'Comets', X: 'Puka Nacua', D: 'Tank Dell' }

describe('waiver run report', () => {
  it('lists each award with its price and the bids that lost, highest first', () => {
    expect(buildWaiverRunReport({ results, teamName: (id) => names[id]!, playerName: (id) => names[id]!, hideLosingBids: false, faab: true })).toBe(
      'Waiver report\n• Aces added Puka Nacua ($12), dropped Tank Dell\n  Also bid: Bombers $11, Comets $4',
    )
  })

  it('hides the losing bids when the commissioner chooses, and drops prices outside FAAB', () => {
    expect(buildWaiverRunReport({ results, teamName: (id) => names[id]!, playerName: (id) => names[id]!, hideLosingBids: true, faab: true })).toBe(
      'Waiver report\n• Aces added Puka Nacua ($12), dropped Tank Dell',
    )
    expect(buildWaiverRunReport({ results, teamName: (id) => names[id]!, playerName: (id) => names[id]!, hideLosingBids: false, faab: false })).toBe(
      'Waiver report\n• Aces added Puka Nacua, dropped Tank Dell',
    )
  })
})
