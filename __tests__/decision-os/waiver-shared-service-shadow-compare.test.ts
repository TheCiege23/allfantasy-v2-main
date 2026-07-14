/**
 * Tests for lib/decision-os/waiver/sharedServiceShadowCompare.ts — Phase 12.
 * Mocks the true external boundaries (loadWaiverWorldFacts, evaluateWaiverShadow,
 * emitShadowParity), same pattern as every shared-services integration test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WaiverAIServiceInput, WaiverAIServiceOutput } from '@/lib/waiver-ai-engine'

const { mockLoadWaiverWorldFacts, mockEvaluateWaiverShadow, mockEmitShadowParity } = vi.hoisted(() => ({
  mockLoadWaiverWorldFacts: vi.fn(),
  mockEvaluateWaiverShadow: vi.fn(),
  mockEmitShadowParity: vi.fn(),
}))

vi.mock('@/lib/decision-os/waiver/loader', () => ({ loadWaiverWorldFacts: mockLoadWaiverWorldFacts }))
vi.mock('@/lib/shared-services/waiver/WaiverShadowService', () => ({ evaluateWaiverShadow: mockEvaluateWaiverShadow }))
vi.mock('@/lib/decision-os/core/parity', () => ({ emitShadowParity: mockEmitShadowParity }))

import { runSharedWaiverShadowCompare, shouldRunSharedWaiverShadowCompare } from '@/lib/decision-os/waiver/sharedServiceShadowCompare'

const BASE_FACTS = {
  sport: 'NFL',
  leagueId: 'league-1',
  rosterId: 'roster-1',
  settings: {} as never,
  settingsKnown: true,
  faabRemaining: 80,
  waiverPriority: 3,
  rosterSize: 15,
}

function makeEngineInput(overrides: Partial<WaiverAIServiceInput> = {}): WaiverAIServiceInput {
  return {
    sport: 'NFL',
    leagueSettings: {},
    availablePlayers: [],
    ...overrides,
  }
}

function makeLegacyAnalysis(suggestions: WaiverAIServiceOutput['deterministic']['suggestions']): WaiverAIServiceOutput {
  return { sport: 'NFL', deterministic: { suggestions, basedOn: ['available_players'] }, explanation: { source: 'deterministic', text: 'x' } }
}

function makeSuggestion(overrides: Partial<WaiverAIServiceOutput['deterministic']['suggestions'][number]> = {}) {
  return {
    playerId: 'p1',
    playerName: 'Player One',
    position: 'RB',
    team: 'KC',
    age: 24,
    value: 5000,
    compositeScore: 80,
    dimensions: { startNow: 80, stash: 20, needFit: 90, leagueDemand: 60 },
    drivers: [],
    topDrivers: [],
    recommendation: 'Strong Add' as const,
    faabBid: 20,
    priorityRank: 1,
    dropCandidate: null,
    ...overrides,
  }
}

function makeEvaluation(overrides: Record<string, unknown> = {}) {
  return {
    evaluationId: 'eval-1',
    leagueId: 'league-1',
    rosterId: 'roster-1',
    platform: 'sleeper',
    evaluatedAt: '2026-01-01T00:00:00.000Z',
    topCandidate: { playerId: 'p1', playerName: 'Player One', position: 'RB', team: 'KC' },
    recommendation: { score: 80, tier: 'Strong Add', dropCandidate: null },
    faab: { recommendedBid: 20, faabRemaining: 80, faabBudget: 100 },
    priority: { rank: 1, waiverType: 'faab' },
    rosterImpact: { needs: [], surplus: [] },
    managerTendency: { status: 'unavailable', reason: null, profile: null },
    urgency: 'high',
    confidence: 75,
    evidence: [],
    risk: { level: 'low', flags: [] },
    uncertainty: [],
    freshness: { contextAssembledAt: '2026-01-01T00:00:00.000Z', managerProfileComputedAt: null },
    sourceAttribution: { contextProvider: 'sleeper', managerTendencySource: 'unavailable' },
    divergence: [],
    ...overrides,
  }
}

describe('shouldRunSharedWaiverShadowCompare', () => {
  it('is disabled when the flag is absent', () => {
    expect(shouldRunSharedWaiverShadowCompare({})).toBe(false)
  })

  it('is disabled for any value other than the literal string "true"', () => {
    expect(shouldRunSharedWaiverShadowCompare({ SHARED_SERVICES_WAIVER_SHADOW_COMPARE: 'yes' })).toBe(false)
    expect(shouldRunSharedWaiverShadowCompare({ SHARED_SERVICES_WAIVER_SHADOW_COMPARE: '1' })).toBe(false)
  })

  it('is enabled when explicitly set to "true" (case-insensitive)', () => {
    expect(shouldRunSharedWaiverShadowCompare({ SHARED_SERVICES_WAIVER_SHADOW_COMPARE: 'true' })).toBe(true)
    expect(shouldRunSharedWaiverShadowCompare({ SHARED_SERVICES_WAIVER_SHADOW_COMPARE: 'TRUE' })).toBe(true)
  })
})

describe('runSharedWaiverShadowCompare', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadWaiverWorldFacts.mockResolvedValue(BASE_FACTS)
  })

  it('reports insufficient_context honestly when no roster can be resolved for this authorized user', async () => {
    mockLoadWaiverWorldFacts.mockResolvedValue(null)
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([]),
      authoritativeDurationMs: 50,
    })
    expect(result.status).toBe('insufficient_context')
    expect(result.ran).toBe(false)
    expect(mockEvaluateWaiverShadow).not.toHaveBeenCalled()
  })

  it('resolves rosterId via loadWaiverWorldFacts, never from client-supplied identifiers', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation())
    await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion()]),
      authoritativeDurationMs: 50,
    })
    expect(mockLoadWaiverWorldFacts).toHaveBeenCalledWith('user-1', 'league-1')
    // Phase 15: identity (leagueId/rosterId) is still server-resolved via loadWaiverWorldFacts,
    // never client-supplied — currentWeek/goal/maxResults now also cross the boundary
    // (extracted from the request, not identity) so both engines evaluate the same decision context.
    expect(mockEvaluateWaiverShadow).toHaveBeenCalledWith({ leagueId: 'league-1', rosterId: 'roster-1', currentWeek: 1, goal: 'balanced', maxResults: 10 })
  })

  it('classifies exact_match when both legacy and shared agree there is no candidate', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation({ topCandidate: null }))
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([]),
      authoritativeDurationMs: 50,
    })
    expect(result.status).toBe('exact_match')
    expect(result.topCandidateAgreement).toBe(true)
  })

  it('classifies material_divergence for a one-sided empty result', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation({ topCandidate: null }))
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion()]),
      authoritativeDurationMs: 50,
    })
    expect(result.status).toBe('material_divergence')
    expect(result.topCandidateAgreement).toBe(false)
  })

  it('classifies equivalent when the top candidate agrees exactly', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation())
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion({ playerId: 'p1' })]),
      authoritativeDurationMs: 50,
    })
    expect(result.status).toBe('equivalent')
    expect(result.topCandidateAgreement).toBe(true)
    expect(result.scoreDelta).toBe(0)
    expect(result.faabDelta).toBe(0)
  })

  it('classifies acceptable_variance when the shared top candidate appears lower in the legacy ranked list', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation({ topCandidate: { playerId: 'p2', playerName: 'Player Two', position: 'WR', team: 'SF' } }))
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion({ playerId: 'p1' }), makeSuggestion({ playerId: 'p2', playerName: 'Player Two' })]),
      authoritativeDurationMs: 50,
    })
    expect(result.status).toBe('acceptable_variance')
    expect(result.candidateOverlap).toBe(true)
    expect(result.topCandidateAgreement).toBe(false)
  })

  it('classifies material_divergence when the shared top candidate is absent from the legacy ranked list entirely', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation({ topCandidate: { playerId: 'p99', playerName: 'Unknown', position: 'WR', team: 'SF' } }))
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion({ playerId: 'p1' })]),
      authoritativeDurationMs: 50,
    })
    expect(result.status).toBe('material_divergence')
    expect(result.candidateOverlap).toBe(false)
  })

  it('computes a real score/FAAB delta when the top candidates differ', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation({ recommendation: { score: 60, tier: 'Add', dropCandidate: null }, faab: { recommendedBid: 10, faabRemaining: 80, faabBudget: 100 } }))
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion({ compositeScore: 80, faabBid: 25 })]),
      authoritativeDurationMs: 50,
    })
    expect(result.scoreDelta).toBe(20)
    expect(result.faabDelta).toBe(15)
  })

  it('reports shadow_execution_failure honestly (never a fabricated empty-result match) when the shared service throws', async () => {
    mockEvaluateWaiverShadow.mockRejectedValue(new Error('context assembly failed'))
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion()]),
      authoritativeDurationMs: 50,
    })
    expect(result.status).toBe('shadow_execution_failure')
    expect(result.failureReason).toBe('context assembly failed')
  })

  it('reports shadow_execution_failure on a real timeout without hanging the test', async () => {
    mockEvaluateWaiverShadow.mockImplementation(() => new Promise(() => {})) // never resolves
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion()]),
      authoritativeDurationMs: 50,
    })
    expect(result.status).toBe('shadow_execution_failure')
    expect(result.failureReason).toContain('timed out')
  }, 10000)

  it('never throws when loadWaiverWorldFacts itself throws', async () => {
    mockLoadWaiverWorldFacts.mockRejectedValue(new Error('db unreachable'))
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([]),
      authoritativeDurationMs: 50,
    })
    expect(result.status).toBe('shadow_execution_failure')
    expect(result.failureReason).toBe('db unreachable')
  })

  it('emits shadow-parity telemetry using the existing emitDecisionTelemetry-backed convention, with no secrets/tokens/raw payloads', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation())
    await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion()]),
      authoritativeDurationMs: 50,
    })
    expect(mockEmitShadowParity).toHaveBeenCalledWith(
      'shared_services.waiver',
      expect.objectContaining({ compare: true, ran: true, leagueId: 'league-1' })
    )
    const [, flags] = mockEmitShadowParity.mock.calls[0]
    const serialized = JSON.stringify(flags)
    expect(serialized).not.toMatch(/token|password|authorization|cookie/i)
  })

  it('Phase 15: telemetry captures the exact decision context both engines were evaluated with, plus a comparison version', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation())
    await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput({ currentWeek: 9, goal: 'rebuild', maxResults: 12 }),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion()]),
      authoritativeDurationMs: 50,
    })
    const [, flags] = mockEmitShadowParity.mock.calls[0]
    expect(flags).toMatchObject({ comparisonVersion: 'phase15-decision-context', currentWeek: 9, goal: 'rebuild', maxResults: 12 })
  })

  it('Phase 15: the returned result exposes the exact request context used, not just telemetry', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation())
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput({ currentWeek: 6, goal: 'win-now', maxResults: 7 }),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion()]),
      authoritativeDurationMs: 50,
    })
    expect(result.requestContext).toEqual({ currentWeek: 6, goal: 'win-now', maxResults: 7 })
  })

  it('Phase 15: telemetry still carries the comparison version on every failure path, not only the success path', async () => {
    mockLoadWaiverWorldFacts.mockRejectedValue(new Error('db down'))
    await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion()]),
      authoritativeDurationMs: 50,
    })
    const [, flags] = mockEmitShadowParity.mock.calls[0]
    expect(flags).toMatchObject({ comparisonVersion: 'phase15-decision-context' })
  })

  it('flags a sport mismatch honestly instead of presenting it as a real recommendation divergence', async () => {
    mockLoadWaiverWorldFacts.mockResolvedValue({ ...BASE_FACTS, sport: 'NBA' })
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation())
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput({ sport: 'NFL' }),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion()]),
      authoritativeDurationMs: 50,
    })
    expect(result.unsupportedReason).toContain('does not match')
  })

  it('reports timing for both the authoritative call (passed in) and the shared-service call', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation())
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion()]),
      authoritativeDurationMs: 123,
    })
    expect(result.authoritativeDurationMs).toBe(123)
    expect(result.sharedServiceDurationMs).toBeGreaterThanOrEqual(0)
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(result.sharedServiceDurationMs ?? 0)
  })

  it('handles a canonical Sleeper-provider context identically to the default fixture', async () => {
    mockLoadWaiverWorldFacts.mockResolvedValue({ ...BASE_FACTS, sport: 'NFL' })
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation({ platform: 'sleeper' }))
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion()]),
      authoritativeDurationMs: 50,
    })
    expect(result.provider).toBe('sleeper')
    expect(result.status).toBe('equivalent')
  })

  it('handles a non-Sleeper canonical provider (ESPN) with no provider-specific branching in this seam', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation({ platform: 'espn' }))
    const result = await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput(),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion()]),
      authoritativeDurationMs: 50,
    })
    expect(result.provider).toBe('espn')
    expect(result.status).toBe('equivalent')
  })

  it('never leaks provider-specific or league/waiver context fields into the shared-service call — only identity + request context cross the boundary (Phase 15)', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue(makeEvaluation())
    await runSharedWaiverShadowCompare({
      userId: 'user-1',
      leagueId: 'league-1',
      engineInput: makeEngineInput({ sport: 'NFL', leagueSettings: { isSF: true }, currentWeek: 4, goal: 'win-now', maxResults: 15 }),
      legacyAnalysis: makeLegacyAnalysis([makeSuggestion()]),
      authoritativeDurationMs: 50,
    })
    expect(mockEvaluateWaiverShadow).toHaveBeenCalledWith({ leagueId: 'league-1', rosterId: 'roster-1', currentWeek: 4, goal: 'win-now', maxResults: 15 })
    const callArgs = mockEvaluateWaiverShadow.mock.calls[0][0]
    // Exactly identity (leagueId/rosterId) + the 3 real request-context fields — never
    // sport/leagueSettings/roster/availablePlayers, which remain independently DB-assembled.
    expect(Object.keys(callArgs).sort()).toEqual(['currentWeek', 'goal', 'leagueId', 'maxResults', 'rosterId'])
  })
})
