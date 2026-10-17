import { describe, expect, it } from 'vitest'
import { compareClaimsWithCurrentRosterPriority } from '@/lib/redraft/waiverEngine'

describe('Survivor raid waiver priority', () => {
  it('uses the raided roster’s current boost even for a claim filed before the raid', () => {
    const when = new Date('2026-10-13T12:00:00Z')
    const claims = [
      { id: 'other', rosterId: 'other-roster', bidAmount: 0, priority: 1, submittedAt: when },
      { id: 'raided', rosterId: 'raided-roster', bidAmount: 0, priority: 9, submittedAt: when },
    ]
    const current = new Map([['other-roster', 1], ['raided-roster', -1]])
    expect([...claims].sort((a, b) => compareClaimsWithCurrentRosterPriority(a, b, current)).map(claim => claim.id)).toEqual(['raided', 'other'])
  })

  it('keeps FAAB bids ahead of priority-only claims', () => {
    const when = new Date('2026-10-13T12:00:00Z')
    const bid = { id: 'bid', rosterId: 'other-roster', bidAmount: 2, priority: 1, submittedAt: when }
    const boosted = { id: 'boosted', rosterId: 'raided-roster', bidAmount: 0, priority: 9, submittedAt: when }
    expect(compareClaimsWithCurrentRosterPriority(bid, boosted, new Map([['raided-roster', -1]]))).toBeLessThan(0)
  })
})
