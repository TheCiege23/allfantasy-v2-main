import { describe, it, expect } from 'vitest'

import { confidenceFromStdDev } from '@/lib/decision-os/value/marketAdapter'

/**
 * The direction of this mapping is the easy thing to get backwards, and getting it backwards
 * would be invisible: every value would still carry a plausible 0..1 number.
 *
 * `PlayerValueSnapshot.marketStdDev` is described in the schema as "MARKET DISAGREEMENT... exactly
 * where an edge lives". An edge for a trader is UNCERTAINTY for a valuation, so disagreement must
 * LOWER confidence. A future reader optimising for "high stdDev means interesting" would flip it.
 */
describe('confidenceFromStdDev', () => {
  it('maps agreement to high confidence and disagreement to low', () => {
    const agree = confidenceFromStdDev(50, 5000)      // 1% dispersion
    const disagree = confidenceFromStdDev(2500, 5000) // 50% dispersion
    expect(agree).not.toBeNull()
    expect(disagree).not.toBeNull()
    expect(agree!).toBeGreaterThan(disagree!)
    expect(agree!).toBeCloseTo(0.99, 2)
    expect(disagree!).toBeCloseTo(0.5, 2)
  })

  it('is RELATIVE to the value, not absolute', () => {
    // The same absolute spread means very different things on a 5,000 asset than a 500 one.
    const onBigAsset = confidenceFromStdDev(250, 5000)
    const onSmallAsset = confidenceFromStdDev(250, 500)
    expect(onBigAsset!).toBeGreaterThan(onSmallAsset!)
  })

  it('returns null — never 0.5, never 1 — when the producer reports no deviation', () => {
    // Null means "does not express confidence", which is not the same claim as "confidence is low".
    expect(confidenceFromStdDev(null, 5000)).toBeNull()
    expect(confidenceFromStdDev(undefined, 5000)).toBeNull()
    expect(confidenceFromStdDev(Number.NaN, 5000)).toBeNull()
  })

  it('returns null rather than dividing by a non-positive value', () => {
    expect(confidenceFromStdDev(100, 0)).toBeNull()
    expect(confidenceFromStdDev(100, -5)).toBeNull()
  })

  it('clamps into 0..1 so isCoherentValue can never reject its own producer', () => {
    const extreme = confidenceFromStdDev(50_000, 100)
    expect(extreme).toBe(0)
    expect(extreme!).toBeGreaterThanOrEqual(0)
  })
})
