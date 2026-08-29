// @vitest-environment node
/**
 * Guards lib/adp/consensusConfidence.ts against the inversion it was written to fix.
 *
 * The production fingerprint this reproduces, measured at season week 35 on adp_data:
 * a single-source consensus averaged 0.438 while a genuine two-source one averaged 0.371,
 * because the caller passed `spread = 0` for a lone provider and zero spread is the most
 * favourable value the penalty term can take. Every 2026 rookie is single-source — the
 * static CSV predates their draft — so the class we knew least about scored highest.
 */
import { describe, it, expect } from 'vitest'
import {
  confidenceForConsensus,
  UNCORROBORATED_CONFIDENCE_CEILING,
} from '@/lib/adp/consensusConfidence'

describe('confidenceForConsensus', () => {
  it('never scores a single source above a real two-source consensus', () => {
    const lone = confidenceForConsensus(1, null)
    // The worst possible two-source case: maximum spread, so maximum penalty.
    const twoWorst = confidenceForConsensus(2, 10_000)
    expect(lone).toBeLessThanOrEqual(twoWorst)
  })

  it('reproduces the exact pre-fix value so the regression is recognisable', () => {
    // 0.3 + (1/4)*0.55 - 0 === 0.4375 was the old score for one provider.
    expect(confidenceForConsensus(1, null)).not.toBeCloseTo(0.4375, 4)
  })

  it('caps any uncorroborated figure at the ceiling', () => {
    for (const spread of [null, 0]) {
      expect(confidenceForConsensus(1, spread)).toBeLessThanOrEqual(UNCORROBORATED_CONFIDENCE_CEILING)
    }
    // providerCount 0 should not underflow into something confident either.
    expect(confidenceForConsensus(0, null)).toBeLessThanOrEqual(UNCORROBORATED_CONFIDENCE_CEILING)
  })

  it('treats a zero spread reported alongside one provider as uncorroborated, not as agreement', () => {
    // The old caller passed 0 rather than null; the guard must not depend on the caller.
    expect(confidenceForConsensus(1, 0)).toBeLessThanOrEqual(UNCORROBORATED_CONFIDENCE_CEILING)
  })

  it('still rewards more providers and punishes disagreement', () => {
    const tight2 = confidenceForConsensus(2, 1)
    const tight4 = confidenceForConsensus(4, 1)
    const wide4 = confidenceForConsensus(4, 55)
    expect(tight4).toBeGreaterThan(tight2)
    expect(tight4).toBeGreaterThan(wide4)
  })

  it('keeps every result inside the documented range', () => {
    const cases: Array<[number, number | null]> = [
      [0, null], [1, null], [1, 0], [2, 0], [2, 500], [4, 0], [9, 0], [5, 1000],
    ]
    for (const [count, spread] of cases) {
      const score = confidenceForConsensus(count, spread)
      expect(score).toBeGreaterThanOrEqual(0.2)
      expect(score).toBeLessThanOrEqual(0.98)
      expect(Number.isFinite(score)).toBe(true)
    }
  })
})
