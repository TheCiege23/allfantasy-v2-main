/**
 * Blend policy — our own draft evidence versus the market's.
 *
 * The blend used fixed proportions (api 40 / app 35 / ai 25) regardless of how much evidence stood
 * behind our side, so a player drafted in TWO of our drafts moved the consensus exactly as far as
 * one drafted in two thousand. These tests pin the shrinkage that fixes it, and the two
 * distinctions that are easy to collapse and wrong to collapse:
 *
 *   - provider count is not draft count (so `api` must not be shrunk)
 *   - present-but-thin is not absent (so they must not produce the same number)
 */

import { describe, expect, it } from 'vitest'

import {
  HALF_CONFIDENCE_SAMPLE,
  blendOne,
  normalizeBlendWeights,
  sampleConfidence,
} from '@/lib/adp/blendPolicy'

const W = normalizeBlendWeights({ api: 40, app: 35, ai: 25, custom: 0 })

describe('sampleConfidence', () => {
  it('is zero without samples and one half at the threshold', () => {
    expect(sampleConfidence(0)).toBe(0)
    expect(sampleConfidence(null)).toBe(0)
    expect(sampleConfidence(undefined)).toBe(0)
    expect(sampleConfidence(HALF_CONFIDENCE_SAMPLE)).toBeCloseTo(0.5, 10)
  })

  it('rises monotonically and never reaches one', () => {
    let prev = -1
    for (const n of [1, 2, 5, 10, 30, 90, 1000, 100_000]) {
      const c = sampleConfidence(n)
      expect(c).toBeGreaterThan(prev)
      expect(c).toBeLessThan(1)
      prev = c
    }
  })

  it('treats a negative count as no evidence rather than negative evidence', () => {
    expect(sampleConfidence(-5)).toBe(0)
  })
})

describe('thin evidence defers to the market', () => {
  const market = { adp: 20 }

  it('a two-draft sample barely moves the blend', () => {
    const thin = blendOne({ api: market, app: { adp: 100, sampleSize: 2 } }, W)!
    // Market says 20, our two drafts say 100. The result must sit far nearer the market.
    expect(thin.adp).toBeLessThan(40)
    expect(thin.contributions.app).toBeLessThan(0.25)
  })

  it('a deep sample earns its full configured share, and no more', () => {
    const deep = blendOne({ api: market, app: { adp: 100, sampleSize: 2000 } }, W)!
    const thin = blendOne({ api: market, app: { adp: 100, sampleSize: 2 } }, W)!

    /*
     * Shrinkage restores a source to its CONFIGURED weight; it does not promote it past one.
     * With api 40 and app 35, full confidence renormalises to 0.4/0.75 and 0.35/0.75, so the
     * ceiling for app is ~0.467 and the blend of 20 and 100 lands near 57.3 - not past 60. An
     * earlier version of this test asserted > 60, which described a policy nobody wrote.
     */
    const ceiling = 20 * (0.4 / 0.75) + 100 * (0.35 / 0.75)

    /*
     * Approaches the ceiling from BELOW and never reaches it: confidence(2000) is 0.995, not 1.
     * Asserting equality would be asserting that shrinkage switches off at some sample size,
     * which is not what the curve does and not what we want it to do.
     */
    expect(deep.contributions.app).toBeCloseTo(0.35 / 0.75, 2)
    expect(deep.adp).toBeLessThan(ceiling)
    expect(deep.adp).toBeGreaterThan(ceiling - 0.5)
    expect(deep.adp).toBeGreaterThan(thin.adp + 20)
  })

  it('the same disagreement moves further as the corpus grows', () => {
    const adps = [2, 10, 50, 500, 5000].map(
      (n) => blendOne({ api: market, app: { adp: 100, sampleSize: n } }, W)!.adp,
    )
    for (let i = 1; i < adps.length; i++) {
      expect(adps[i]!).toBeGreaterThan(adps[i - 1]!)
    }
  })

  it('flags our own contribution as thin below the threshold', () => {
    expect(blendOne({ api: market, app: { adp: 100, sampleSize: 4 } }, W)!.lowOwnSample).toBe(true)
    expect(blendOne({ api: market, app: { adp: 100, sampleSize: 40 } }, W)!.lowOwnSample).toBe(false)
  })

  it('reports the draft count behind our side, and null when we have none', () => {
    expect(blendOne({ api: market, app: { adp: 100, sampleSize: 7 } }, W)!.ownSampleSize).toBe(7)
    expect(blendOne({ api: market }, W)!.ownSampleSize).toBeNull()
  })
})

