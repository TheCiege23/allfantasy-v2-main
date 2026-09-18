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
    /* The pool's whole contract: the bridge reads the roster, the slots and the traits too (2026-09-17). */
    h.loadPool.mockResolvedValue({
      availablePlayers: [{ id: 'sp-row-1', name: 'Jaylen Wright', position: 'RB', team: 'MIA', age: 23, value: 1400 }],
      myRoster: [{ id: 'r-1', name: 'My RB', position: 'RB', team: 'BUF', slot: 'bench', age: 26, value: 900 }],
      leagueRosters: [{ players: [] }],
      rosterPositions: ['QB', 'RB', 'WR', 'BN'],
      leagueTraits: { numTeams: 12, isSF: false, isTEP: false, isDynasty: false },
      currentWeek: 3,
      byeWeekByClub: { MIA: 6 },
      teamNeeds: { weakestSlots: [], biggestNeed: null, byeWeekClusters: [{ week: 6, playersOut: ['My RB'], positionsAffected: ['RB'], severity: 'minor' }], positionalDepth: [], dropCandidates: [] },
      poolIncomplete: false,
      leagueRosterCount: 12,
      pricing: { priced: 1, total: 1, basis: 'redraft, 1QB, 12 teams, 0.5 PPR' },
    })
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

  /*
   * 🛑 THE INPUT IS THE FIX. The engine could never recommend anything because this bridge passed
   * `availablePlayers` alone: prices are what let the scorer rank, the asker's slotted roster is what
   * lets it name a drop, and the league's rosters are the median behind "your weakest slot".
   */
  it('🛑 hands the engine the priced wire, the asker’s roster and the league’s rosters', async () => {
    h.runDecision.mockResolvedValue({ decision })
    await loadWaiverDecisionSlice({ userId: 'u1', leagueId: 'L1' })

    expect(h.loadPool).toHaveBeenCalledWith('L1', 'NFL', 'r1')
    const input = h.runDecision.mock.calls[0][0]
    expect(input.engineInput.availablePlayers[0]).toMatchObject({ name: 'Jaylen Wright', value: 1400 })
    expect(input.engineInput.roster).toEqual([
      { id: 'r-1', name: 'My RB', position: 'RB', team: 'BUF', slot: 'bench', age: 26, value: 900 },
    ])
    expect(input.engineInput.allLeagueRosters).toEqual([{ players: [] }])
    expect(input.engineInput.rosterPositions).toEqual(['QB', 'RB', 'WR', 'BN'])
    expect(input.engineInput.leagueSettings).toMatchObject({ numTeams: 12, isSF: false, isTEP: false, isDynasty: false, faabRemaining: 80 })
    expect(input.engineInput.currentWeek).toBe(3)
    expect(input.pricing).toEqual({ priced: 1, total: 1, basis: 'redraft, 1QB, 12 teams, 0.5 PPR' })
    /* This season's byes, so the advice warns about the right weeks (the table it replaced was 2025). */
    expect(input.engineInput.teamNeeds?.byeWeekClusters?.[0]?.week).toBe(6)
  })

  it('leaves the week out rather than sending week 1 when no projection week is on file', async () => {
    /* Week 1 would put every bye two weeks away and boost the wrong players. */
    h.runDecision.mockResolvedValue({ decision })
    h.loadPool.mockResolvedValue({
      availablePlayers: [{ id: 'a', name: 'A', position: 'RB', team: null, age: null, value: 900 }],
      myRoster: [],
      leagueRosters: [{ players: [] }],
      rosterPositions: [],
      leagueTraits: { numTeams: 12, isSF: false, isTEP: false, isDynasty: false },
      currentWeek: null,
      poolIncomplete: false,
      leagueRosterCount: 12,
      pricing: { priced: 1, total: 1, basis: 'redraft, 1QB, 12 teams, 0.5 PPR' },
    })
    await loadWaiverDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect('currentWeek' in h.runDecision.mock.calls[0][0].engineInput).toBe(false)
  })

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
    h.loadPool.mockResolvedValue({
      availablePlayers: [],
      myRoster: [],
      leagueRosters: [{ players: [] }],
      rosterPositions: [],
      leagueTraits: { numTeams: 12, isSF: false, isTEP: false, isDynasty: false },
      currentWeek: null,
      poolIncomplete: false,
      leagueRosterCount: 12,
      pricing: { priced: 0, total: 0, basis: null },
    })
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
