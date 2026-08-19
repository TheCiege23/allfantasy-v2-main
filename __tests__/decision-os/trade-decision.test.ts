import { describe, it, expect, vi } from 'vitest'
import { buildTradeDCO } from '@/lib/decision-os/trade/dco'
import { decideTradeEvaluate } from '@/lib/decision-os/trade/decision'
import { toTradeCard } from '@/lib/decision-os/trade/tradeCardAdapter'
import { assertFourAnswers } from '@/lib/decision-os/core/decision'
import { registerDecisionTelemetrySink } from '@/lib/decision-os/core/telemetry'
import { fakeWorld, fakeProposal, fakeAssets, fakeMultiTeamAssets, fakeSnapshot, fakeDecisionDeps } from './tradeFakes'

const dco = (over = {}) =>
  buildTradeDCO({
    world: fakeWorld(),
    userId: 'u1',
    leagueId: 'L1',
    sport: 'NFL',
    proposal: fakeProposal(),
    assets: fakeAssets(),
    snapshotConfidenceScore: 90,
    ...over,
  })

describe('trade DCO (multi-team capable)', () => {
  it('derives 2 participants for a two-team trade → evaluatorSupported', () => {
    const d = dco()
    expect(d.decision_type).toBe('manager.trade.evaluate')
    expect(d.participantCount).toBe(2)
    expect(d.evaluatorSupported).toBe(true)
    expect(d.unsupportedReason).toBeNull()
    expect(d.participants.map((p) => p.rosterId)).toEqual(['rosterA', 'rosterB'])
    expect(d.participants[0].sends).toHaveLength(1)
    expect(d.participants[0].receives).toHaveLength(1)
    expect(d.data_completeness).toBe(90)
  })

  it('derives 3 participants for a 3-team trade → unsupported_by_legacy_evaluator', () => {
    const d = buildTradeDCO({ world: fakeWorld(), userId: 'u1', leagueId: 'L1', sport: 'NFL', proposal: fakeProposal(), assets: fakeMultiTeamAssets(), snapshotConfidenceScore: 90 })
    expect(d.participantCount).toBe(3)
    expect(d.evaluatorSupported).toBe(false)
    expect(d.unsupportedReason).toBe('unsupported_by_legacy_evaluator')
    expect(d.simulation_available).toBe(false)
    expect(d.data_completeness).toBe(20)
    expect(d.provenance.weakest_trust).toBe('unverified')
    expect(d.uncertainty.some((u) => u.includes('3 teams'))).toBe(true)
  })

  it('drops completeness + flags uncertainty when snapshot unavailable', () => {
    const d = buildTradeDCO({ world: fakeWorld({ snapshotAvailable: false }), userId: 'u1', leagueId: 'L1', sport: 'NFL', proposal: fakeProposal(), assets: fakeAssets(), snapshotConfidenceScore: null })
    expect(d.data_completeness).toBe(40)
    expect(d.provenance.weakest_trust).toBe('low')
  })
})

