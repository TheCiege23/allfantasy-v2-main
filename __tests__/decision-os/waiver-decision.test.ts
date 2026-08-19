import { describe, it, expect, vi } from 'vitest'
import { buildWaiverDCO } from '@/lib/decision-os/waiver/dco'
import { decideWaiverClaim } from '@/lib/decision-os/waiver/decision'
import { toWaiverCard } from '@/lib/decision-os/waiver/waiverCardAdapter'
import { assertFourAnswers } from '@/lib/decision-os/core/decision'
import { registerDecisionTelemetrySink } from '@/lib/decision-os/core/telemetry'
import { fakeWorld, fakeEngineInput, fakeAnalysis, fakeSuggestion, fakeDecisionDeps } from './waiverFakes'

const dco = (poolIncomplete = false) =>
  buildWaiverDCO({
    world: fakeWorld(),
    userId: 'u1',
    leagueId: 'L1',
    sport: 'NFL',
    rosterId: 'roster-1',
    engineInput: fakeEngineInput(),
    poolIncomplete,
  })

describe('waiver DCO', () => {
  it('carries the engine input + resource context, read-only honest completeness', () => {
    const d = dco()
    expect(d.decision_type).toBe('manager.waiver.claim')
    expect(d.engineInput.availablePlayers.length).toBeGreaterThan(0)
    expect(d.claim_context.faabRemaining).toBe(60)
    expect(d.data_completeness).toBe(100)
  })

  it('drops completeness + adds uncertainty when the pool is incomplete', () => {
    const d = dco(true)
    expect(d.data_completeness).toBeLessThan(100)
    expect(d.provenance.weakest_trust).toBe('low')
  })
})

describe('waiver decision — consumes only the DCO + injected deps, four answers, wraps recommender', () => {
  it('emits a complete, rule-gated Decision with all four answers', async () => {
    const emitted: unknown[] = []
    registerDecisionTelemetrySink((e) => emitted.push(e))
    const decision = await decideWaiverClaim(dco(), fakeDecisionDeps())
    expect(() => assertFourAnswers(decision)).not.toThrow()
    expect(decision.decision_type).toBe('manager.waiver.claim')
    expect(decision.recommended_actions[0].addPlayerId).toBe('wp1')
    expect(decision.recommended_actions[0].dropPlayerName).toBe('Bench Guy')
    expect(decision.telemetry).toMatchObject({ dco_consumed: true, rule_gated: true, world_resolution_read_only: true })
    expect(emitted.length).toBeGreaterThan(0)
    registerDecisionTelemetrySink(null)
  })

  it('uses ONLY deterministic suggestions — identical output whether explanation is deterministic or AI', async () => {
    const detDecision = await decideWaiverClaim(dco(), fakeDecisionDeps({ recommend: async () => fakeAnalysis([fakeSuggestion()], 'deterministic') }))
    const aiDecision = await decideWaiverClaim(dco(), fakeDecisionDeps({ recommend: async () => fakeAnalysis([fakeSuggestion()], 'ai') }))
    expect(aiDecision.recommended_actions).toEqual(detDecision.recommended_actions)
    expect(aiDecision.four_answers).toEqual(detDecision.four_answers)
  })

  it('a thrown eligibility violation surfaces as an illegal verdict and shapes what_to_do', async () => {
    const decision = await decideWaiverClaim(dco(), fakeDecisionDeps({
      ruleDeps: { assertEligibility: async () => { throw new Error('Insufficient FAAB for this bid.') } },
    }))
    expect(decision.rule_verdicts.some((v) => v.rule === 'waiver.legality.insufficient_faab')).toBe(true)
    expect(decision.four_answers.what_to_do).toContain('Insufficient FAAB')
  })

  it('no candidates → still a valid Decision (four answers), confidence bounded', async () => {
    const decision = await decideWaiverClaim(dco(), fakeDecisionDeps({ recommend: async () => fakeAnalysis([]) }))
    expect(() => assertFourAnswers(decision)).not.toThrow()
    expect(decision.recommended_actions).toEqual([])
    expect(decision.confidence).toBeLessThanOrEqual(70)
  })

  it('the card adapter renders purely from the Decision', async () => {
    const decision = await decideWaiverClaim(dco(), fakeDecisionDeps())
    const card = toWaiverCard(decision)
    expect(card.title.length).toBeGreaterThan(0)
    expect(card.topClaim?.addPlayerId).toBe('wp1')
  })

  it('decision recommender is a pure function of injected deps (no DB)', async () => {
    const recommend = vi.fn(async () => fakeAnalysis())
    await decideWaiverClaim(dco(), fakeDecisionDeps({ recommend }))
    expect(recommend).toHaveBeenCalledTimes(1)
  })
})
