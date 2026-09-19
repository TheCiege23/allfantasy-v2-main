import { describe, expect, it } from 'vitest'
import { checkTradeReplayPointInTimeEvidence } from '@/lib/replay-framework/pointInTimeEvidence'
import { calibrateTradeOutcomesByFormat } from '@/lib/replay-framework/metrics/formatOutcomeCalibration'
import { calibrationPromotionAllowed } from '@/lib/trade-engine/auto-recalibration'
import { TRADE_MODEL_VERSION } from '@/lib/replay-framework/versioning'

const payload = (observedAt?: string) => ({
  assetsGiven: [{ name: 'A', value: 100, type: 'player', observedAt }],
  assetsReceived: [{ name: 'B', value: 100, type: 'player', observedAt }],
})

describe('historical trade replay safeguards', () => {
  it('accepts evidence captured at or before the trade and rejects future information', () => {
    const decision = new Date('2025-10-01T12:00:00Z')
    expect(checkTradeReplayPointInTimeEvidence(payload('2025-10-01T11:59:00Z'), decision).eligible).toBe(true)
    expect(checkTradeReplayPointInTimeEvidence(payload('2025-10-02T00:00:00Z'), decision)).toMatchObject({ eligible: false })
    expect(checkTradeReplayPointInTimeEvidence(payload(), decision)).toMatchObject({ eligible: false })
  })

  it('calibrates formats separately and reports playoff versus survival error', () => {
    const rows = calibrateTradeOutcomesByFormat([
      { format: 'redraft', predictedSuccess: 0.8, actualSuccess: 1, predictedPlayoffProbabilityDelta: 0.2, actualPlayoffOutcomeDelta: 0.1 },
      { format: 'guillotine', predictedSuccess: 0.4, actualSuccess: 0, predictedSurvivalProbabilityDelta: 0.3, actualSurvivalOutcomeDelta: 0.1 },
    ], 2)
    expect(rows.find((row) => row.format === 'redraft')).toMatchObject({ sampleSize: 1, playoffDeltaMae: 0.1, survivalDeltaMae: null, promotionEligible: false })
    const guillotine = rows.find((row) => row.format === 'guillotine')!
    expect(guillotine).toMatchObject({ sampleSize: 1, playoffDeltaMae: null, promotionEligible: false })
    expect(guillotine.survivalDeltaMae).toBeCloseTo(0.2)
  })

  it('requires explicit approval for the exact model version before production promotion', () => {
    expect(calibrationPromotionAllowed({} as NodeJS.ProcessEnv)).toBe(false)
    expect(calibrationPromotionAllowed({ TRADE_ENGINE_CALIBRATION_PROMOTION_VERSION: 'old-model' } as NodeJS.ProcessEnv)).toBe(false)
    expect(calibrationPromotionAllowed({ TRADE_ENGINE_CALIBRATION_PROMOTION_VERSION: TRADE_MODEL_VERSION } as NodeJS.ProcessEnv)).toBe(true)
  })
})
