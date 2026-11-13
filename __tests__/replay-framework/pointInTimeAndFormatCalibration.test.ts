import { describe, expect, it } from 'vitest'
import { checkTradeReplayPointInTimeEvidence } from '@/lib/replay-framework/pointInTimeEvidence'
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

  it('requires explicit approval for the exact model version before production promotion', () => {
    expect(calibrationPromotionAllowed({} as NodeJS.ProcessEnv)).toBe(false)
    expect(calibrationPromotionAllowed({ TRADE_ENGINE_CALIBRATION_PROMOTION_VERSION: 'old-model' } as NodeJS.ProcessEnv)).toBe(false)
    expect(calibrationPromotionAllowed({ TRADE_ENGINE_CALIBRATION_PROMOTION_VERSION: TRADE_MODEL_VERSION } as NodeJS.ProcessEnv)).toBe(true)
  })
})