describe('trade decision — consumes only the DCO + injected deps', () => {
  it('emits a complete, rule-gated Decision with all four answers + automation_capable:false', async () => {
    const emitted: unknown[] = []
    registerDecisionTelemetrySink((e) => emitted.push(e))
    const decision = await decideTradeEvaluate(dco(), fakeDecisionDeps())
    expect(() => assertFourAnswers(decision)).not.toThrow()
    expect(decision.decision_type).toBe('manager.trade.evaluate')
    expect(decision.recommended_actions[0].grade).toBe('B+')
    expect(decision.recommended_actions[0].fairnessScore).toBe(82)
    expect(decision.automation_capable).toBe(false)
    expect(decision.telemetry).toMatchObject({ dco_consumed: true, rule_gated: true, world_resolution_read_only: true })
    expect(emitted.length).toBeGreaterThan(0)
    registerDecisionTelemetrySink(null)
  })

  it('uses ONLY deterministic snapshot fields — bullets text never affects the evaluation', async () => {
    const a = await decideTradeEvaluate(dco(), fakeDecisionDeps({ evaluate: async () => fakeSnapshot({ grade: { grade: 'A', valueDifference: 0, fairnessScore: 99, confidenceScore: 95, bullets: ['one'] } }) }))
    const b = await decideTradeEvaluate(dco(), fakeDecisionDeps({ evaluate: async () => fakeSnapshot({ grade: { grade: 'A', valueDifference: 0, fairnessScore: 99, confidenceScore: 95, bullets: ['totally different prose'] } }) }))
    expect(b.recommended_actions).toEqual(a.recommended_actions)
    expect(b.four_answers).toEqual(a.four_answers)
  })

  it('a deadline-passed world surfaces a temporarily_illegal verdict in what_to_do', async () => {
    const decision = await decideTradeEvaluate(dco({ world: fakeWorld({ currentWeek: 14 }) }), fakeDecisionDeps())
    expect(decision.rule_verdicts.some((v) => v.rule === 'trade.legality.trade_deadline_passed')).toBe(true)
    expect(decision.four_answers.what_to_do).toContain('deadline')
  })

  it('the card adapter renders purely from the Decision', async () => {
    const decision = await decideTradeEvaluate(dco(), fakeDecisionDeps())
    const card = toTradeCard(decision)
    expect(card.title.length).toBeGreaterThan(0)
    expect(card.grade).toBe('B+')
    expect(card.proposalId).toBe('prop-1')
  })

  it('the evaluator is a pure function of injected deps (no DB)', async () => {
    const evaluate = vi.fn(async () => fakeSnapshot())
    await decideTradeEvaluate(dco(), fakeDecisionDeps({ evaluate }))
    expect(evaluate).toHaveBeenCalledTimes(1)
  })

  it('per-participant deterministic values are surfaced for a two-team trade', async () => {
    const decision = await decideTradeEvaluate(dco(), fakeDecisionDeps())
    const parts = decision.recommended_actions[0].participants
    expect(parts.map((p) => p.rosterId)).toEqual(['rosterA', 'rosterB'])
    expect(parts[0].sideTotal).toBe(5200)
    expect(parts[1].sideTotal).toBe(4800)
    expect(parts[0].valueDelta).toBe(400)
    expect(parts[1].valueDelta).toBe(-400)
  })
})

const multiDco = () =>
  buildTradeDCO({ world: fakeWorld(), userId: 'u1', leagueId: 'L1', sport: 'NFL', proposal: fakeProposal(), assets: fakeMultiTeamAssets(), snapshotConfidenceScore: 90 })

describe('trade decision — 3+ team (unsupported by legacy evaluator, honest, no crash)', () => {
  it('does NOT crash, answers all four questions, and reports the limitation', async () => {
    const decision = await decideTradeEvaluate(multiDco(), fakeDecisionDeps())
    expect(() => assertFourAnswers(decision)).not.toThrow()
    expect(decision.recommended_actions[0].evaluatorSupported).toBe(false)
    expect(decision.recommended_actions[0].unsupportedReason).toBe('unsupported_by_legacy_evaluator')
    expect(decision.recommended_actions[0].grade).toBeNull()
    expect(decision.recommended_actions[0].participants).toHaveLength(3)
    expect(decision.rule_verdicts.some((v) => v.rule === 'trade.unsupported.multi_team' && v.verdict === 'requires_approval')).toBe(true)
    expect(decision.four_answers.what_happened).toContain('3 teams')
    expect(decision.automation_capable).toBe(false)
    expect(decision.confidence).toBeLessThan(50)
  })

  it('does NOT consume the (incomplete two-team) snapshot for a 3+ team trade', async () => {
    const evaluate = vi.fn(async () => fakeSnapshot())
    await decideTradeEvaluate(multiDco(), fakeDecisionDeps({ evaluate }))
    expect(evaluate).not.toHaveBeenCalled()
  })
})
