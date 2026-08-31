import { describe, it, expect } from 'vitest'

import { pickValue } from '@/lib/decision-os/value/idpKickerAdapter'

/**
 * The field trap, pinned.
 *
 * `buildIdpKickerValueMap` writes the real number into ONE of `value` / `redraftValue` and a
 * literal 0 into the other:
 *
 *     value:        isDynasty ? value : 0
 *     redraftValue: isDynasty ? 0     : value
 *
 * Reading `.value` unconditionally is the obvious thing to write and it prices every IDP and
 * kicker in every REDRAFT league at zero — a legitimate number that `isCoherentValue` accepts,
 * so nothing downstream would reject it. Every defender would silently be worthless.
 *
 * If someone later "simplifies" pickValue to `row.value`, this test is what stops it.
 */
describe('pickValue — reads the field this league format actually populates', () => {
  const dynastyRow = { value: 1200, redraftValue: 0 }
  const redraftRow = { value: 0, redraftValue: 340 }

  it('reads `value` in a dynasty league', () => {
    expect(pickValue(dynastyRow, true)).toBe(1200)
  })

  it('🛑 reads `redraftValue` in a redraft league, NOT the zeroed `value`', () => {
    expect(pickValue(redraftRow, false)).toBe(340)
    // The bug this exists to prevent, stated as an assertion:
    expect(pickValue(redraftRow, false)).not.toBe(0)
  })

  it('returns null — not 0 — when the format this league uses is unpopulated', () => {
    // "not priced" and "priced at zero" are different claims, and only one is ever true here.
    expect(pickValue(dynastyRow, false)).toBeNull()
    expect(pickValue(redraftRow, true)).toBeNull()
  })

  it('treats a non-finite or negative number as unpriced rather than passing it through', () => {
    expect(pickValue({ value: Number.NaN, redraftValue: 0 }, true)).toBeNull()
    expect(pickValue({ value: -5, redraftValue: 0 }, true)).toBeNull()
  })
})
