/**
 * Direct, exhaustive coverage of `computeObservedAcceptRate()`
 * (lib/trade-engine/auto-recalibration.ts) after fixing the enum
 * case-mismatch bug documented in docs/TRADE_LEARNING_ACTIVATION_BLOCKERS.md.
 *
 * Real `TradeOutcomeEvent.outcome` values are the Prisma `TradeOutcome` enum:
 * ACCEPTED | REJECTED | EXPIRED | COUNTERED | UNKNOWN (schema.prisma:14339).
 * Convention matched here (already established elsewhere in the codebase —
 * lib/trade-engine/model-metrics-etl.ts:348, lib/rankings-engine/
 * weekly-weight-learning.ts:330, lib/rankings-engine/adaptive-weight-learning.ts:194):
 *   - ACCEPTED counts as accepted (label 1)
 *   - REJECTED, EXPIRED count as non-accepted (label 0)
 *   - COUNTERED, UNKNOWN carry no accept/reject signal and are excluded
 *     entirely (not counted in either the numerator or the denominator)
 *
 * This file does not activate `runWeeklyRecalibration()` or add any cron
 * wiring — it only verifies the calculation fix in isolation and through
 * `computeShadowB0()`'s public surface.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockTradeOutcomeEventFindMany, mockTradeOfferEventFindMany, mockTradeLearningStatsFindUnique } = vi.hoisted(() => ({
  mockTradeOutcomeEventFindMany: vi.fn(),
  mockTradeOfferEventFindMany: vi.fn(),
  mockTradeLearningStatsFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tradeOutcomeEvent: { findMany: mockTradeOutcomeEventFindMany },
    tradeOfferEvent: { findMany: mockTradeOfferEventFindMany },
    tradeLearningStats: { findUnique: mockTradeLearningStatsFindUnique },
  },
}))

import { computeObservedAcceptRate, computeShadowB0 } from '@/lib/trade-engine/auto-recalibration'

describe('computeObservedAcceptRate — direct unit coverage', () => {
  it('all-ACCEPTED outcomes return observed rate 1', () => {
    const outcomes = Array.from({ length: 10 }, () => ({ outcome: 'ACCEPTED' }))
    expect(computeObservedAcceptRate(outcomes)).toBe(1)
  })

  it('all-REJECTED outcomes return observed rate 0', () => {
    const outcomes = Array.from({ length: 10 }, () => ({ outcome: 'REJECTED' }))
    expect(computeObservedAcceptRate(outcomes)).toBe(0)
  })

  it('all-EXPIRED outcomes are treated as non-accepted, same as REJECTED (rate 0)', () => {
    const outcomes = Array.from({ length: 10 }, () => ({ outcome: 'EXPIRED' }))
    expect(computeObservedAcceptRate(outcomes)).toBe(0)
  })

  it('mixed ACCEPTED/REJECTED outcomes return the correct proportional rate', () => {
    const outcomes = [
      ...Array.from({ length: 7 }, () => ({ outcome: 'ACCEPTED' })),
      ...Array.from({ length: 3 }, () => ({ outcome: 'REJECTED' })),
    ]
    expect(computeObservedAcceptRate(outcomes)).toBeCloseTo(0.7, 5)
  })

  it('mixed ACCEPTED/REJECTED/EXPIRED outcomes return the correct rate, treating EXPIRED as non-accepted', () => {
    const outcomes = [
      ...Array.from({ length: 4 }, () => ({ outcome: 'ACCEPTED' })),
      ...Array.from({ length: 2 }, () => ({ outcome: 'REJECTED' })),
      ...Array.from({ length: 2 }, () => ({ outcome: 'EXPIRED' })),
    ]
    // 4 accepted out of 8 labeled (ACCEPTED+REJECTED+EXPIRED) = 0.5
    expect(computeObservedAcceptRate(outcomes)).toBeCloseTo(0.5, 5)
  })

  it('COUNTERED outcomes are excluded from the calculation entirely, not counted as non-accepted', () => {
    const allAccepted = Array.from({ length: 5 }, () => ({ outcome: 'ACCEPTED' }))
    const withCountered = [...allAccepted, ...Array.from({ length: 20 }, () => ({ outcome: 'COUNTERED' }))]

    // If COUNTERED were miscounted as non-accepted, adding 20 of them to 5
    // ACCEPTED rows would crater the rate toward 5/25 = 0.2. Correct behavior:
    // COUNTERED carries no signal, so the rate is unaffected by how many exist.
    expect(computeObservedAcceptRate(withCountered)).toBe(1)
    expect(computeObservedAcceptRate(withCountered)).toBe(computeObservedAcceptRate(allAccepted))
  })

  it('UNKNOWN outcomes are excluded from the calculation entirely, not counted as non-accepted', () => {
    const allRejected = Array.from({ length: 5 }, () => ({ outcome: 'REJECTED' }))
    const withUnknown = [...allRejected, ...Array.from({ length: 20 }, () => ({ outcome: 'UNKNOWN' }))]

    expect(computeObservedAcceptRate(withUnknown)).toBe(0)
    expect(computeObservedAcceptRate(withUnknown)).toBe(computeObservedAcceptRate(allRejected))
  })

  it('an all-COUNTERED/UNKNOWN batch (zero usable signal) is handled safely by returning null, not NaN or a fabricated rate', () => {
    const outcomes = [
      ...Array.from({ length: 10 }, () => ({ outcome: 'COUNTERED' })),
      ...Array.from({ length: 10 }, () => ({ outcome: 'UNKNOWN' })),
    ]
    expect(computeObservedAcceptRate(outcomes)).toBeNull()
  })

  it('an empty outcome array is handled safely by returning null', () => {
    expect(computeObservedAcceptRate([])).toBeNull()
  })

  it('legacy lowercase values ("accepted"/"completed") are intentionally rejected as unusable, not silently treated as ACCEPTED', () => {
    // 'completed' is not even a real TradeOutcome enum member — it never existed
    // in schema.prisma. 'accepted' (lowercase) is also never written by any real
    // caller (logTradeOutcomeEvent always .toUpperCase()s before persisting).
    // Both are intentionally excluded rather than silently matched, so any stray
    // legacy-cased row shows up as "no signal" (null/excluded) instead of quietly
    // resurrecting the original case-mismatch bug in the opposite direction.
    const outcomes = [{ outcome: 'accepted' }, { outcome: 'completed' }]
    expect(computeObservedAcceptRate(outcomes)).toBeNull()

    // Confirmed via a mixed batch too: lowercase rows don't contaminate a real,
    // correctly-cased signal.
    const mixed = [{ outcome: 'ACCEPTED' }, { outcome: 'accepted' }, { outcome: 'completed' }]
    expect(computeObservedAcceptRate(mixed)).toBe(1)
  })
})

describe('computeShadowB0 — sensitivity to real outcome mix (post-fix)', () => {
  afterEach(() => vi.clearAllMocks())

  it('produces a materially different computedB0 for a 90%-accepted mix than for a 10%-accepted mix, given the same predicted mean', async () => {
    const offers = Array.from({ length: 40 }, (_, i) => ({ id: `offer-${i}`, featuresJson: {}, acceptProb: 0.5 }))
    mockTradeOfferEventFindMany.mockResolvedValue(offers)
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10 })

    const highAcceptOutcomes = Array.from({ length: 40 }, (_, i) => ({
      offerEventId: `offer-${i}`,
      outcome: i < 36 ? 'ACCEPTED' : 'REJECTED', // 90% accepted
    }))
    mockTradeOutcomeEventFindMany.mockResolvedValueOnce(highAcceptOutcomes)
    const highAcceptMetrics = await computeShadowB0(2025)

    const lowAcceptOutcomes = Array.from({ length: 40 }, (_, i) => ({
      offerEventId: `offer-${i}`,
      outcome: i < 4 ? 'ACCEPTED' : 'REJECTED', // 10% accepted
    }))
    mockTradeOutcomeEventFindMany.mockResolvedValueOnce(lowAcceptOutcomes)
    const lowAcceptMetrics = await computeShadowB0(2025)

    expect(highAcceptMetrics).not.toBeNull()
    expect(lowAcceptMetrics).not.toBeNull()
    expect(highAcceptMetrics!.observedRate).toBeCloseTo(0.9, 5)
    expect(lowAcceptMetrics!.observedRate).toBeCloseTo(0.1, 5)
    expect(highAcceptMetrics!.computedB0).toBeGreaterThan(lowAcceptMetrics!.computedB0)
  })

  it('a batch with zero usable (all-COUNTERED) outcomes returns null rather than fabricating a shadow B0', async () => {
    mockTradeOutcomeEventFindMany.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({ offerEventId: `offer-${i}`, outcome: 'COUNTERED' })),
    )
    mockTradeOfferEventFindMany.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({ id: `offer-${i}`, featuresJson: {}, acceptProb: 0.5 })),
    )
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10 })

    const metrics = await computeShadowB0(2025)
    expect(metrics).toBeNull()
  })
})