describe('provider count is not draft count', () => {
  it('does not shrink the market source by its sampleSize', () => {
    // api.sampleSize is a count of PROVIDERS (1-6). Shrinking it would gut a normal consensus.
    const oneProvider = blendOne({ api: { adp: 20, sampleSize: 1 }, app: { adp: 100, sampleSize: 50 } }, W)!
    const sixProviders = blendOne({ api: { adp: 20, sampleSize: 6 }, app: { adp: 100, sampleSize: 50 } }, W)!
    expect(oneProvider.adp).toBe(sixProviders.adp)
    expect(oneProvider.contributions.api).toBeCloseTo(sixProviders.contributions.api, 10)
  })

  it('gives the market its full configured share against an equally deep own sample', () => {
    const r = blendOne({ api: { adp: 20, sampleSize: 1 }, app: { adp: 100, sampleSize: 1_000_000 } }, W)!
    // app confidence approaches 1, so the split approaches the configured 40/35 -> 0.533/0.467.
    expect(r.contributions.api).toBeCloseTo(0.4 / 0.75, 2)
  })
})

describe('present-but-thin is not the same as absent', () => {
  it('produces a different number from an absent source', () => {
    const absent = blendOne({ api: { adp: 20 } }, W)!
    const thin = blendOne({ api: { adp: 20 }, app: { adp: 100, sampleSize: 2 } }, W)!
    expect(thin.adp).not.toBe(absent.adp)
    expect(absent.contributions.app).toBe(0)
    expect(thin.contributions.app).toBeGreaterThan(0)
  })

  it('renormalises an absent source away rather than treating it as zero ADP', () => {
    const r = blendOne({ api: { adp: 20 } }, W)!
    expect(r.adp).toBe(20) // not 20*0.4 = 8
    expect(r.contributions.api).toBe(1)
  })
})

describe('contributions are honest', () => {
  it('sum to one whenever anything contributed', () => {
    const r = blendOne(
      {
        api: { adp: 10 },
        app: { adp: 20, sampleSize: 30 },
        ai: { adp: 30, sampleSize: 15 },
      },
      W,
    )!
    const total =
      r.contributions.api + r.contributions.app + r.contributions.ai + r.contributions.custom
    expect(total).toBeCloseTo(1, 10)
  })
})

describe('a locked custom ranking overrides everything', () => {
  it('short-circuits the blend entirely', () => {
    const r = blendOne(
      {
        api: { adp: 5 },
        app: { adp: 200, sampleSize: 9999 },
        custom: { adp: 42, locked: true },
      },
      normalizeBlendWeights({ api: 40, app: 35, ai: 25, custom: 10 }),
    )!
    expect(r.adp).toBe(42)
    expect(r.contributions.custom).toBe(1)
    expect(r.contributions.api).toBe(0)
  })
})

describe('degenerate inputs', () => {
  it('returns null when there is nothing to blend', () => {
    expect(blendOne({}, W)).toBeNull()
  })

  it('falls back rather than inventing a number when only zero-confidence sources exist', () => {
    const r = blendOne({ app: { adp: 77, sampleSize: 0 } }, W)!
    expect(r.adp).toBe(77)
    // Reported as a fallback, not as a blend: nothing carried weight.
    expect(r.contributions.app).toBe(0)
  })

  it('ignores a non-finite ADP instead of poisoning the mean', () => {
    const r = blendOne({ api: { adp: Number.NaN }, app: { adp: 50, sampleSize: 100 } }, W)!
    expect(Number.isFinite(r.adp)).toBe(true)
    expect(r.adp).toBe(50)
    expect(r.contributions.api).toBe(0)
  })
})

describe('weight normalisation', () => {
  it('returns fractions, including on the all-zero path', () => {
    const zero = normalizeBlendWeights({ api: 0, app: 0, ai: 0, custom: 0 })
    const total = zero.api + zero.app + zero.ai + zero.custom
    expect(total).toBeCloseTo(1, 10)
    // The old local copy returned 40/35/25 here — unnormalised, a different scale from every
    // other league's weights.
    expect(zero.api).toBeLessThanOrEqual(1)
  })

  it('accepts percentages and fractions alike', () => {
    const pct = normalizeBlendWeights({ api: 40, app: 35, ai: 25, custom: 0 })
    const frac = normalizeBlendWeights({ api: 0.4, app: 0.35, ai: 0.25, custom: 0 })
    expect(pct.api).toBeCloseTo(frac.api, 10)
  })

  it('ignores a negative weight rather than subtracting evidence', () => {
    const r = normalizeBlendWeights({ api: 40, app: -100, ai: 25, custom: 0 })
    expect(r.app).toBe(0)
    expect(r.api + r.ai).toBeCloseTo(1, 10)
  })
})
