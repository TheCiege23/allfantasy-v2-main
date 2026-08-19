/**
 * Decision OS — Trade Learning Phase 3 (Pre-Enablement Data Readiness Audit).
 *
 * Task 2/3 of that phase asks to "compare data against existing gates" and
 * "validate diagnostics accuracy" using the real exported thresholds. This
 * file does that with synthetic data (no database connection — see
 * docs/TRADE_LEARNING_PRE_ENABLEMENT_AUDIT.md for why), and surfaces one
 * precise, pre-existing nuance found while doing so: computeShadowB0()'s
 * reported `sampleSize` does NOT mean "how many labeled (ACCEPTED/REJECTED/
 * EXPIRED) outcomes fed the observed rate." It means "how many outcomes of
 * ANY kind (including COUNTERED/UNKNOWN) had a matched offer with a valid
 * predicted probability." These can differ. This is a characteristic of the
 * pre-existing calibration computation itself (not introduced by the enum
 * fix, the ownership ADR, or the diagnostics work) and is explicitly NOT
 * changed here, per this phase's "do not change calibration math" constraint
 * — it is documented as a caveat in the pre-enablement audit instead.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const {
  mockTradeOutcomeEventFindMany,
  mockTradeOfferEventFindMany,
  mockTradeLearningStatsFindUnique,
} = vi.hoisted(() => ({
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

import {
  computeShadowB0,
  computeSegmentB0s,
  MIN_RECALIBRATION_SAMPLE,
  MIN_SEGMENT_SAMPLE,
} from '@/lib/trade-engine/auto-recalibration'

const SEASON = 2025

describe('computeShadowB0 — sample-size composition (Phase 3 verification)', () => {
  afterEach(() => vi.clearAllMocks())

  it('CAVEAT, proven: reported sampleSize can exceed the count of ACCEPTED/REJECTED/EXPIRED-labeled rows, because COUNTERED/UNKNOWN rows with a valid matched offer still count toward it', async () => {
    // 5 real ACCEPTED, 35 COUNTERED (unusable for the observed-rate calc, but
    // each has a valid matched offer with acceptProb > 0).
    const labeled = Array.from({ length: 5 }, (_, i) => ({ offerEventId: `labeled-${i}`, outcome: 'ACCEPTED' }))
    const unlabeled = Array.from({ length: 35 }, (_, i) => ({ offerEventId: `unlabeled-${i}`, outcome: 'COUNTERED' }))
    mockTradeOutcomeEventFindMany.mockResolvedValue([...labeled, ...unlabeled])

    const offers = [...labeled, ...unlabeled].map((o) => ({
      id: o.offerEventId,
      featuresJson: {},
      acceptProb: 0.5,
    }))
    mockTradeOfferEventFindMany.mockResolvedValue(offers)
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10 })

    const metrics = await computeShadowB0(SEASON)

    expect(metrics).not.toBeNull()
    // The observed rate is correctly computed from only the 5 labeled rows
    // (100% ACCEPTED among labeled rows) ...
    expect(metrics!.observedRate).toBe(1)
    // ... but the reported sampleSize reflects all 40 rows with a valid
    // matched offer, not just the 5 that actually informed observedRate.
    expect(metrics!.sampleSize).toBe(40)
    // This is exactly the caveat: an operator reading sampleSize=40 could
    // reasonably assume observedRate is based on 40 real accept/reject
    // signals. It is actually based on 5.
  })

  it('gate check: exactly MIN_RECALIBRATION_SAMPLE (30) raw rows passes the initial sample gate, even if most are unusable', async () => {
    const labeled = Array.from({ length: 2 }, (_, i) => ({ offerEventId: `labeled-${i}`, outcome: 'ACCEPTED' }))
    const unlabeled = Array.from({ length: MIN_RECALIBRATION_SAMPLE - 2 }, (_, i) => ({
      offerEventId: `unlabeled-${i}`,
      outcome: 'UNKNOWN',
    }))
    mockTradeOutcomeEventFindMany.mockResolvedValue([...labeled, ...unlabeled])
    mockTradeOfferEventFindMany.mockResolvedValue(
      [...labeled, ...unlabeled].map((o) => ({ id: o.offerEventId, featuresJson: {}, acceptProb: 0.5 })),
    )
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10 })

    const metrics = await computeShadowB0(SEASON)

    // Passes the raw 30-row gate (2 + 28 = 30 total rows)...
    expect(metrics).not.toBeNull()
    // ...even though only 2 rows actually carry an accept/reject signal.
    expect(metrics!.observedRate).toBe(1)
  })

  it('gate check: below MIN_RECALIBRATION_SAMPLE raw rows returns null regardless of composition', async () => {
    mockTradeOutcomeEventFindMany.mockResolvedValue(
      Array.from({ length: MIN_RECALIBRATION_SAMPLE - 1 }, (_, i) => ({
        offerEventId: `o-${i}`,
        outcome: 'ACCEPTED',
      })),
    )
    mockTradeOfferEventFindMany.mockResolvedValue([])
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10 })

    const metrics = await computeShadowB0(SEASON)
    expect(metrics).toBeNull()
  })
})

describe('computeSegmentB0s — MIN_SEGMENT_SAMPLE gate (Phase 3 verification)', () => {
  afterEach(() => vi.clearAllMocks())

  it('excludes a segment below MIN_SEGMENT_SAMPLE (50) and includes one at/above it', async () => {
    const belowThresholdCount = MIN_SEGMENT_SAMPLE - 1 // SuperFlex: below gate
    const atThresholdCount = MIN_SEGMENT_SAMPLE // 1QB: exactly at gate

    const sfOutcomes = Array.from({ length: belowThresholdCount }, (_, i) => ({
      offerEventId: `sf-${i}`,
      outcome: i % 2 === 0 ? 'ACCEPTED' : 'REJECTED',
    }))
    const qbOutcomes = Array.from({ length: atThresholdCount }, (_, i) => ({
      offerEventId: `qb-${i}`,
      outcome: i % 2 === 0 ? 'ACCEPTED' : 'REJECTED',
    }))
    mockTradeOutcomeEventFindMany.mockResolvedValue([...sfOutcomes, ...qbOutcomes])

    const sfOffers = sfOutcomes.map((o) => ({ id: o.offerEventId, acceptProb: 0.5, isSuperFlex: true, leagueFormat: null, scoringType: null }))
    const qbOffers = qbOutcomes.map((o) => ({ id: o.offerEventId, acceptProb: 0.5, isSuperFlex: false, leagueFormat: null, scoringType: null }))
    mockTradeOfferEventFindMany.mockResolvedValue([...sfOffers, ...qbOffers])
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10 })

    const segments = await computeSegmentB0s(SEASON)

    expect(segments.find((s) => s.segment === 'SF')).toBeUndefined() // below gate, excluded
    expect(segments.find((s) => s.segment === '1QB')).toBeDefined() // at gate, included
    expect(segments.find((s) => s.segment === '1QB')!.sampleSize).toBe(atThresholdCount)
  })
})
