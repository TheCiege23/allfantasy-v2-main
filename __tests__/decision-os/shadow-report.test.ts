/** The disagreement tally the letter switch waits on. */
import { describe, expect, it } from 'vitest'

import { tallyShadow } from '@/lib/decision-os/trade/shadowReport'

describe('tallyShadow', () => {
  it('counts agreement over COMPARED receipts only; missing letters are no comparison, never agreement', () => {
    const t = tallyShadow([
      { currentLetter: 'B', designLetter: 'B', agree: true },
      { currentLetter: 'A', designLetter: 'C', agree: false },
      { currentLetter: 'C', designLetter: 'D', agree: false },
      { currentLetter: 'B', designLetter: null, agree: null },
      null,
    ])
    expect(t).toMatchObject({ receipts: 5, compared: 3, agree: 1, disagree: 2, noComparison: 2, agreementPct: 33.3, farApart: 1 })
    expect(t.matrix).toEqual({ B: { B: 1 }, A: { C: 1 }, C: { D: 1 } })
  })

  it('nothing compared is a null rate, not 0% or 100%', () => {
    expect(tallyShadow([null, { currentLetter: null, designLetter: 'A', agree: null }]).agreementPct).toBeNull()
  })
})
