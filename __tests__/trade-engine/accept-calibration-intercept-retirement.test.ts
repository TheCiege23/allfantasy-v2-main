/**
 * Verifies the ownership transition implemented per
 * docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md:
 *
 *   - runFullCalibration() no longer shifts calibratedB0 via the hardcoded
 *     OBSERVED_ACCEPT_RATE constant (calibrateInterceptFromOutcomes()).
 *   - calibrateInterceptFromOutcomes() itself remains fully intact, exported,
 *     and independently callable — it is disconnected from the default
 *     orchestration, not deleted.
 *   - calibrateFromFeedback() (the real, TradeFeedback-driven half of
 *     runFullCalibration()) is completely unaffected.
 *
 * Companion to __tests__/trade-engine/auto-recalibration-promote-shadow-b0.test.ts,
 * which proves promoteShadowB0() is the one remaining calibratedB0 writer.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const {
  mockLeagueTradeFindMany,
  mockTradeFeedbackFindMany,
  mockTradeLearningStatsFindUnique,
  mockTradeLearningStatsUpsert,
} = vi.hoisted(() => ({
  mockLeagueTradeFindMany: vi.fn(),
  mockTradeFeedbackFindMany: vi.fn(),
  mockTradeLearningStatsFindUnique: vi.fn(),
  mockTradeLearningStatsUpsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTrade: { findMany: mockLeagueTradeFindMany },
    tradeFeedback: { findMany: mockTradeFeedbackFindMany },
    tradeLearningStats: {
      findUnique: mockTradeLearningStatsFindUnique,
      upsert: mockTradeLearningStatsUpsert,
    },
  },
}))

import {
  runFullCalibration,
  calibrateInterceptFromOutcomes,
  calibrateFromFeedback,
} from '@/lib/trade-engine/accept-calibration'

const SEASON = 2025

function makeEligibleTrades(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    valueGiven: 1000,
    valueReceived: 1000 + i, // small spread, keeps predicted probability mid-range
    analysisResult: { percentDiff: 5, marketContext: { isConsolidation: false } },
  }))
}

function makeEligibleFeedback(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    rating: i % 2 === 0 ? 5 : 1,
    aiGrade: i % 2 === 0 ? 'strong accept' : 'reject',
    youGive: [],
    youReceive: [],
  }))
}

describe('runFullCalibration — intercept calibration retired, feedback calibration unaffected', () => {
  afterEach(() => vi.clearAllMocks())

  it('does NOT write calibratedB0 even when ≥30 analyzed LeagueTrade rows exist (the condition that used to trigger the hardcoded-constant shift)', async () => {
    mockLeagueTradeFindMany.mockResolvedValue(makeEligibleTrades(40))
    mockTradeFeedbackFindMany.mockResolvedValue([]) // feedback ineligible too, isolates the intercept path
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10 })

    const result = await runFullCalibration(SEASON)

    expect(result.intercept.adjusted).toBe(false)
    expect(result.intercept.newB0).toBe(-1.10) // unchanged, read verbatim from current stats
    expect(result.feedback.adjusted).toBe(false)
    // No write of any kind happened — calibratedB0 was never touched.
    expect(mockTradeLearningStatsUpsert).not.toHaveBeenCalled()
    // Confirms the retirement: LeagueTrade rows were never even queried, since
    // the retired path no longer runs calibrateInterceptFromOutcomes() at all.
    expect(mockLeagueTradeFindMany).not.toHaveBeenCalled()
  })

  it('still calls calibrateFromFeedback(), and its resulting write never includes calibratedB0', async () => {
    mockLeagueTradeFindMany.mockResolvedValue(makeEligibleTrades(40)) // would have been fake-calibration-eligible
    mockTradeFeedbackFindMany.mockResolvedValue(makeEligibleFeedback(12)) // feedback-eligible
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10, feedbackWeightAdj: null })
    mockTradeLearningStatsUpsert.mockResolvedValue({})

    const result = await runFullCalibration(SEASON)

    expect(result.intercept.adjusted).toBe(false)
    expect(result.intercept.newB0).toBe(-1.10)
    expect(result.feedback.adjusted).toBe(true)

    // Feedback calibration DID write — but never touched calibratedB0.
    expect(mockTradeLearningStatsUpsert).toHaveBeenCalledTimes(1)
    const upsertArgs = mockTradeLearningStatsUpsert.mock.calls[0][0]
    expect(upsertArgs.update).not.toHaveProperty('calibratedB0')
    expect(upsertArgs.create).not.toHaveProperty('calibratedB0')
    expect(upsertArgs.update).toHaveProperty('feedbackWeightAdj')

    // And, again, the retired path never even queries LeagueTrade rows.
    expect(mockLeagueTradeFindMany).not.toHaveBeenCalled()
  })

  it('calibrateInterceptFromOutcomes() remains directly callable and still produces its original (fake-constant-based) result — disconnected, not deleted', async () => {
    mockLeagueTradeFindMany.mockResolvedValue(makeEligibleTrades(40))
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10, calibrationHistory: [] })
    mockTradeLearningStatsUpsert.mockResolvedValue({})

    const result = await calibrateInterceptFromOutcomes(SEASON)

    expect(result.adjusted).toBe(true)
    expect(result.sampleSize).toBe(40)
    // The function itself is fully intact: called directly, it still queries
    // LeagueTrade and still writes calibratedB0 exactly as before.
    expect(mockLeagueTradeFindMany).toHaveBeenCalledTimes(1)
    expect(mockTradeLearningStatsUpsert).toHaveBeenCalledTimes(1)
    const upsertArgs = mockTradeLearningStatsUpsert.mock.calls[0][0]
    expect(upsertArgs.update).toHaveProperty('calibratedB0')
  })

  it('calibrateFromFeedback() in isolation is unchanged: still adjusts w1/w3/w6 from real TradeFeedback rows', async () => {
    mockTradeFeedbackFindMany.mockResolvedValue(makeEligibleFeedback(12))
    mockTradeLearningStatsFindUnique.mockResolvedValue({ feedbackWeightAdj: null })
    mockTradeLearningStatsUpsert.mockResolvedValue({})

    const result = await calibrateFromFeedback(SEASON)

    expect(result.adjusted).toBe(true)
    expect(result.feedbackAdj).not.toBeNull()
    expect(mockTradeLearningStatsUpsert).toHaveBeenCalledTimes(1)
    const upsertArgs = mockTradeLearningStatsUpsert.mock.calls[0][0]
    expect(upsertArgs.update).toHaveProperty('feedbackWeightAdj')
    expect(upsertArgs.update).not.toHaveProperty('calibratedB0')
  })
})
