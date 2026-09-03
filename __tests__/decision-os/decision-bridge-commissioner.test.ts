import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const { assertCommish, loadHealth, runCommish, buildDeps } = vi.hoisted(() => ({
  assertCommish: vi.fn(),
  loadHealth: vi.fn(),
  runCommish: vi.fn(),
  buildDeps: vi.fn(() => ({})),
}))

vi.mock('@/lib/league/league-access', () => ({ assertLeagueCommissioner: assertCommish }))
vi.mock('@/lib/commissioner-hub/commissionerHubHealth', () => ({ getCommissionerHubHealthForUser: loadHealth }))
vi.mock('@/lib/decision-os/commissioner-health', () => ({ runCommissionerHealthDecision: runCommish }))
vi.mock('@/lib/decision-os/commissioner-health/deps', () => ({
  buildProductionCommissionerHealthDecisionDeps: buildDeps,
}))
// The lineup half of the module is not under test here, but its imports must still resolve.
vi.mock('@/lib/decision-os/lineup/loader', () => ({ loadLineupSetInputs: vi.fn() }))
vi.mock('@/lib/decision-os/lineup', () => ({ runLineupSetDecision: vi.fn() }))
vi.mock('@/lib/decision-os/lineup/deps', () => ({
  productionLineupWorldDeps: () => ({}),
  productionLineupDecisionDeps: () => ({}),
}))

import { loadCommissionerHealthDecisionSlice } from '@/lib/decision-os/grounding/decisionBridge'

/**
 * ── R2.3 — commissioner health, the one bridged decision that is PERMISSIONED ───────────────
 *
 * Every other slice in the packet is about what we know. This one is also about who may see it,
 * and it is the only bridge where getting the order wrong leaks rather than merely misinforms.
 */
describe('R2.3 — the commissioner health bridge', () => {
  beforeEach(() => vi.clearAllMocks())

  const decision = {
    decision_id: 'c1',
    decision_type: 'commissioner.league.health',
    decider_scope: 'commissioner' as const,
    lifecycle_phase: 'in_season',
    four_answers: {
      what_happened: 'Two teams have not set a lineup in three weeks.',
      why_it_matters: 'Abandoned teams distort playoff seeding.',
      how_confident: 'High — measured from live rosters.',
      what_to_do: 'Message both managers, then consider a co-manager.',
    },
    /*
     * 🛑 A `CommissionerHealthAssessment`, NOT a `CommissionerActionSuggestion`.
     * `decideCommissionerHealth` returns `Decision<CommissionerHealthAssessment>`, so each
     * recommended action is a whole assessment that CONTAINS suggestions.
     *
     * ⚠ THIS MOCK WAS ORIGINALLY THE WRONG SHAPE AND EVERY TEST STILL PASSED. tsconfig excludes
     * `__tests__`, so a fabricated mock is never checked against the contract it claims to stand
     * for — a green suite here proves the code agrees with my invention, not with the engine.
     * The same-artifact typecheck pair is what caught it.
     */
    recommended_actions: [
      {
        leagueId: 'L1',
        healthScore: 62,
        engagementScore: 55,
        fairnessScore: 80,
        sustainabilityScore: 70,
        overallStatus: 'at_risk',
        churnRiskScore: 40,
        disputeRiskScore: 10,
        abandonmentRiskScore: 35,
        topAlerts: ['Two teams inactive 3 weeks'],
        recommendations: ['Message both managers'],
        suggestedActions: [{ key: 'nudge', label: 'Message inactive managers', href: '/x', tone: 'urgent' }],
      },
    ],
    rule_verdicts: [],
    confidence: 88,
    data_completeness: 100,
    uncertainty_sources: [],
    provenance: { weakest_source: 'league_rosters', weakest_trust: 'high' as const },
    automation_capable: false,
    explanation: 'Two inactive teams.',
    telemetry: {
      dco_consumed: true,
      rule_gated: true,
      decision_object_emitted: true,
      explainable: true,
      world_resolution_read_only: true,
    },
  }

  const snapshot = { leagueId: 'L1', source: 'database' }

  it('🛑 a NON-COMMISSIONER gets not_entitled, and no health data is ever loaded', async () => {
    // The order is the safeguard, not just the verdict. The loader is handed `isCommissioner: true`
    // and filters on it, so reaching the loader at all for a non-commissioner would hand them a
    // commissioner's view of a league they merely play in.
    assertCommish.mockResolvedValue({ ok: false, status: 403 })
    const s = await loadCommissionerHealthDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(s.present).toBe(false)
    expect(s.gap?.reason).toBe('not_entitled')
    expect(loadHealth).not.toHaveBeenCalled()
    expect(runCommish).not.toHaveBeenCalled()
  })

  it('🛑 REFUSES a dashboard-fallback snapshot — the guard that lives in shadow.ts', async () => {
    // runCommissionerHealthShadow skips this case ("no live roster reads"), but that guard is in
    // the SHADOW wrapper. Calling the decider directly walks past it, so the bridge carries it by
    // hand. Deciding on a fallback snapshot means a confident health verdict from data the live
    // path considers unfit to decide on.
    assertCommish.mockResolvedValue({ ok: true })
    loadHealth.mockResolvedValue([{ leagueId: 'L1', source: 'dashboard-fallback' }])
    const s = await loadCommissionerHealthDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(s.present).toBe(false)
    expect(s.gap?.reason).toBe('not_synced')
    expect(runCommish).not.toHaveBeenCalled()
  })

  it('runs the engine for a commissioner and carries the four answers', async () => {
    assertCommish.mockResolvedValue({ ok: true })
    loadHealth.mockResolvedValue([snapshot])
    runCommish.mockResolvedValue({ decision })
    const s = await loadCommissionerHealthDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(s.present).toBe(true)
    expect(s.value?.whatToDo).toMatch(/Message both managers/)
    // Status, score, the alerts a commissioner acts on, and the nested suggestion labels.
    expect(s.value?.actionSummary).toEqual([
      'at_risk · health 62 · alerts: Two teams inactive 3 weeks · suggested: Message inactive managers',
    ])
    // The snapshot is reused, not recomputed — buildProductionCommissionerHealthDecisionDeps wraps it.
    expect(buildDeps).toHaveBeenCalledWith(snapshot)
  })

  it('picks the snapshot for THIS league, not merely the first returned', async () => {
    // The loader returns snapshots for every league the user commissions.
    assertCommish.mockResolvedValue({ ok: true })
    loadHealth.mockResolvedValue([
      { leagueId: 'OTHER', source: 'database' },
      snapshot,
    ])
    runCommish.mockResolvedValue({ decision })
    await loadCommissionerHealthDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(runCommish.mock.calls[0][0].snapshot).toEqual(snapshot)
  })

  it('no snapshot for the league is not_computed, and an engine throw is a gap not an exception', async () => {
    assertCommish.mockResolvedValue({ ok: true })
    loadHealth.mockResolvedValue([])
    const a = await loadCommissionerHealthDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(a.gap?.reason).toBe('not_computed')

    loadHealth.mockResolvedValue([snapshot])
    runCommish.mockRejectedValue(new Error('health engine exploded'))
    const b = await loadCommissionerHealthDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(b.present).toBe(false)
    expect(b.gap?.detail).toMatch(/health engine exploded/)
  })

  it('⚠ never passes shadow deps', async () => {
    assertCommish.mockResolvedValue({ ok: true })
    loadHealth.mockResolvedValue([snapshot])
    runCommish.mockResolvedValue({ decision })
    await loadCommissionerHealthDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(runCommish.mock.calls[0][1]).not.toHaveProperty('shadow')
  })
})
