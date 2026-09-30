/**
 * runTradeCalibrationPass — the scheduled home of the calibration cycle that the retired
 * /api/internal/analyze-trades pipeline used to run. Three properties are pinned:
 *
 *   1. the three steps run in the retired pipeline's order, on the resolved season;
 *   2. each step is isolated — one throwing is recorded and the rest still run;
 *   3. the budget gates ADMISSION of each step: with none, nothing runs and every step says so.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runFullCalibration: vi.fn(),
  runDriftDetection: vi.fn(),
  logAcceptedTradesAsOutcomes: vi.fn(),
  resolveCurrentTradeLearningSeason: vi.fn(),
}))

vi.mock('@/lib/trade-engine/accept-calibration', () => ({ runFullCalibration: mocks.runFullCalibration }))
vi.mock('@/lib/trade-engine/drift-detection', () => ({ runDriftDetection: mocks.runDriftDetection }))
vi.mock('@/lib/trade-engine/trade-event-logger', () => ({ logAcceptedTradesAsOutcomes: mocks.logAcceptedTradesAsOutcomes }))
vi.mock('@/lib/trade-engine/season-resolver', () => ({
  resolveCurrentTradeLearningSeason: mocks.resolveCurrentTradeLearningSeason,
}))

import { runTradeCalibrationPass } from '@/lib/trade-engine/calibrationPass'

describe('runTradeCalibrationPass', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveCurrentTradeLearningSeason.mockResolvedValue(2026)
    mocks.runFullCalibration.mockResolvedValue({ intercept: { newB0: -1.1, sampleSize: 0, adjusted: false }, feedback: { adjusted: true } })
    mocks.runDriftDetection.mockResolvedValue({ overallSeverity: 'warning' })
    mocks.logAcceptedTradesAsOutcomes.mockResolvedValue(7)
  })

  it('runs calibration, drift, then outcomes, on the resolved season', async () => {
    const order: string[] = []
    mocks.runFullCalibration.mockImplementationOnce(async () => (order.push('calibration'), { intercept: { newB0: -1.1, sampleSize: 0, adjusted: false }, feedback: { adjusted: true } }))
    mocks.runDriftDetection.mockImplementationOnce(async () => (order.push('drift'), { overallSeverity: 'warning' }))
    mocks.logAcceptedTradesAsOutcomes.mockImplementationOnce(async () => (order.push('outcomes'), 7))

    const result = await runTradeCalibrationPass({ budgetMs: 60_000 })

    expect(order).toEqual(['calibration', 'drift', 'outcomes'])
    expect(mocks.runFullCalibration).toHaveBeenCalledWith(2026)
    expect(mocks.runDriftDetection).toHaveBeenCalledWith(2026)
    expect(mocks.logAcceptedTradesAsOutcomes).toHaveBeenCalledWith(2026)
    expect(result).toEqual({
      ran: true,
      season: 2026,
      feedbackAdjusted: true,
      driftSeverity: 'warning',
      outcomesLogged: 7,
      errors: [],
    })
  })

  it('an explicit season wins over the resolver', async () => {
    await runTradeCalibrationPass({ budgetMs: 60_000, season: 2025 })

    expect(mocks.resolveCurrentTradeLearningSeason).not.toHaveBeenCalled()
    expect(mocks.runDriftDetection).toHaveBeenCalledWith(2025)
  })

  it('one step throwing is recorded and the others still run', async () => {
    mocks.runDriftDetection.mockRejectedValueOnce(new Error('stats row missing'))

    const result = await runTradeCalibrationPass({ budgetMs: 60_000 })

    expect(result.feedbackAdjusted).toBe(true)
    expect(result.driftSeverity).toBeNull()
    expect(result.outcomesLogged).toBe(7)
    expect(result.errors).toEqual(['drift: stats row missing'])
  })

  it('with no budget, no step is admitted and each says so', async () => {
    const result = await runTradeCalibrationPass({ budgetMs: 0 })

    expect(mocks.runFullCalibration).not.toHaveBeenCalled()
    expect(mocks.runDriftDetection).not.toHaveBeenCalled()
    expect(mocks.logAcceptedTradesAsOutcomes).not.toHaveBeenCalled()
    expect(result.errors).toEqual([
      'calibration skipped: no budget',
      'drift skipped: no budget',
      'outcomes skipped: no budget',
    ])
  })
})
