import { describe, expect, it } from 'vitest'
import { hasVerifiedBestBallRuleConfiguration } from '@/lib/best-ball-war-room/bestBallRuleEvidence'

describe('Best Ball rule provenance', () => {
  it('rejects an imported Sleeper record with Best Ball mode but no explicit rule flags', () => {
    expect(hasVerifiedBestBallRuleConfiguration({ best_ball: 1, waiver_type: 2, pick_trading: 1 })).toBe(false)
  })

  it('rejects a partial rule record instead of defaulting missing permissions to disabled', () => {
    expect(hasVerifiedBestBallRuleConfiguration({ best_ball_settings: { waiversEnabled: true } })).toBe(false)
  })

  it('accepts explicit false as verified and supports nested canonical settings', () => {
    expect(hasVerifiedBestBallRuleConfiguration({ best_ball_settings: { waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false } })).toBe(true)
    expect(hasVerifiedBestBallRuleConfiguration({ best_ball_settings: { bestBall: { waiversEnabled: true, tradesEnabled: false, substitutionsEnabled: true } } })).toBe(true)
  })
})
