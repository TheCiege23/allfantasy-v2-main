/**
 * Integration test for lib/shared-services/draft/DraftShadowService.ts —
 * mocks the true external boundaries (buildDraftDecisionContext,
 * computeDraftRecommendation, runLegacyDraftGrader, getManagerBehaviorProfile,
 * getPlayerExposure), same pattern as Trade OS's/Waiver OS's shadow-service
 * tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftDecisionContext } from '@/lib/shared-services/draft/DraftContextAssembler'
import type { RecommendationResult } from '@/lib/draft-helper/RecommendationEngine'

const {
  mockBuildDraftDecisionContext,
  mockComputeDraftRecommendation,
  mockRunLegacyDraftGrader,
  mockGetManagerBehaviorProfile,
  mockGetPlayerExposure,
} = vi.hoisted(() => ({
  mockBuildDraftDecisionContext: vi.fn(),
  mockComputeDraftRecommendation: vi.fn(),
  mockRunLegacyDraftGrader: vi.fn(),
  mockGetManagerBehaviorProfile: vi.fn(),
  mockGetPlayerExposure: vi.fn(),
}))

vi.mock('@/lib/shared-services/draft/DraftContextAssembler', async () => {
  const actual = await vi.importActual<typeof import('@/lib/shared-services/draft/DraftContextAssembler')>(
    '@/lib/shared-services/draft/DraftContextAssembler'
  )
  return { ...actual, buildDraftDecisionContext: mockBuildDraftDecisionContext }
})
vi.mock('@/lib/draft-helper/RecommendationEngine', () => ({ computeDraftRecommendation: mockComputeDraftRecommendation }))
vi.mock('@/lib/shared-services/draft/DraftRecommendationAdapter', () => ({ runLegacyDraftGrader: mockRunLegacyDraftGrader }))
vi.mock('@/lib/shared-services/knowledge-graph/QueryService', () => ({
  getManagerBehaviorProfile: mockGetManagerBehaviorProfile,
  getPlayerExposure: mockGetPlayerExposure,
}))

import { evaluateDraftShadow } from '@/lib/shared-services/draft/DraftShadowService'
import { InMemoryDraftShadowResultStore } from '@/lib/shared-services/draft/DraftShadowResultStore'

function makeContext(overrides: Partial<DraftDecisionContext> = {}): DraftDecisionContext {
  return {
    leagueId: 'league-1',
    rosterId: 'roster-1',
    sessionId: 'session-1',
    platform: 'sleeper',
    sport: 'NFL',
    isDynasty: false,
    isSF: false,
    round: 3,
    pick: 30,
    totalTeams: 12,
    status: 'in_progress',
    draftType: 'snake',
    isDevy: false,
    managerKey: 'manager-1',
    assembledAt: new Date().toISOString(),
    engineInput: {
      available: [{ name: 'Player One', position: 'RB', team: 'KC', adp: 25, byeWeek: null }],
      teamRoster: [],
      rosterSlots: ['RB'],
      round: 3,
      pick: 30,
      totalTeams: 12,
      sport: 'NFL',
      isDynasty: false,
      isSF: false,
      mode: 'needs',
    },
    playerIdByKey: new Map([['player one|rb', 'p1']]),
    dataCompleteness: { availablePoolSize: 1, adpSampleTotal: 40, rosterPickCount: 0, unresolvedPlayerIdCount: 0 },
    ...overrides,
  }
}

function makeRecommendationResult(overrides: Partial<RecommendationResult> = {}): RecommendationResult {
  return {
    recommendation: {
      player: { name: 'Player One', position: 'RB', team: 'KC', adp: 25, byeWeek: null },
      reason: 'Fills your weakest slot',
      confidence: 82,
      needScore: 90,
      adpEdge: 5,
    },
    alternatives: [{ player: { name: 'Player Two', position: 'WR', team: 'SF', adp: 28, byeWeek: null }, reason: 'Solid value', confidence: 60 }],
    reachWarning: null,
    valueWarning: null,
    scarcityInsight: 'RB depth is thinning.',
    stackInsight: null,
    correlationInsight: null,
    formatInsight: null,
    byeNote: null,
    explanation: 'Best available fits your need.',
    evidence: ['ADP 25 at pick 30 — solid value.'],
    caveats: [],
    uncertainty: null,
    ...overrides,
  }
}

describe('evaluateDraftShadow', () => {
  let resultStore: InMemoryDraftShadowResultStore

  beforeEach(() => {
    vi.clearAllMocks()
    resultStore = new InMemoryDraftShadowResultStore()
    mockGetManagerBehaviorProfile.mockResolvedValue({ status: 'gated', reason: 'insufficient cohort' })
    mockGetPlayerExposure.mockResolvedValue({ status: 'gated', reason: 'insufficient cohort' })
    mockRunLegacyDraftGrader.mockResolvedValue({
      graderId: 'ai_opponent_draft',
      topPlayerId: 'p1',
      topPlayerName: 'Player One',
      confidence: 0.7,
      reason: 'Value + roster fit',
      error: null,
    })
  })

  it('produces a real draft evaluation reusing computeDraftRecommendation as the primary value', async () => {
    mockBuildDraftDecisionContext.mockResolvedValue(makeContext())
    mockComputeDraftRecommendation.mockReturnValue(makeRecommendationResult())

    const evaluation = await evaluateDraftShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })

    expect(evaluation.leagueId).toBe('league-1')
    expect(evaluation.rosterId).toBe('roster-1')
    expect(evaluation.platform).toBe('sleeper')
    expect(evaluation.topCandidate).toEqual({ playerId: 'p1', playerName: 'Player One', position: 'RB', team: 'KC' })
    expect(evaluation.recommendation.score).toBe(82) // from computeDraftRecommendation, the shadow's own primary value
    expect(evaluation.draftValue.adp).toBe(25)
    expect(evaluation.scarcityImpact.insight).toBe('RB depth is thinning.')
    expect(evaluation.opportunityCost.alternativesForegone).toEqual(['Player Two (WR)'])

    const logged = await resultStore.all()
    expect(logged).toHaveLength(1)
    expect(logged[0].evaluationId).toBe(evaluation.evaluationId)
  })

  it('logs a real divergence entry when the shadow and legacy grader disagree on the top player', async () => {
    mockBuildDraftDecisionContext.mockResolvedValue(makeContext())
    mockComputeDraftRecommendation.mockReturnValue(
      makeRecommendationResult({ recommendation: { player: { name: 'Player Two', position: 'WR', team: 'SF', adp: 28, byeWeek: null }, reason: 'x', confidence: 70, needScore: 50, adpEdge: 2 } })
    )

    const evaluation = await evaluateDraftShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })

    expect(evaluation.divergence).toHaveLength(1)
    expect(evaluation.divergence[0].sameTopPlayer).toBe(false)
    expect(evaluation.divergence[0].notes).toContain('Legacy and shadow recommend different top players.')
  })

  it('reports a null sameTopPlayer (not false) when the legacy grader itself failed', async () => {
    mockBuildDraftDecisionContext.mockResolvedValue(makeContext())
    mockComputeDraftRecommendation.mockReturnValue(makeRecommendationResult())
    mockRunLegacyDraftGrader.mockResolvedValue({ graderId: 'ai_opponent_draft', topPlayerId: null, topPlayerName: null, confidence: null, reason: null, error: 'legacy engine exploded' })

    const evaluation = await evaluateDraftShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })
    expect(evaluation.divergence[0].sameTopPlayer).toBeNull()
    expect(evaluation.divergence[0].notes).toContain('legacy engine exploded')
  })

  it('handles no qualifying candidate honestly — no fabricated recommendation', async () => {
    mockBuildDraftDecisionContext.mockResolvedValue(makeContext())
    mockComputeDraftRecommendation.mockReturnValue(makeRecommendationResult({ recommendation: null, evidence: [] }))

    const evaluation = await evaluateDraftShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })

    expect(evaluation.topCandidate).toBeNull()
    expect(evaluation.recommendation.score).toBe(0)
    expect(evaluation.evidence).toEqual(['No qualifying draft recommendation was found in the available player pool.'])
  })

  it('reflects an "ok" manager profile and player exposure honestly when the Knowledge Graph returns real data', async () => {
    mockBuildDraftDecisionContext.mockResolvedValue(makeContext())
    mockComputeDraftRecommendation.mockReturnValue(makeRecommendationResult())
    mockGetManagerBehaviorProfile.mockResolvedValue({
      status: 'ok',
      data: {
        asOf: new Date(),
        computedAt: new Date(),
        value: { tradeCount: 0, tradeAcceptedCount: 0, tradeRejectedCount: 0, tradeCancelledCount: 0, tradeVetoedCount: 0, tradeAcceptRate: null, waiverClaimCount: 0, waiverWonCount: 0, waiverLostCount: 0, waiverWinRate: null },
        confidenceEnvelope: { confidence: 0.6, freshness: { computedAt: new Date(), isStale: false }, evidence: [], sampleSize: 10, sourceAttribution: [], risk: 0.4, uncertainty: null },
      },
    })
    mockGetPlayerExposure.mockResolvedValue({
      status: 'ok',
      data: { asOf: new Date(), computedAt: new Date(), value: { exposurePercent: 0.4, leagueCount: 5, rosterCount: 2 }, confidenceEnvelope: { confidence: 0.5, freshness: { computedAt: new Date(), isStale: false }, evidence: [], sampleSize: 5, sourceAttribution: [], risk: 0.5, uncertainty: null } },
    })

    const evaluation = await evaluateDraftShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })

    expect(evaluation.managerTendency.status).toBe('ok')
    expect(evaluation.playerExposure.status).toBe('ok')
    expect(evaluation.sourceAttribution.managerTendencySource).toBe('knowledge_graph')
    expect(evaluation.sourceAttribution.playerExposureSource).toBe('knowledge_graph')
  })

  it('never lets a Knowledge Graph failure crash the whole evaluation — reports "unavailable" instead', async () => {
    mockBuildDraftDecisionContext.mockResolvedValue(makeContext())
    mockComputeDraftRecommendation.mockReturnValue(makeRecommendationResult())
    mockGetManagerBehaviorProfile.mockRejectedValue(new Error('KG store unreachable'))
    mockGetPlayerExposure.mockRejectedValue(new Error('KG store unreachable'))

    const evaluation = await evaluateDraftShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })

    expect(evaluation.managerTendency.status).toBe('unavailable')
    expect(evaluation.playerExposure.status).toBe('unavailable')
    expect(evaluation.recommendation.score).toBe(82) // primary value unaffected
  })

  it('propagates a failure from the primary engine (computeDraftRecommendation) as a thrown error — expected and safe since nothing live calls this yet', async () => {
    mockBuildDraftDecisionContext.mockResolvedValue(makeContext())
    mockComputeDraftRecommendation.mockImplementation(() => {
      throw new Error('recommendation engine exploded')
    })

    await expect(evaluateDraftShadow({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })).rejects.toThrow('recommendation engine exploded')
    expect(await resultStore.all()).toEqual([])
  })
})
