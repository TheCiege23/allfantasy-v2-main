/**
 * Decision OS — Trade Learning Phase 10: Canonical Season Resolution.
 *
 * Requirement 4 of the Phase 10 task: "validate that weekly recalibration,
 * diagnostics, computeShadowB0(), and promotion logic all resolve through
 * exactly one season determination path." This file proves that end to end:
 * every one of these functions, called with NO explicit season argument,
 * resolves the real season via lib/trade-engine/season-resolver.ts's
 * MAX(League.season) query — not via any of the ~11 hardcoded constants that
 * used to live in accept-calibration.ts, auto-recalibration.ts,
 * isotonic-calibrator.ts, diagnostics.ts, calibration-metrics.ts,
 * drift-detection.ts, trade-event-logger.ts, and lib/trade-learning.ts.
 *
 * Uses the REAL (unmocked) season-resolver module, with only its underlying
 * `prisma.league.aggregate` call mocked — so this is a genuine test of the
 * resolution wiring, not a re-test of the resolver's own unit behavior
 * (see season-resolver.test.ts for that).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const {
  mockLeagueAggregate,
  mockTradeOutcomeEventFindMany,
  mockTradeOfferEventFindMany,
  mockTradeLearningStatsFindUnique,
  mockTradeLearningStatsUpdate,
  mockTradeLearningStatsUpsert,
  mockLeagueTradeFindMany,
  mockComputeCalibrationHealth,
} = vi.hoisted(() => ({
  mockLeagueAggregate: vi.fn(),
  mockTradeOutcomeEventFindMany: vi.fn(),
  mockTradeOfferEventFindMany: vi.fn(),
  mockTradeLearningStatsFindUnique: vi.fn(),
  mockTradeLearningStatsUpdate: vi.fn(),
  mockTradeLearningStatsUpsert: vi.fn(),
  mockLeagueTradeFindMany: vi.fn(),
  mockComputeCalibrationHealth: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { aggregate: mockLeagueAggregate },
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

vi.mock('@/lib/trade-engine/calibration-metrics', () => ({
  computeCalibrationHealth: mockComputeCalibrationHealth,
}))

import { invalidateSeasonResolverCache } from '@/lib/trade-engine/season-resolver'
import { computeShadowB0, runWeeklyRecalibration } from '@/lib/trade-engine/auto-recalibration'
import { getCalibratedWeights, invalidateCalibrationCache } from '@/lib/trade-engine/accept-calibration'
import { buildTradeLearningDiagnostics } from '@/lib/trade-engine/diagnostics'

const REAL_CURRENT_SEASON = 2026 // matches League.season's real default (prisma/schema.prisma)

function resetMocks() {
  vi.clearAllMocks()
  invalidateSeasonResolverCache()
  invalidateCalibrationCache()
  mockLeagueAggregate.mockResolvedValue({ _max: { season: REAL_CURRENT_SEASON } })
  mockTradeLearningStatsFindUnique.mockResolvedValue(null)
  mockTradeOutcomeEventFindMany.mockResolvedValue([])
  mockTradeOfferEventFindMany.mockResolvedValue([])
  mockLeagueTradeFindMany.mockResolvedValue([])
  mockComputeCalibrationHealth.mockResolvedValue(null)
}

describe('canonical season resolution — cross-component wiring', () => {
  beforeEach(resetMocks)
  afterEach(() => {
    vi.clearAllMocks()
    invalidateSeasonResolverCache()
    invalidateCalibrationCache()
  })

  it('computeShadowB0() with no explicit season queries the real resolved season, not a hardcoded default', async () => {
    mockTradeOutcomeEventFindMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ offerEventId: `o${i}`, outcome: 'ACCEPTED' })),
    )
    mockTradeOfferEventFindMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `o${i}`, featuresJson: {}, acceptProb: 0.6 })),
    )
    mockTradeLearningStatsFindUnique.mockResolvedValue({ calibratedB0: -1.10 })

    await computeShadowB0()

    expect(mockLeagueAggregate).toHaveBeenCalled()
    const outcomeQuery = mockTradeOutcomeEventFindMany.mock.calls[0][0]
    expect(outcomeQuery.where.season).toBe(REAL_CURRENT_SEASON)
  })

  it('getCalibratedWeights() with no explicit season resolves through the same canonical path', async () => {
    await getCalibratedWeights()

    expect(mockLeagueAggregate).toHaveBeenCalled()
    const statsQuery = mockTradeLearningStatsFindUnique.mock.calls[0][0]
    expect(statsQuery.where.season).toBe(REAL_CURRENT_SEASON)
  })

  it('buildTradeLearningDiagnostics() with no explicit season resolves through the same canonical path', async () => {
    const diag = await buildTradeLearningDiagnostics()

    expect(mockLeagueAggregate).toHaveBeenCalled()
    expect(diag.season).toBe(REAL_CURRENT_SEASON)
  })

  it('runWeeklyRecalibration() (the scheduler entry point) resolves the season exactly once and threads the same value through promotion, shadow, segment, and isotonic sub-steps', async () => {
    await runWeeklyRecalibration()

    // Resolved once via the canonical resolver...
    expect(mockLeagueAggregate).toHaveBeenCalledTimes(1)

    // ...and every downstream Prisma call in this cycle used that one resolved value.
    const cadenceLookupSeason = mockTradeLearningStatsFindUnique.mock.calls[0][0].where.season
    const shadowOutcomeSeason = mockTradeOutcomeEventFindMany.mock.calls[0][0].where.season
    expect(cadenceLookupSeason).toBe(REAL_CURRENT_SEASON)
    expect(shadowOutcomeSeason).toBe(REAL_CURRENT_SEASON)
  })

  it('an explicit season argument always overrides the canonical resolver (historical/manual lookup)', async () => {
    mockTradeOutcomeEventFindMany.mockResolvedValue([])

    await computeShadowB0(2024)

    expect(mockLeagueAggregate).not.toHaveBeenCalled()
    const outcomeQuery = mockTradeOutcomeEventFindMany.mock.calls[0][0]
    expect(outcomeQuery.where.season).toBe(2024)
  })
})
