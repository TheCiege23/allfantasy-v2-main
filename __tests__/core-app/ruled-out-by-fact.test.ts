import { describe, expect, it } from 'vitest'

import { ruledOutByFact } from '@/lib/core-app/injuryStatus'

/* The rule the waiver board and Chimmy's starters count now share. */
describe('ruledOutByFact', () => {
  it.each([
    [{ status: 'Out', stale: false }, true],
    [{ status: 'IR', stale: false }, true],
    [{ status: 'Suspension', stale: false }, true],
    [{ status: 'PUP', stale: true }, true],
    [{ status: 'IR', stale: true }, true],
    [{ status: 'Out', stale: true }, false],
    [{ status: 'Questionable', stale: false }, false],
    [{ status: 'Doubtful', stale: false }, false],
    [{ status: null, stale: false }, false],
  ])('%j → %s', (fact, expected) => {
    expect(ruledOutByFact(fact)).toBe(expected)
  })

  it('no fact is not ruled out', () => {
    expect(ruledOutByFact(null)).toBe(false)
    expect(ruledOutByFact(undefined)).toBe(false)
  })
})
