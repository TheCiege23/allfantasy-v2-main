/**
 * Direct coverage of buildTradeLearningDiagnostics()
 * (lib/trade-engine/diagnostics.ts), the read-only assembly function behind
 * GET /api/admin/trade-learning/diagnostics. Proves it correctly derives
 * maturity/divergence/scheduler status from stored TradeLearningStats state
 * without performing any writes, and fails safe when the reused
 * calibration-health computation errors.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockTradeLearningStatsFindUnique, mockComputeCalibrationHealth } = vi.hoisted(() => ({
  mockTradeLearningStatsFindUnique: vi.fn(),
  mockComputeCalibrationHealth: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tradeLearningStats: { findUnique: mockTradeLearningStatsFindUnique },
  },
}))

vi.mock('@/lib/trade-engine/calibration-metrics', () => ({
  computeCalibrationHealth: mockComputeCalibrationHealth,
}))

import { buildTradeLearningDiagnostics } from '@/lib/trade-engine/diagnostics'

const SEASON = 2025

describe('buildTradeLearningDiagnostics', () => {
  afterEach(() => vi.clearAllMocks())

  it('reports the flag as disabled by default', async () => {
    mockTradeLearningStatsFindUnique.mockResolvedValue(null)
    mockComputeCalibrationHealth.mockResolvedValue(null)

    const diag = await buildTradeLearningDiagnostics(SEASON, {})

    expect(diag.operational.weeklyRecalibrationEnabled).toBe(false)
    expect(diag.operational.envVar).toBe('TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED')
  })

  it('reports the flag as enabled when explicitly set to "true"', async () => {
    mockTradeLearningStatsFindUnique.mockResolvedValue(null)
    mockComputeCalibrationHealth.mockResolvedValue(null)

    const diag = await buildTradeLearningDiagnostics(SEASON, { TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED: 'true' })

    expect(diag.operational.weeklyRecalibrationEnabled).toBe(true)
  })

  it('handles a completely empty TradeLearningStats row (no prior run ever) with safe defaults, no crash', async () => {
    mockTradeLearningStatsFindUnique.mockResolvedValue(null)
    mockComputeCalibrationHealth.mockResolvedValue(null)

    const diag = await buildTradeLearningDiagnostics(SEASON, {})

    expect(diag.calibratedB0.current).toBe(-1.10) // DEFAULT_B0
    expect(diag.shadow.pending).toBe(false)
    expect(diag.shadow.shadowB0).toBeNull()
    expect(diag.promotion.hasEverBeenPromoted).toBe(false)
    expect(diag.scheduler.lastRecalibrationAt).toBeNull()
    expect(diag.scheduler.wouldRunIfInvokedNow).toBe(true) // never run before -> would run now
    expect(diag.scheduler.skipReasonIfAny).toBeNull()
    expect(diag.segments).toBeNull()
    expect(diag.drift).toBeNull()
  })

  it('reports a mature shadow (8 days old) as isMature=true', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    mockTradeLearningStatsFindUnique.mockResolvedValue({
      calibratedB0: -1.10,
      shadowB0: -1.30,
      shadowB0ComputedAt: eightDaysAgo,
      shadowB0SampleSize: 40,
    })
    mockComputeCalibrationHealth.mockResolvedValue(null)

    const diag = await buildTradeLearningDiagnostics(SEASON, {})

    expect(diag.shadow.pending).toBe(true)
    expect(diag.shadow.isMature).toBe(true)
    expect(diag.shadow.ageDays).toBeGreaterThanOrEqual(7)
    expect(diag.shadow.divergenceFromActive).toBeCloseTo(0.2, 5)
    expect(diag.shadow.withinDivergenceCap).toBe(true) // 0.2 <= 0.40
  })

  it('reports an immature shadow (2 days old) as isMature=false', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    mockTradeLearningStatsFindUnique.mockResolvedValue({
      calibratedB0: -1.10,
      shadowB0: -1.30,
      shadowB0ComputedAt: twoDaysAgo,
      shadowB0SampleSize: 40,
    })
    mockComputeCalibrationHealth.mockResolvedValue(null)

    const diag = await buildTradeLearningDiagnostics(SEASON, {})

    expect(diag.shadow.isMature).toBe(false)
  })

  it('reports withinDivergenceCap=false when the shadow diverges beyond the cap', async () => {
    mockTradeLearningStatsFindUnique.mockResolvedValue({
      calibratedB0: -1.10,
      shadowB0: -1.90, // divergence 0.80, exceeds MAX_SHADOW_DIVERGENCE (0.40)
      shadowB0ComputedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      shadowB0SampleSize: 40,
    })
    mockComputeCalibrationHealth.mockResolvedValue(null)

    const diag = await buildTradeLearningDiagnostics(SEASON, {})

    expect(diag.shadow.divergenceFromActive).toBeCloseTo(0.8, 5)
    expect(diag.shadow.withinDivergenceCap).toBe(false)
  })

  it('reports wouldRunIfInvokedNow=false with a skip reason when the cadence gate has not elapsed', async () => {
    mockTradeLearningStatsFindUnique.mockResolvedValue({
      calibratedB0: -1.10,
      lastRecalibrationAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    })
    mockComputeCalibrationHealth.mockResolvedValue(null)

    const diag = await buildTradeLearningDiagnostics(SEASON, {})

    expect(diag.scheduler.wouldRunIfInvokedNow).toBe(false)
    expect(diag.scheduler.skipReasonIfAny).toMatch(/last recalibration ran/)
  })

  it('reports hasEverBeenPromoted=true and the promoted B0 from calibrationHistory', async () => {
    mockTradeLearningStatsFindUnique.mockResolvedValue({
      calibratedB0: -1.30,
      calibrationHistory: [
        { timestamp: '2026-06-01T00:00:00.000Z', oldB0: -1.10, newB0: -1.30, sampleSize: 40, source: 'auto-recalibration' },
      ],
    })
    mockComputeCalibrationHealth.mockResolvedValue(null)

    const diag = await buildTradeLearningDiagnostics(SEASON, {})

    expect(diag.promotion.hasEverBeenPromoted).toBe(true)
    expect(diag.promotion.lastPromotedAt).toBe('2026-06-01T00:00:00.000Z')
    expect(diag.promotion.lastPromotedB0).toBe(-1.30)
  })

  it('fails safe (calibrationHealth: null) when the reused computeCalibrationHealth() call throws', async () => {
    mockTradeLearningStatsFindUnique.mockResolvedValue(null)
    mockComputeCalibrationHealth.mockRejectedValue(new Error('boom'))

    const diag = await buildTradeLearningDiagnostics(SEASON, {})

    expect(diag.calibrationHealth).toBeNull()
  })
})
