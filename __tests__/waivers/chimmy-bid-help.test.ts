import { describe, expect, it } from 'vitest'
import { suggestBidRange } from '@/lib/waivers/chimmyBidHelp'

describe('Chimmy bid help', () => {
  it('reads the range from the league\'s own winning bids', () => {
    const r = suggestBidRange({ winningBids: [1, 2, 3, 5, 8, 10, 12, 15, 20, 30], remainingBudget: 100 })
    expect(r).toMatchObject({ ok: true, low: 10, high: 15, sample: 10 })
  })

  it('never suggests more than the manager has left, or less than the minimum bid', () => {
    const r = suggestBidRange({ winningBids: [10, 20, 30, 40, 50, 60], remainingBudget: 25, minBid: 2 })
    expect(r.ok && r.high).toBe(25)
    const tiny = suggestBidRange({ winningBids: [1, 1, 1, 1, 1], remainingBudget: 100, minBid: 3 })
    expect(tiny.ok && tiny.low).toBe(3)
  })

  it('says it cannot tell with fewer than five winning bids — no invented market', () => {
    expect(suggestBidRange({ winningBids: [4, 9], remainingBudget: 100 })).toEqual({
      ok: false,
      note: 'Not enough bids in this league yet to suggest a range. Bid what the player is worth to you.',
    })
  })
})
