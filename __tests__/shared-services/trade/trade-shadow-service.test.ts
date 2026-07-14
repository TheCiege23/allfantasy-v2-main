/**
 * Integration test for lib/shared-services/trade/TradeShadowService.ts —
 * mocks only the true external boundary (buildLeagueDecisionContext, the
 * Phase-4 provider-neutral fetch) plus computeTradeDrivers/gradeTrade (whose
 * own correctness is covered by the pre-existing trade-engine/trade-value
 * suites and this phase's own legacy-grader-adapters test) and the
 * Knowledge Graph's getManagerBehaviorProfile (Phase 3). The real
 * deriveTradeDecisionContext/leagueContextToIntelligence (Phase 4, pure
 * functions) run for real on the mocked context, proving real orchestration.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeagueDecisionContext } from '@/lib/trade-engine/trade-decision-context'

const {
  mockBuildLeagueDecisionContext,
  mockComputeTradeDrivers,
  mockGradeTrade,
  mockGetManagerBehaviorProfile,
} = vi.hoisted(() => ({
  mockBuildLeagueDecisionContext: vi.fn(),
  mockComputeTradeDrivers: vi.fn(),
  mockGradeTrade: vi.fn(),
  mockGetManagerBehaviorProfile: vi.fn(),
}))

vi.mock('@/lib/trade-engine/league-context-assembler', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade-engine/league-context-assembler')>(
    '@/lib/trade-engine/league-context-assembler'
  )
  return {
    ...actual,
    buildLeagueDecisionContext: mockBuildLeagueDecisionContext,
  }
})
vi.mock('@/lib/trade-engine/trade-engine', () => ({ computeTradeDrivers: mockComputeTradeDrivers }))
vi.mock('@/lib/trade-value/grader', () => ({ gradeTrade: mockGradeTrade }))
vi.mock('@/lib/shared-services/knowledge-graph/QueryService', () => ({
  getManagerBehaviorProfile: mockGetManagerBehaviorProfile,
}))

import { evaluateTradeShadow } from '@/lib/shared-services/trade/TradeShadowService'
import { InMemoryShadowResultStore } from '@/lib/shared-services/trade/ShadowResultStore'
import { computeSourceFreshness } from '@/lib/trade-engine/trade-decision-context'

function makeAssetValuation(name: string, marketValue: number) {
  return {
    name,
    type: 'PLAYER' as const,
    position: 'QB',
    age: 27,
    team: 'KC',
    marketValue,
    impactValue: marketValue * 0.8,
    vorpValue: marketValue * 0.7,
    volatility: 0.2,
    valuationSource: { source: 'fantasycalc', valuedAt: new Date().toISOString() },
    adp: null,
    isCornerstone: false,
    cornerstoneReason: '',
  }
}

function makeLeagueCtx(provider: string, playerAName: string, playerBName: string): LeagueDecisionContext {
  return {
    version: 1,
    assembledAt: new Date().toISOString(),
    contextId: 'ldc-1',
    leagueConfig: {
      leagueId: 'league-1',
      name: 'Test League',
      platform: provider,
      scoringType: 'PPR',
      numTeams: 2,
      isSF: true,
      isTEP: false,
      tepBonus: 0,
      rosterPositions: [],
      starterSlots: 9,
      benchSlots: 6,
      taxiSlots: 0,
      scoringSettings: {},
    },
    teams: [
      {
        teamId: 'team-a',
        teamName: 'Team A',
        rosterId: 1,
        userId: 'manager-a',
        record: { wins: 5, losses: 5 },
        pointsFor: 1000,
        avatar: null,
        tradeCount: 2,
        assets: [makeAssetValuation(playerAName, 9000)],
        totalValue: 9000,
        riskMarkers: [],
        rosterComposition: { size: 1, pickCount: 0, youngAssetCount: 0, starterStrengthIndex: 50 },
        needs: ['RB'],
        surplus: ['QB'],
        contenderTier: 'contender',
        managerPreferences: null,
      },
      {
        teamId: 'team-b',
        teamName: 'Team B',
        rosterId: 2,
        userId: 'manager-b',
        record: { wins: 4, losses: 6 },
        pointsFor: 900,
        avatar: null,
        tradeCount: 1,
        assets: [makeAssetValuation(playerBName, 8800)],
        totalValue: 8800,
        riskMarkers: [],
        rosterComposition: { size: 1, pickCount: 0, youngAssetCount: 0, starterStrengthIndex: 45 },
        needs: ['WR'],
        surplus: ['RB'],
        contenderTier: 'rebuild',
        managerPreferences: null,
      },
    ],
    tradeHistoryStats: { totalTrades: 3, recentTrades: 1, recencyWindowDays: 30, avgValueDelta: 0, leagueTradeFrequency: 'low', computedAt: new Date().toISOString() },
    missingData: {
      valuationsMissing: [],
      adpMissing: [],
      analyticsMissing: [],
      injuryDataStale: false,
      valuationDataStale: false,
      adpDataStale: false,
      analyticsDataStale: false,
      tradeHistoryStale: false,
      managerTendenciesUnavailable: [],
      competitorDataUnavailable: false,
      tradeHistoryInsufficient: false,
    },
    dataQuality: { assetsCovered: 2, assetsTotal: 2, coveragePercent: 100, adpHitRate: 0, injuryDataAvailable: false, analyticsAvailable: false, warnings: [] },
    dataSources: { valuationFetchedAt: new Date().toISOString(), adpFetchedAt: null, injuryFetchedAt: null, analyticsFetchedAt: null, rostersFetchedAt: new Date().toISOString(), tradeHistoryFetchedAt: new Date().toISOString() },
    sourceFreshness: computeSourceFreshness({
      valuationFetchedAt: new Date().toISOString(),
      adpFetchedAt: null,
      injuryFetchedAt: null,
      analyticsFetchedAt: null,
      rostersFetchedAt: new Date().toISOString(),
      tradeHistoryFetchedAt: new Date().toISOString(),
    }),
  } as unknown as LeagueDecisionContext
}

function makeDrivers(overrides: Record<string, unknown> = {}) {
  return {
    scoringMode: 'full',
    lineupImpactScore: 0,
    vorpScore: 0,
    marketScore: 0.5,
    behaviorScore: 0,
    hasBehaviorData: false,
    totalScore: 0.5,
    fairnessDelta: 0,
    acceptProbability: 0.5,
    confidenceScore: 80,
    confidenceRating: 'HIGH',
    verdict: 'Fair',
    lean: 'Even',
    labels: [],
    vorpDelta: { vorpDeltaYou: 0, vorpDeltaThem: 0 },
    confidenceFactors: { dataCompleteness: 90, projectionCertainty: 80, marketAlignment: 90, volatilityPenalty: 0, missingRosterPenalty: 0 },
    fairnessScore: 90,
    volatilityAdj: 0,
    marketDeltaPct: 0,
    starterLikelihoodDelta: 0,
    consolidationPenalty: 0,
    riskFlags: [],
    positionScarcity: {},
    dominantDriver: 'market',
    driverNarrative: 'Even value trade.',
    acceptDrivers: [],
    confidenceDrivers: [],
    acceptBullets: [],
    sensitivitySentence: '',
    ...overrides,
  }
}

describe('evaluateTradeShadow — shadow evaluation runs, provider-neutral context accepted', () => {
  let resultStore: InMemoryShadowResultStore

  beforeEach(() => {
    vi.clearAllMocks()
    resultStore = new InMemoryShadowResultStore()
    mockComputeTradeDrivers.mockReturnValue(makeDrivers())
    mockGradeTrade.mockReturnValue({
      grade: { grade: 'A-', valueDifference: 200, fairnessScore: 87, confidenceScore: 60, bullets: [] },
      commissionerReview: { fairnessScore: 87, lopsided: false, reviewRecommended: false, similarValueRange: { low: 0, high: 0 } },
    })
    mockGetManagerBehaviorProfile.mockResolvedValue({ status: 'gated', reason: 'insufficient cohort' })
  })

  it('produces a real shadow evaluation for a Sleeper league and logs it to the result store', async () => {
    mockBuildLeagueDecisionContext.mockResolvedValue(makeLeagueCtx('sleeper', 'Patrick Mahomes', 'Josh Allen'))

    const evaluation = await evaluateTradeShadow({
      leagueId: 'league-1',
      username: 'user1',
      sideARosterId: 'team-a',
      sideBRosterId: 'team-b',
      sideAAssetNames: ['Patrick Mahomes'],
      sideBAssetNames: ['Josh Allen'],
      resultStore,
    })

    expect(evaluation.leagueId).toBe('league-1')
    expect(evaluation.provider).toBe('sleeper')
    expect(evaluation.fairness.score).toBe(90) // from computeTradeDrivers, the shadow's own primary value
    expect(evaluation.divergence).toHaveLength(1)
    expect(evaluation.divergence[0].graderId).toBe('t2')
    expect(evaluation.divergence[0].legacyFairnessScore).toBe(87)

    const logged = await resultStore.all()
    expect(logged).toHaveLength(1)
    expect(logged[0].evaluationId).toBe(evaluation.evaluationId)
  })

  it('accepts a provider-neutral (ESPN) context identically to Sleeper', async () => {
    mockBuildLeagueDecisionContext.mockResolvedValue(makeLeagueCtx('espn', 'Lamar Jackson', 'CeeDee Lamb'))

    const evaluation = await evaluateTradeShadow({
      leagueId: 'espn-league-1',
      username: 'unused',
      platform: 'espn',
      userId: 'af-user-1',
      sideARosterId: 'team-a',
      sideBRosterId: 'team-b',
      sideAAssetNames: ['Lamar Jackson'],
      sideBAssetNames: ['CeeDee Lamb'],
      resultStore,
    })

    expect(mockBuildLeagueDecisionContext).toHaveBeenCalledWith({
      leagueId: 'espn-league-1',
      username: 'unused',
      platform: 'espn',
      userId: 'af-user-1',
    })
    expect(evaluation.provider).toBe('espn')
    expect(evaluation.fairness.score).toBe(90)
  })
})

describe('evaluateTradeShadow — Knowledge Graph manager profile consumed safely', () => {
  let resultStore: InMemoryShadowResultStore

  beforeEach(() => {
    vi.clearAllMocks()
    resultStore = new InMemoryShadowResultStore()
    mockComputeTradeDrivers.mockReturnValue(makeDrivers())
    mockGradeTrade.mockReturnValue({
      grade: { grade: 'A-', valueDifference: 200, fairnessScore: 87, confidenceScore: 60, bullets: [] },
      commissionerReview: { fairnessScore: 87, lopsided: false, reviewRecommended: false, similarValueRange: { low: 0, high: 0 } },
    })
    mockBuildLeagueDecisionContext.mockResolvedValue(makeLeagueCtx('sleeper', 'Patrick Mahomes', 'Josh Allen'))
  })

  it('reflects an "ok" manager profile honestly when the Knowledge Graph returns real data', async () => {
    mockGetManagerBehaviorProfile.mockResolvedValue({
      status: 'ok',
      data: {
        asOf: new Date(),
        computedAt: new Date(),
        value: { tradeCount: 10, tradeAcceptedCount: 6, tradeRejectedCount: 4, tradeCancelledCount: 0, tradeVetoedCount: 0, tradeAcceptRate: 0.6, waiverClaimCount: 0, waiverWonCount: 0, waiverLostCount: 0, waiverWinRate: null },
        confidenceEnvelope: { confidence: 0.5, freshness: { computedAt: new Date(), isStale: false }, evidence: [], sampleSize: 10, sourceAttribution: [], risk: 0.5, uncertainty: null },
      },
    })

    const evaluation = await evaluateTradeShadow({
      leagueId: 'league-1',
      username: 'user1',
      sideARosterId: 'team-a',
      sideBRosterId: 'team-b',
      sideAAssetNames: ['Patrick Mahomes'],
      sideBAssetNames: ['Josh Allen'],
      resultStore,
    })

    expect(evaluation.managerTendency.sideA.status).toBe('ok')
    expect(evaluation.managerTendency.sideA.profile?.value.tradeAcceptRate).toBe(0.6)
    expect(evaluation.sourceAttribution.managerTendencySource).toBe('knowledge_graph')
  })

  it('reflects "gated" honestly without fabricating tendency data', async () => {
    mockGetManagerBehaviorProfile.mockResolvedValue({ status: 'gated', reason: 'Insufficient cohort: 3 leagues, 20 required.' })

    const evaluation = await evaluateTradeShadow({
      leagueId: 'league-1',
      username: 'user1',
      sideARosterId: 'team-a',
      sideBRosterId: 'team-b',
      sideAAssetNames: ['Patrick Mahomes'],
      sideBAssetNames: ['Josh Allen'],
      resultStore,
    })

    expect(evaluation.managerTendency.sideA.status).toBe('gated')
    expect(evaluation.managerTendency.sideA.reason).toContain('Insufficient cohort')
    expect(evaluation.managerTendency.sideA.profile).toBeNull()
  })

  it('never lets a Knowledge Graph failure crash the whole shadow evaluation — reports "unavailable" instead', async () => {
    mockGetManagerBehaviorProfile.mockRejectedValue(new Error('KG store unreachable'))

    const evaluation = await evaluateTradeShadow({
      leagueId: 'league-1',
      username: 'user1',
      sideARosterId: 'team-a',
      sideBRosterId: 'team-b',
      sideAAssetNames: ['Patrick Mahomes'],
      sideBAssetNames: ['Josh Allen'],
      resultStore,
    })

    expect(evaluation.managerTendency.sideA.status).toBe('unavailable')
    expect(evaluation.managerTendency.sideA.reason).toContain('KG store unreachable')
    // The evaluation itself still completed successfully despite the KG failure.
    expect(evaluation.fairness.score).toBe(90)
  })
})

describe('evaluateTradeShadow — divergence logging and legacy-grader-failure isolation', () => {
  let resultStore: InMemoryShadowResultStore

  beforeEach(() => {
    vi.clearAllMocks()
    resultStore = new InMemoryShadowResultStore()
    mockComputeTradeDrivers.mockReturnValue(makeDrivers())
    mockGetManagerBehaviorProfile.mockResolvedValue({ status: 'gated', reason: 'insufficient cohort' })
    mockBuildLeagueDecisionContext.mockResolvedValue(makeLeagueCtx('sleeper', 'Patrick Mahomes', 'Josh Allen'))
  })

  it('logs a real divergence entry when T2 and trade-engine disagree', async () => {
    mockGradeTrade.mockReturnValue({
      grade: { grade: 'C', valueDifference: 2000, fairnessScore: 55, confidenceScore: 60, bullets: [] },
      commissionerReview: { fairnessScore: 55, lopsided: true, reviewRecommended: true, similarValueRange: { low: 0, high: 0 } },
    })

    const evaluation = await evaluateTradeShadow({
      leagueId: 'league-1',
      username: 'user1',
      sideARosterId: 'team-a',
      sideBRosterId: 'team-b',
      sideAAssetNames: ['Patrick Mahomes'],
      sideBAssetNames: ['Josh Allen'],
      resultStore,
    })

    expect(evaluation.divergence[0].fairnessScoreDelta).toBe(-35) // 55 - 90
    expect(evaluation.divergence[0].notes.some((n) => n.includes('Large divergence'))).toBe(true)
  })

  it('does not fail the whole evaluation when T2 (a comparison-only grader) throws — reports it in divergence instead', async () => {
    mockGradeTrade.mockImplementation(() => {
      throw new Error('T2 exploded')
    })

    const evaluation = await evaluateTradeShadow({
      leagueId: 'league-1',
      username: 'user1',
      sideARosterId: 'team-a',
      sideBRosterId: 'team-b',
      sideAAssetNames: ['Patrick Mahomes'],
      sideBAssetNames: ['Josh Allen'],
      resultStore,
    })

    expect(evaluation.fairness.score).toBe(90) // primary value unaffected
    expect(evaluation.divergence[0].legacyFairnessScore).toBeNull()
    expect(evaluation.divergence[0].notes).toContain('T2 exploded')
  })

  it('propagates a failure from the primary grader (trade-engine) as a rejected promise — this is expected and safe since nothing live calls this yet', async () => {
    mockComputeTradeDrivers.mockImplementation(() => {
      throw new Error('trade-engine exploded')
    })

    await expect(
      evaluateTradeShadow({
        leagueId: 'league-1',
        username: 'user1',
        sideARosterId: 'team-a',
        sideBRosterId: 'team-b',
        sideAAssetNames: ['Patrick Mahomes'],
        sideBAssetNames: ['Josh Allen'],
        resultStore,
      })
    ).rejects.toThrow('trade-engine exploded')

    // Nothing was logged for a failed evaluation.
    expect(await resultStore.all()).toEqual([])
  })
})
