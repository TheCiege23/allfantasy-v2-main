import { describe, expect, it } from 'vitest'
import { parseAfAdpContributions, sortByAfAdp } from '@/lib/mock-draft/mockAfAdpSort'

describe('sortByAfAdp', () => {
  it('orders by AF ADP, puts players without one last, and keeps ties in market order', () => {
    const players = [
      { id: 'a', afAdp: 5 },
      { id: 'b', afAdp: null },
      { id: 'c', afAdp: 2 },
      { id: 'd' },
      { id: 'e', afAdp: 5 },
    ]
    expect(sortByAfAdp(players).map((p) => p.id)).toEqual(['c', 'a', 'e', 'b', 'd'])
  })
})

describe('parseAfAdpContributions', () => {
  it('reads the three shares and rejects anything partial', () => {
    expect(parseAfAdpContributions({ market: 0.5, imported: 0.3, af: 0.2 })).toEqual({ market: 0.5, imported: 0.3, af: 0.2 })
    expect(parseAfAdpContributions({ market: 0.5, imported: 0.5 })).toBeNull()
    expect(parseAfAdpContributions(null)).toBeNull()
  })
})
