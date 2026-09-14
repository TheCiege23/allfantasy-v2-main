import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ loadFacts: vi.fn(), loadPool: vi.fn(), runDecision: vi.fn() }))

vi.mock('@/lib/decision-os/waiver/loader', () => ({ loadWaiverWorldFacts: h.loadFacts, worldInputFromFacts: () => ({}) }))
vi.mock('@/lib/decision-os/waiver/pool', () => ({ loadWaiverPool: h.loadPool }))
vi.mock('@/lib/decision-os/waiver', () => ({ runWaiverClaimDecision: h.runDecision }))
vi.mock('@/lib/decision-os/waiver/deps', () => ({ buildLiveWaiverDecisionDeps: () => ({}) }))

import { loadWaiverDecisionSlice } from '@/lib/decision-os/grounding/decisionBridge'

/**
 * The waiver bridge's `onClaims` side channel (Chimmy advice receipts, 2026-09-14). The engine's
 * claims go to the sink as produced and NEVER into the slice; a throwing sink never costs the
 * packet its waiver slice; no sink changes nothing.
 */
describe('waiver decision bridge — onClaims side channel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.loadFacts.mockResolvedValue({ sport: 'NFL', rosterId: 'r1', settings: { faabBudget: 100 }, faabRemaining: 80 })
    h.loadPool.mockResolvedValue({ availablePlayers: [{ id: 'sp-row-1', name: 'Jaylen Wright', position: 'RB' }], poolIncomplete: false, leagueRosterCount: 12 })
  })

  const claim = { addPlayerId: 'sp-row-1', addPlayerName: 'Jaylen Wright', position: 'RB', team: 'MIA', dropPlayerId: null, dropPlayerName: null, faabBid: 12, priorityRank: 1, compositeScore: 71, recommendation: 'strong_add', reason: 'Starter out' }
  const decision = {
    decision_id: 'd1',
    decision_type: 'manager.waiver.claim',
    decider_scope: 'user' as const,
    lifecycle_phase: 'active',
    four_answers: { what_happened: 'A starter is out.', why_it_matters: 'Your RB room is thin.', how_confident: 'Medium.', what_to_do: 'Claim Jaylen Wright.' },
    recommended_actions: [claim],
    rule_verdicts: [],
    confidence: 68,
    data_completeness: 90,
    uncertainty_sources: [],
    provenance: { weakest_source: 'sleeper_roster', weakest_trust: 'high' as const },
    automation_capable: false,
    explanation: 'Your RB2 is out for the week.',
    telemetry: { dco_consumed: true, rule_gated: true, decision_object_emitted: true, explainable: true, world_resolution_read_only: true },
  }

  it('🛑 hands the engine’s claims and confidence to the sink; the slice stays text with no ids', async () => {
    h.runDecision.mockResolvedValue({ decision })
    const sink = vi.fn()
    const s = await loadWaiverDecisionSlice({ userId: 'u1', leagueId: 'L1', onClaims: sink })
    expect(sink).toHaveBeenCalledWith([claim], 68)
    expect(s.present).toBe(true)
    expect(JSON.stringify(s)).not.toContain('sp-row-1')
  })

  it('🛑 a sink that throws never costs the packet its slice', async () => {
    h.runDecision.mockResolvedValue({ decision })
    const s = await loadWaiverDecisionSlice({ userId: 'u1', leagueId: 'L1', onClaims: () => { throw new Error('sink down') } })
    expect(s.present).toBe(true)
    expect(s.value?.whatToDo).toBe('Claim Jaylen Wright.')
  })

  it('no sink: unchanged; no decision run (empty pool): the sink is never called', async () => {
    h.runDecision.mockResolvedValue({ decision })
    expect((await loadWaiverDecisionSlice({ userId: 'u1', leagueId: 'L1' })).present).toBe(true)
    h.loadPool.mockResolvedValue({ availablePlayers: [], poolIncomplete: false, leagueRosterCount: 12 })
    const sink = vi.fn()
    await loadWaiverDecisionSlice({ userId: 'u1', leagueId: 'L1', onClaims: sink })
    expect(sink).not.toHaveBeenCalled()
  })

  it('a decision with no confidence number passes null', async () => {
    h.runDecision.mockResolvedValue({ decision: { ...decision, confidence: undefined } })
    const sink = vi.fn()
    await loadWaiverDecisionSlice({ userId: 'u1', leagueId: 'L1', onClaims: sink })
    expect(sink).toHaveBeenCalledWith([claim], null)
  })
})
