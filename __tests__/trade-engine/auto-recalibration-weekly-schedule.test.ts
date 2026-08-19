/**
 * Verifies the operational activation path added per
 * docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md and
 * docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md §7 Step 0:
 *
 *   - isWeeklyRecalibrationEnabled()/runScheduledWeeklyRecalibration() gate
 *     runWeeklyRecalibration() behind TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED,
 *     disabled by default, matching the DECISION_OS_*_LIVE convention.
 *   - promoteShadowB0() is the one remaining writer of calibratedB0, now that
 *     accept-calibration.ts's hardcoded-constant path is retired (see
 *     accept-calibration-intercept-retirement.test.ts).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const {
  mockTradeOutcomeEventFindMany,
  mockTradeOfferEventFindMany,
  mockTradeLearningStatsFindUnique,
  mockTradeLearningStatsUpdate,
  mockTradeLearningStatsUpsert,
  mockLeagueTradeFindMany,
} = vi.hoisted(() => ({
  mockTradeOutcomeEventFindMany: vi.fn(),
  mockTradeOfferEventFindMany: vi.fn(),
  mockTradeLearningStatsFindUnique: vi.fn(),
  mockTradeLearningStatsUpdate: vi.fn(),
  mockTradeLearningStatsUpsert: vi.fn(),
  mockLeagueTradeFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tradeOutcomeEvent: { findMany: mockTradeOutcomeEventFindMany },
    tradeOfferEvent: { findMany: mockTradeOfferEventFindMany },
    tradeLearningStats: {
      findUnique: mockTradeLearningStatsFindUnique,
      update: mockTradeLearningStatsUpdate,
      upsert: mockTradeLearningStatsUpsert,
    },
    leagueTrade: { findMany: mockLeagueTradeFindMany },
  },
}))

import {
  isWeeklyRecalibrationEnabled,
  runScheduledWeeklyRecalibration,
  promoteShadowB0,
} from '@/lib/trade-engine/auto-recalibration'

describe('isWeeklyRecalibrationEnabled — operational flag parsing', () => {
  it('is disabled by default (unset)', () => {
    expect(isWeeklyRecalibrationEnabled({})).toBe(false)
  })

  it('is disabled for any value other than the literal string "true"', () => {
    expect(isWeeklyRecalibrationEnabled({ TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED: 'false' })).toBe(false)
    expect(isWeeklyRecalibrationEnabled({ TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED: '1' })).toBe(false)
    expect(isWeeklyRecalibrationEnabled({ TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED: '' })).toBe(false)
  })

  it('is enabled for "true" (case-insensitive, trimmed), matching the DECISION_OS_*_LIVE convention', () => {
    expect(isWeeklyRecalibrationEnabled({ TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED: 'true' })).toBe(true)
    expect(isWeeklyRecalibrationEnabled({ TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED: 'TRUE' })).toBe(true)
    expect(isWeeklyRecalibrationEnabled({ TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED: '  true  ' })).toBe(true)
  })
})

describe('runScheduledWeeklyRecalibration — respects the operational flag', () => {
  afterEach(() => vi.clearAllMocks())

  it('no-ops with zero Prisma calls when the flag is off', async () => {
    const outcome = await runScheduledWeeklyRecalibration({})

    expect(outcome.ran).toBe(false)
    expect(outcome.reason).toMatch(/disabled/i)
    expect(mockTradeLearningStatsFindUnique).not.toHaveBeenCalled()
    expect(mockTradeOutcomeEventFindMany).not.toHaveBeenCalled()
    expect(mockTradeOfferEventFindMany).not.toHaveBeenCalled()
  })

  it('calls through to the real runWeeklyRecalibration() pipeline when the flag is on', async () => {
    mockTradeLearningStatsFindUnique.mockResolvedValue(null) // no prior stats row — first-ever run
    mockTradeOutcomeEventFindMany.mockResolvedValue([]) // below MIN_RECALIBRATION_SAMPLE, computeShadowB0 skips cleanly
    mockTradeOfferEventFindMany.mockResolvedValue([])
    mockLeagueTradeFindMany.mockResolvedValue([])

    const outcome = await runScheduledWeeklyRecalibration({ TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED: 'true' }, 2025)

    expect(outcome.ran).toBe(true)
    expect(outcome.result).toBeDefined()
    expect(outcome.result!.shadow.computed).toBe(false) // insufficient sample, honestly reported
    // Confirms the real function ran (not skipped) — it actually queried real data.
    expect(mockTradeOutcomeEventFindMany).toHaveBeenCalled()
  })
})

describe('promoteShadowB0 — the one remaining calibratedB0 writer', () => {
  afterEach(() => vi.clearAllMocks())

  it('writes calibratedB0 when a mature, in-divergence shadow value is pending', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    mockTradeLearningStatsFindUnique.mockResolvedValue({
      calibratedB0: -1.10,
      shadowB0: -1.30, // within MAX_SHADOW_DIVERGENCE (0.40) of -1.10
      shadowB0ComputedAt: eightDaysAgo, // older than SHADOW_MATURITY_DAYS (7)
      shadowB0Metrics: { sampleSize: 40, predictedMean: 0.5, observedRate: 0.4 },
      calibrationHistory: [],
    })
    mockTradeLearningStatsUpdate.mockResolvedValue({})

    const result = await promoteShadowB0(2025)

    expect(result.promoted).toBe(true)
    expect(result.newB0).toBe(-1.30)
    expect(mockTradeLearningStatsUpdate).toHaveBeenCalledTimes(1)
    const updateArgs = mockTradeLearningStatsUpdate.mock.calls[0][0]
    expect(updateArgs.data).toHaveProperty('calibratedB0', -1.30)
    expect(updateArgs.data.calibrationHistory[updateArgs.data.calibrationHistory.length - 1].source).toBe('auto-recalibration')
  })

  it('does not write anything when no shadow value is pending', async () => {
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10, shadowB0: null })

    const result = await promoteShadowB0(2025)

    expect(result.promoted).toBe(false)
    expect(mockTradeLearningStatsUpdate).not.toHaveBeenCalled()
  })
})
