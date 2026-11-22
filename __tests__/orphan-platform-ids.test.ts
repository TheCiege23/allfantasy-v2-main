import { describe, expect, it } from 'vitest'

import { isSeatPlaceholderUserId, rosterIdFromOrphanSeat, seatPlaceholderUserIdOr } from '@/lib/orphan-ai-manager/orphan-platform-ids'

describe('seat placeholders', () => {
  it('every kind of seat with no person behind it is a placeholder', () => {
    expect(isSeatPlaceholderUserId('orphan-r9')).toBe(true)
    expect(isSeatPlaceholderUserId('ai-manager-3')).toBe(true)
    // The unclaimed seat of a league AllFantasy hosts, which "Fill empty slots" hands to Chimmy.
    expect(isSeatPlaceholderUserId('open-slot-1d31b421-aa0d-4bb0-9076-2524cf9db4cf-3')).toBe(true)
  })

  it('an account id is not', () => {
    expect(isSeatPlaceholderUserId('9791bae0-e47f-418a-ae40-285f6a2e7887')).toBe(false)
    expect(isSeatPlaceholderUserId('')).toBe(false)
    expect(isSeatPlaceholderUserId(null)).toBe(false)
  })

  it('the database filter names the same prefixes the check does', () => {
    const prefixes = seatPlaceholderUserIdOr().map((c) => c.userId.startsWith)
    expect(prefixes.sort()).toEqual(['ai-manager-', 'open-slot-', 'orphan-'])
    for (const prefix of prefixes) expect(isSeatPlaceholderUserId(`${prefix}x`)).toBe(true)
  })

  it('only an orphan seat carries a roster id in its name', () => {
    expect(rosterIdFromOrphanSeat('orphan-r9')).toBe('r9')
    expect(rosterIdFromOrphanSeat('open-slot-L1-9')).toBeNull()
  })
})
