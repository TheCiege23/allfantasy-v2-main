import { describe, it, expect } from 'vitest'
import { evaluateCommissionerHealthRules, deriveCommissionerRiskScores } from '@/lib/decision-os/commissioner-health/rules'
import { fakeSnapshot, fakeCriticalSnapshot } from './commissionerHealthFakes'

describe('commissioner-health risk derivation (from the snapshot memo, not recomputed)', () => {
  it('derives churn from sustainability and abandonment from inactive teams', () => {
    const r = deriveCommissionerRiskScores(fakeSnapshot({ sustainabilityScore: 76, metrics: { ...fakeSnapshot().metrics, inactiveTeams: 1 } }))
    expect(r.churnRiskScore).toBe(24) // 100 - 76
    expect(r.abandonmentRiskScore).toBe(15) // abandoned 0 *30 + inactive 1 *15
    expect(r.disputeRiskScore).toBe(0)
  })
})

describe('commissioner-health rules — return-style, assessment not legality', () => {
  it('a healthy league emits no attention verdicts', () => {
    const verdicts = evaluateCommissionerHealthRules(fakeSnapshot())
    expect(verdicts).toEqual([])
  })

  it('NEVER emits an illegal verdict (health is assessed, not illegal)', () => {
    const verdicts = evaluateCommissionerHealthRules(fakeCriticalSnapshot())
    expect(verdicts.some((v) => v.verdict === 'illegal')).toBe(false)
    expect(verdicts.every((v) => v.verdict === 'requires_approval')).toBe(true)
  })

  it('maps critical-status thresholds to the expected categories', () => {
    const verdicts = evaluateCommissionerHealthRules(fakeCriticalSnapshot())
    const rules = verdicts.map((v) => v.rule)
    expect(rules).toContain('commissioner.health.league_health_critical')
    expect(rules).toContain('commissioner.health.engagement_low')
    expect(rules).toContain('commissioner.health.abandoned_teams')
    expect(rules).toContain('commissioner.health.inactive_managers')
    expect(rules).toContain('commissioner.health.abandonment_risk_high')
    expect(rules).toContain('commissioner.health.low_data_confidence')
  })
})
