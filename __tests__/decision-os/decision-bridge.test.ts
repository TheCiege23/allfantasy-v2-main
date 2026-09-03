import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const { loadInputs, runDecision } = vi.hoisted(() => ({ loadInputs: vi.fn(), runDecision: vi.fn() }))

vi.mock('@/lib/decision-os/lineup/loader', () => ({ loadLineupSetInputs: loadInputs }))
vi.mock('@/lib/decision-os/lineup', () => ({ runLineupSetDecision: runDecision }))
vi.mock('@/lib/decision-os/lineup/deps', () => ({
  productionLineupWorldDeps: () => ({}),
  productionLineupDecisionDeps: () => ({}),
}))

import { loadLineupDecisionSlice } from '@/lib/decision-os/grounding/decisionBridge'

/**
 * ── R2.4 — the producer that RUNS the live lineup engine for the packet ─────────────────────
 *
 * 🛑 THE ENGINE IS RUN, NOT READ, AND THAT WAS FORCED BY MEASUREMENT. R2's spec called for a
 * read-only adapter over stored decision objects; `canonical_decisions` holds ZERO rows in
 * production, so a bridge reading it would return nothing for every league, silently — the
 * `ingestCFBDStats` failure this repo has already paid for once.
 *
 * These tests pin the three absences apart. A bridge that collapses them tells a user to re-sync a
 * league when an operator has switched the feed off, or reports an engine crash as missing data.
 */
describe('R2.4 — the lineup decision bridge', () => {
  beforeEach(() => vi.clearAllMocks())

  const decision = {
    decision_id: 'd1',
    decision_type: 'manager.lineup.set',
    decider_scope: 'user' as const,
    lifecycle_phase: 'in_week',
    four_answers: {
      what_happened: 'One starter is on bye.',
      why_it_matters: 'You would field ten.',
      how_confident: 'High.',
      what_to_do: 'Start Smith.',
    },
    recommended_actions: [
      { playerName: 'Smith', slotLabel: 'RB2', reasonType: 'bye', recommendedAction: 'START', playerId: 'p1' },
    ],
    rule_verdicts: [],
    confidence: 90,
    data_completeness: 100,
    uncertainty_sources: [],
    provenance: { weakest_source: 'sleeper_roster', weakest_trust: 'high' as const },
    automation_capable: true,
    explanation: 'A bye leaves a hole at RB.',
    telemetry: {
      dco_consumed: true,
      rule_gated: true,
      decision_object_emitted: true,
      explainable: true,
      world_resolution_read_only: true,
    },
  }

  it('runs the engine and returns the decision as a present slice', async () => {
    loadInputs.mockResolvedValue({ userId: 'u1', leagueId: 'L1' })
    runDecision.mockResolvedValue({ decision })
    const s = await loadLineupDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(s.present).toBe(true)
    expect(s.value?.whatToDo).toBe('Start Smith.')
    // Named fields only — a generic stringifier would put "[object Object]" into a prompt.
    expect(s.value?.actionSummary).toEqual(['START: Smith at RB2 (bye)'])
    expect(s.servedFrom).toBe('live')
  })

  it('🛑 a NULL loader result is not_synced, NOT an error', async () => {
    // loadLineupSetInputs returns null for an unimported or off-season league — a normal state.
    // Reporting it as a failure would tell the user to file a bug instead of syncing their league.
    loadInputs.mockResolvedValue(null)
    const s = await loadLineupDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(s.present).toBe(false)
    expect(s.gap?.reason).toBe('not_synced')
    expect(runDecision).not.toHaveBeenCalled() // and it must not run the engine on absent inputs
  })

  it('🛑 an engine THROW becomes a gap, never an exception', async () => {
    // The packet's whole contract is that one bad producer does not take the turn down.
    loadInputs.mockResolvedValue({ userId: 'u1', leagueId: 'L1' })
    runDecision.mockRejectedValue(new Error('world resolution exploded'))
    const s = await loadLineupDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(s.present).toBe(false)
    expect(s.gap?.reason).toBe('not_computed')
    expect(s.gap?.detail).toMatch(/world resolution exploded/)
  })

  it('without a user or league it reports not_requested and touches nothing', async () => {
    const s = await loadLineupDecisionSlice({ userId: null, leagueId: 'L1' })
    expect(s.gap?.reason).toBe('not_requested')
    expect(loadInputs).not.toHaveBeenCalled()
  })

  it('⚠ never passes shadow deps — a chat turn must not also run the legacy recommender', async () => {
    // runLineupSetDecision accepts an optional `shadow` that runs the legacy path for parity.
    // Passing it here would double the work for a comparison nothing in this path reads.
    loadInputs.mockResolvedValue({ userId: 'u1', leagueId: 'L1' })
    runDecision.mockResolvedValue({ decision })
    await loadLineupDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(runDecision).toHaveBeenCalledTimes(1)
    expect(runDecision.mock.calls[0][1]).not.toHaveProperty('shadow')
  })
})
