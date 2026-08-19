/**
 * Integration test for lib/shared-services/waiver/WaiverShadowService.ts —
 * mocks the true external boundaries (buildWaiverDecisionContext,
 * runWaiverAIService, runLegacyWaiverGrader, getManagerBehaviorProfile), same
 * pattern as trade-shadow-service.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WaiverDecisionContext } from '@/lib/shared-services/waiver/WaiverContextAssembler'
import type { ScoredWaiverTarget } from '@/lib/waiver-engine/waiver-scoring'

const {
  mockBuildWaiverDecisionContext,
  mockRunWaiverAIService,
  mockRunLegacyWaiverGrader,
  mockGetManagerBehaviorProfile,
} = vi.hoisted(() => ({
  mockBuildWaiverDecisionContext: vi.fn(),
  mockRunWaiverAIService: vi.fn(),
  mockRunLegacyWaiverGrader: vi.fn(),
  mockGetManagerBehaviorProfile: vi.fn(),
}))

vi.mock('@/lib/shared-services/waiver/WaiverContextAssembler', () => ({
  buildWaiverDecisionContext: mockBuildWaiverDecisionContext,
}))
vi.mock('@/lib/waiver-ai-engine', () => ({ runWaiverAIService: mockRunWaiverAIService }))
vi.mock('@/lib/shared-services/waiver/WaiverRecommendationAdapter', () => ({ runLegacyWaiverGrader: mockRunLegacyWaiverGrader }))
vi.mock('@/lib/shared-services/knowledge-graph/QueryService', () => ({ getManagerBehaviorProfile: mockGetManagerBehaviorProfile }))

import { evaluateWaiverShadow } from '@/lib/shared-services/waiver/WaiverShadowService'
import { InMemoryWaiverShadowResultStore } from '@/lib/shared-services/waiver/WaiverShadowResultStore'

function makeContext(overrides: Partial<WaiverDecisionContext> = {}): WaiverDecisionContext {
  return {
    leagueId: 'league-1',
    rosterId: 'roster-1',
    platform: 'sleeper',
    sport: 'NFL',
    managerKey: 'manager-1',
    assembledAt: new Date().toISOString(),
    engineInput: {
      sport: 'NFL',
      roster: [],
      allLeagueRosters: [],
      currentWeek: 1,
      goal: 'balanced',
      leagueSettings: { isSF: false, isTEP: false, numTeams: 12, isDynasty: true },
      availablePlayers: [],
    } as any,
    faabRemaining: 80,
    waiverPriority: 3,
    waiverType: 'faab',
    faabBudget: 100,
    needs: ['RB'],
    surplus: ['WR'],
    dataCompleteness: { freeAgentPoolSize: 50, valuedFreeAgentCount: 50, rosterPlayerCount: 15, unmatchedValuationCount: 2 },
    ...overrides,
  }
}

function makeTarget(overrides: Partial<ScoredWaiverTarget> = {}): ScoredWaiverTarget {
  return {
    playerId: 'p1',
    playerName: 'Player One',
    position: 'RB',
    team: 'KC',
    age: 24,
    value: 5000,
    compositeScore: 82,
    dimensions: { startNow: 80, stash: 20, needFit: 90, leagueDemand: 60 },
    drivers: [],
    topDrivers: [{ id: 'wa_need_slot', label: 'Fills a need', score: 80, direction: 'positive', detail: 'Fills your weakest slot (RB).' }],
    recommendation: 'Strong Add',
    faabBid: 18,
    priorityRank: 1,
    dropCandidate: null,
    ...overrides,
  }
}

describe('evaluateWaiverShadow', () => {
  let resultStore: InMemoryWaiverShadowResultStore

  beforeEach(() => {
    vi.clearAllMocks()
    resultStore = new InMemoryWaiverShadowResultStore()
    mockGetManagerBehaviorProfile.mockResolvedValue({ status: 'gated', reason: 'insufficient cohort' })
    mockRunLegacyWaiverGrader.mockResolvedValue({
      graderId: 'waiver_recommendation_service',
      topAddPlayerId: 'p1',
      topAddPlayerName: 'Player One',
      faabBid: 15,
      priority: 1,
      confidence: 'medium',
      error: null,
    })
  })

  it('produces a real waiver evaluation reusing runWaiverAIService as the primary value', async () => {
    mockBuildWaiverDecisionContext.mockResolvedValue(makeContext())
    mockRunWaiverAIService.mockResolvedValue({
      sport: 'NFL',
      deterministic: { suggestions: [makeTarget()], basedOn: ['available_players', 'team_needs'] },
      explanation: { source: 'deterministic', text: 'x' },
    })

    const evaluation = await evaluateWaiverShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })

    expect(evaluation.leagueId).toBe('league-1')
    expect(evaluation.rosterId).toBe('roster-1')
    expect(evaluation.platform).toBe('sleeper')
    expect(evaluation.topCandidate).toEqual({ playerId: 'p1', playerName: 'Player One', position: 'RB', team: 'KC' })
    expect(evaluation.recommendation.score).toBe(82) // from runWaiverAIService, the shadow's own primary value
    expect(evaluation.recommendation.tier).toBe('Strong Add')
    expect(evaluation.faab.recommendedBid).toBe(18)
    expect(evaluation.urgency).toBe('high') // Strong Add -> high
    expect(evaluation.rosterImpact).toEqual({ needs: ['RB'], surplus: ['WR'] })

    const logged = await resultStore.all()
    expect(logged).toHaveLength(1)
    expect(logged[0].evaluationId).toBe(evaluation.evaluationId)
  })

  it('logs a real divergence entry when the shadow and legacy grader disagree on the top add', async () => {
    mockBuildWaiverDecisionContext.mockResolvedValue(makeContext())
    mockRunWaiverAIService.mockResolvedValue({
      sport: 'NFL',
      deterministic: { suggestions: [makeTarget({ playerId: 'p2', playerName: 'Player Two' })], basedOn: ['available_players'] },
      explanation: { source: 'deterministic', text: 'x' },
    })

    const evaluation = await evaluateWaiverShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })

    expect(evaluation.divergence).toHaveLength(1)
    expect(evaluation.divergence[0].sameTopAdd).toBe(false)
    expect(evaluation.divergence[0].notes).toContain('Legacy and shadow recommend different top adds.')
  })

  it('reports a null sameTopAdd (not false) when the legacy grader itself failed', async () => {
    mockBuildWaiverDecisionContext.mockResolvedValue(makeContext())
    mockRunWaiverAIService.mockResolvedValue({
      sport: 'NFL',
      deterministic: { suggestions: [makeTarget()], basedOn: ['available_players'] },
      explanation: { source: 'deterministic', text: 'x' },
    })
    mockRunLegacyWaiverGrader.mockResolvedValue({
      graderId: 'waiver_recommendation_service',
      topAddPlayerId: null,
      topAddPlayerName: null,
      faabBid: null,
      priority: null,
      confidence: null,
      error: 'legacy engine exploded',
    })

    const evaluation = await evaluateWaiverShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })

    expect(evaluation.divergence[0].sameTopAdd).toBeNull()
    expect(evaluation.divergence[0].notes).toContain('legacy engine exploded')
  })

  it('handles no qualifying candidate honestly — no fabricated recommendation', async () => {
    mockBuildWaiverDecisionContext.mockResolvedValue(makeContext())
    mockRunWaiverAIService.mockResolvedValue({
      sport: 'NFL',
      deterministic: { suggestions: [], basedOn: ['available_players'] },
      explanation: { source: 'deterministic', text: 'No recommendation.' },
    })

    const evaluation = await evaluateWaiverShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })

    expect(evaluation.topCandidate).toBeNull()
    expect(evaluation.recommendation.score).toBe(0)
    expect(evaluation.urgency).toBe('none')
    expect(evaluation.evidence).toEqual(['No qualifying waiver target was found in the available player pool.'])
  })

  it('reflects an "ok" manager profile honestly when the Knowledge Graph returns real data', async () => {
    mockBuildWaiverDecisionContext.mockResolvedValue(makeContext())
    mockRunWaiverAIService.mockResolvedValue({
      sport: 'NFL',
      deterministic: { suggestions: [makeTarget()], basedOn: ['available_players'] },
      explanation: { source: 'deterministic', text: 'x' },
    })
    mockGetManagerBehaviorProfile.mockResolvedValue({
      status: 'ok',
      data: {
        asOf: new Date(),
        computedAt: new Date(),
        value: { tradeCount: 0, tradeAcceptedCount: 0, tradeRejectedCount: 0, tradeCancelledCount: 0, tradeVetoedCount: 0, tradeAcceptRate: null, waiverClaimCount: 10, waiverWonCount: 7, waiverLostCount: 3, waiverWinRate: 0.7 },
        confidenceEnvelope: { confidence: 0.6, freshness: { computedAt: new Date(), isStale: false }, evidence: [], sampleSize: 10, sourceAttribution: [], risk: 0.4, uncertainty: null },
      },
    })

    const evaluation = await evaluateWaiverShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })

    expect(evaluation.managerTendency.status).toBe('ok')
    expect(evaluation.managerTendency.profile?.value.waiverWinRate).toBe(0.7)
    expect(evaluation.sourceAttribution.managerTendencySource).toBe('knowledge_graph')
  })

  it('never lets a Knowledge Graph failure crash the whole evaluation — reports "unavailable" instead', async () => {
    mockBuildWaiverDecisionContext.mockResolvedValue(makeContext())
    mockRunWaiverAIService.mockResolvedValue({
      sport: 'NFL',
      deterministic: { suggestions: [makeTarget()], basedOn: ['available_players'] },
      explanation: { source: 'deterministic', text: 'x' },
    })
    mockGetManagerBehaviorProfile.mockRejectedValue(new Error('KG store unreachable'))

    const evaluation = await evaluateWaiverShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })

    expect(evaluation.managerTendency.status).toBe('unavailable')
    expect(evaluation.managerTendency.reason).toContain('KG store unreachable')
    expect(evaluation.recommendation.score).toBe(82) // primary value unaffected
  })

  it('propagates a failure from the primary engine (runWaiverAIService) as a rejected promise — expected and safe since nothing live calls this yet', async () => {
    mockBuildWaiverDecisionContext.mockResolvedValue(makeContext())
    mockRunWaiverAIService.mockRejectedValue(new Error('waiver engine exploded'))

    await expect(evaluateWaiverShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })).rejects.toThrow('waiver engine exploded')
    expect(await resultStore.all()).toEqual([])
  })
})
