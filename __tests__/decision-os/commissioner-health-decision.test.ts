import { describe, it, expect, vi } from 'vitest'
import { buildCommissionerHealthDCO } from '@/lib/decision-os/commissioner-health/dco'
import { resolveCommissionerHealthWorld } from '@/lib/decision-os/commissioner-health/world'
import { decideCommissionerHealth } from '@/lib/decision-os/commissioner-health/decision'
import { toCommissionerHealthCard } from '@/lib/decision-os/commissioner-health/healthCardAdapter'
import { assertFourAnswers } from '@/lib/decision-os/core/decision'
import { registerDecisionTelemetrySink } from '@/lib/decision-os/core/telemetry'
import { fakeSnapshot, fakeCriticalSnapshot, fakeDecisionDeps } from './commissionerHealthFakes'

const dco = (snapshot = fakeSnapshot()) =>
  buildCommissionerHealthDCO({ world: resolveCommissionerHealthWorld({ snapshot }), userId: 'commish-1' })

describe('commissioner-health DCO (commissioner scope)', () => {
  it('is commissioner-scoped with honest completeness', () => {
    const d = dco()
    expect(d.decision_type).toBe('commissioner.league.health')
    expect(d.decider_scope).toBe('commissioner')
    expect(d.data_completeness).toBe(100)
  })

  it('drops completeness for the dashboard-fallback source', () => {
    const d = dco(fakeSnapshot({ source: 'dashboard-fallback', dataConfidence: 'low' }))
    expect(d.data_completeness).toBe(50)
    expect(d.provenance.weakest_trust).toBe('low')
  })
})

describe('commissioner-health decision — consumes only DCO + injected deps', () => {
  it('emits a complete, rule-gated, commissioner-scoped Decision (automation_capable:false)', async () => {
    const emitted: unknown[] = []
    registerDecisionTelemetrySink((e) => emitted.push(e))
    const decision = await decideCommissionerHealth(dco(), fakeDecisionDeps())
    expect(() => assertFourAnswers(decision)).not.toThrow()
    expect(decision.decision_type).toBe('commissioner.league.health')
    expect(decision.decider_scope).toBe('commissioner')
    expect(decision.automation_capable).toBe(false)
    expect(decision.recommended_actions[0].healthScore).toBe(78)
    expect(decision.recommended_actions[0].overallStatus).toBe('healthy')
    expect(decision.telemetry.world_resolution_read_only).toBe(true)
    expect(emitted.length).toBeGreaterThan(0)
    registerDecisionTelemetrySink(null)
  })

  it('uses ONLY deterministic score fields — prose summary never affects the decision', async () => {
    const a = await decideCommissionerHealth(dco(), fakeDecisionDeps({ evaluate: async () => fakeSnapshot({ summary: 'prose A' }) }))
    const b = await decideCommissionerHealth(dco(), fakeDecisionDeps({ evaluate: async () => fakeSnapshot({ summary: 'totally different prose B' }) }))
    expect(b.recommended_actions).toEqual(a.recommended_actions)
    expect(b.four_answers).toEqual(a.four_answers)
  })

  it('surfaces critical health as requires_approval verdicts (never illegal), shapes what_to_do', async () => {
    const decision = await decideCommissionerHealth(dco(fakeCriticalSnapshot()), fakeDecisionDeps({ evaluate: async () => fakeCriticalSnapshot() }))
    expect(decision.rule_verdicts.some((v) => v.rule === 'commissioner.health.league_health_critical')).toBe(true)
    expect(decision.rule_verdicts.some((v) => v.verdict === 'illegal')).toBe(false)
    expect(decision.four_answers.what_to_do).toContain('replacement')
  })

  it('treats actions as READ-ONLY navigation suggestions (no execution fields)', async () => {
    const decision = await decideCommissionerHealth(dco(), fakeDecisionDeps())
    const actions = decision.recommended_actions[0].suggestedActions
    expect(actions[0]).toMatchObject({ key: 'settings', href: '/league/L1?tab=Settings' })
    expect(Object.keys(actions[0])).toEqual(['key', 'label', 'href', 'tone']) // suggestion only, no execute()
  })

  it('the card adapter renders purely from the Decision and is readOnly', async () => {
    const decision = await decideCommissionerHealth(dco(), fakeDecisionDeps())
    const card = toCommissionerHealthCard(decision)
    expect(card.readOnly).toBe(true)
    expect(card.healthScore).toBe(78)
    expect(card.title.length).toBeGreaterThan(0)
  })

  it('the evaluator is a pure function of injected deps (no DB)', async () => {
    const evaluate = vi.fn(async () => fakeSnapshot())
    await decideCommissionerHealth(dco(), fakeDecisionDeps({ evaluate }))
    expect(evaluate).toHaveBeenCalledTimes(1)
  })
})
