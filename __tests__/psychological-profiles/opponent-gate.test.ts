import { describe, expect, it } from 'vitest'

import { canAccess } from '@/lib/access/canAccess'

/**
 * The route gates OTHER managers' psychological profiles on this feature. Your
 * own profile is always free — it describes you to you — but a profile of a
 * leaguemate is competitive intelligence about a real person.
 *
 * These assert the gate actually discriminates. A gate that is open to everyone
 * gives away the premium half; a gate that is closed to everyone silently breaks
 * it for paying customers, and both fail quietly with no error anywhere.
 */
const FEATURE = 'trade_analyzer' as const

describe('the opponent psychology gate discriminates', () => {
  it('locks an anonymous caller', () => {
    expect(canAccess(FEATURE, { isAuthenticated: false }).allowed).toBe(false)
  })

  it('locks a signed-in user with no plan', () => {
    expect(
      canAccess(FEATURE, { isAuthenticated: true, plans: [], status: 'active' }).allowed
    ).toBe(false)
  })

  it('allows a paying user', () => {
    expect(
      canAccess(FEATURE, { isAuthenticated: true, plans: ['pro'], status: 'active' }).allowed
    ).toBe(true)
  })

  it('locks a lapsed subscriber', () => {
    // Having once paid is not having access now.
    expect(
      canAccess(FEATURE, { isAuthenticated: true, plans: ['pro'], status: 'canceled' }).allowed
    ).toBe(false)
  })
})
