/**
 * Trade Learning Activation Readiness — verification only.
 *
 * Companion to docs/TRADE_LEARNING_ACTIVATION_BLOCKERS.md (Decision OS Closed-Loop
 * Learning Audit, Step 0). This file originally proved that `computeShadowB0()`
 * (and therefore `runWeeklyRecalibration()`) could not be activated safely,
 * because `computeObservedAcceptRate()` compared `TradeOutcomeEvent.outcome`
 * against the lowercase strings 'accepted'/'completed' while the real Prisma
 * `TradeOutcome` enum only ever stores 'ACCEPTED' | 'REJECTED' | 'EXPIRED' |
 * 'COUNTERED' | 'UNKNOWN' (schema.prisma:14339-14345) — every real row failed
 * the match, so the "observed accept rate" from 100% real ACCEPTED outcomes
 * was silently 0, not 1.
 *
 * That bug is now fixed in `lib/trade-engine/auto-recalibration.ts`. These
 * tests now assert the CORRECT behavior through `computeShadowB0()`'s public
 * surface. See auto-recalibration-observed-accept-rate.test.ts for exhaustive,
 * direct coverage of `computeObservedAcceptRate()` itself.
 *
 * `runWeeklyRecalibration()` remains uncalled in production — this file does
 * not activate it, add cron wiring, or change any request path.
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

import { computeShadowB0 } from '@/lib/trade-engine/auto-recalibration'

const SEASON = 2025

function makeOutcomes(count: number, outcome: 'ACCEPTED' | 'REJECTED') {
  return Array.from({ length: count }, (_, i) => ({
    offerEventId: `offer-${i}`,
    outcome,
  }))
}

function makeOffers(count: number, acceptProb: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `offer-${i}`,
    featuresJson: {},
    acceptProb,
  }))
}

describe('Trade Learning activation readiness — computeShadowB0 real-enum behavior (FIXED)', () => {
  afterEach(() => vi.clearAllMocks())

  it('FIXED: 40 real ACCEPTED outcomes (100% acceptance) now correctly read a 1.0 observed rate and push B0 upward, not downward', async () => {
    mockTradeOutcomeEventFindMany.mockResolvedValue(makeOutcomes(40, 'ACCEPTED'))
    mockTradeOfferEventFindMany.mockResolvedValue(makeOffers(40, 0.5))
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10 })

    const metrics = await computeShadowB0(SEASON)

    expect(metrics).not.toBeNull()
    expect(metrics!.observedRate).toBe(1)
    expect(metrics!.logOddsCorrection).toBeGreaterThan(0)
    expect(metrics!.computedB0).toBeGreaterThan(metrics!.currentActiveB0)
  })

  it('FIXED: the same 40 outcomes tagged REJECTED (truly 0% acceptance) now correctly read a 0.0 observed rate and push B0 downward — no longer identical to the ACCEPTED case above', async () => {
    mockTradeOutcomeEventFindMany.mockResolvedValue(makeOutcomes(40, 'REJECTED'))
    mockTradeOfferEventFindMany.mockResolvedValue(makeOffers(40, 0.5))
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10 })

    const metrics = await computeShadowB0(SEASON)

    expect(metrics).not.toBeNull()
    expect(metrics!.observedRate).toBe(0)
    expect(metrics!.logOddsCorrection).toBeLessThan(0)
    expect(metrics!.computedB0).toBeLessThan(metrics!.currentActiveB0)
  })
})
