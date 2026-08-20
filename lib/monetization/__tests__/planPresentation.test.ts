import { describe, expect, it } from 'vitest'
import { getPlanPresentations, describeYearlySavings } from '../planPresentation'

/**
 * ⚠ THESE GUARD DERIVED COPY, WHICH IS THE KIND THAT GOES WRONG SILENTLY. Every
 * figure here is computed from the catalog, so a price change rewrites the
 * marketing sentence automatically — which is the point, and also the risk. A
 * wrong derivation produces a confident, well-formatted, false claim.
 */
describe('plan presentation', () => {
  const plans = getPlanPresentations()

  it('presents every subscription family', () => {
    expect(plans.length).toBeGreaterThan(0)
    for (const p of plans) expect(p.name).toBeTruthy()
  })

  it('never advertises a negative or zero saving', () => {
    // Rendering "you save -$5.00" would be worse than rendering nothing.
    for (const p of plans) {
      if (!p.savings) continue
      expect(p.savings.savedUsd, `${p.name}`).toBeGreaterThan(0)
      expect(p.savings.savedPct, `${p.name}`).toBeGreaterThan(0)
    }
  })

  it('effective monthly is genuinely below the monthly price', () => {
    for (const p of plans) {
      if (!p.savings || !p.monthly) continue
      expect(p.savings.effectiveMonthly, `${p.name}`).toBeLessThan(p.monthly.amountUsd)
    }
  })

  it('the headline quotes the FLOOR, so no card overstates its own plan', () => {
    const headline = describeYearlySavings(plans)
    if (!headline) return
    const quoted = Number(/(\d+)%/.exec(headline)?.[1])
    expect(Number.isFinite(quoted)).toBe(true)
    for (const p of plans) {
      if (!p.savings) continue
      expect(
        p.savings.savedPct,
        `headline promises ${quoted}% but ${p.name} only saves ${p.savings.savedPct}%`
      ).toBeGreaterThanOrEqual(quoted)
    }
  })
})
