import { describe, expect, it } from 'vitest'
import {
  assembleShadowEvaluation,
  buildDivergence,
  buildEvidence,
  buildRiskFromDrivers,
  buildRosterFitSummary,
} from '@/lib/shared-services/trade/ShadowEvaluationEngine'
import type { LegacyGraderResult, ManagerTendencyContext } from '@/lib/shared-services/trade/types'
import type { TradeDriverData } from '@/lib/trade-engine/trade-engine'
import type { TradeDecisionContextV1 } from '@/lib/trade-engine/trade-decision-context'

function makeDrivers(overrides: Partial<TradeDriverData> = {}): TradeDriverData {
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
    confidenceScore: 75,
    confidenceRating: 'MEDIUM',
    verdict: 'Fair',
    lean: 'Even',
    labels: [],
    vorpDelta: { vorpDeltaYou: 0, vorpDeltaThem: 0 },
    confidenceFactors: {
      dataCompleteness: 80,
      projectionCertainty: 70,
      marketAlignment: 90,
      volatilityPenalty: 0,
      missingRosterPenalty: 0,
    },
    fairnessScore: 88,
    volatilityAdj: 0,
    marketDeltaPct: 0,
    starterLikelihoodDelta: 0,
    consolidationPenalty: 0,
    riskFlags: [],
    positionScarcity: {},
    dominantDriver: 'market',
    driverNarrative: 'Values are closely matched.',
    acceptDrivers: [],
    confidenceDrivers: [],
    acceptBullets: ['Both sides receive fair value.'],
    sensitivitySentence: '',
    ...overrides,
  } as TradeDriverData
}

function makeTradeCtx(overrides: Partial<TradeDecisionContextV1> = {}): TradeDecisionContextV1 {
  return {
    version: 1,
    assembledAt: new Date().toISOString(),
    contextId: 'tdc-1',
    leagueConfig: {
      leagueId: 'league-1',
      name: 'Test League',
      platform: 'sleeper',
      scoringType: 'PPR',
      numTeams: 10,
      isSF: true,
      isTEP: false,
      tepBonus: 0,
      rosterPositions: [],
      starterSlots: 9,
      benchSlots: 6,
      taxiSlots: 0,
      scoringSettings: {},
    },
    sideA: { teamId: '1', teamName: 'Team A', assets: [], totalValue: 0, riskMarkers: [], rosterComposition: { size: 0, pickCount: 0, youngAssetCount: 0, starterStrengthIndex: 0 }, needs: ['RB'], surplus: ['WR'], contenderTier: 'contender', managerPreferences: null },
    sideB: { teamId: '2', teamName: 'Team B', assets: [], totalValue: 0, riskMarkers: [], rosterComposition: { size: 0, pickCount: 0, youngAssetCount: 0, starterStrengthIndex: 0 }, needs: ['WR'], surplus: ['RB'], contenderTier: 'rebuild', managerPreferences: null },
    competitors: [],
    valueDelta: { absoluteDiff: 200, percentageDiff: 3, favoredSide: 'Even' },
    tradeHistoryStats: { totalTrades: 5, recentTrades: 1, recencyWindowDays: 30, avgValueDelta: 0, leagueTradeFrequency: 'medium', computedAt: new Date().toISOString() },
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
    sourceFreshness: {},
    ...overrides,
  } as unknown as TradeDecisionContextV1
}

const unavailableTendency: ManagerTendencyContext = { status: 'unavailable', reason: 'no manager key', profile: null }

describe('buildDivergence', () => {
  it('computes a real delta and flags large divergence', () => {
    const legacy: LegacyGraderResult = { graderId: 't2', fairnessScore: 60, grade: 'C', error: null }
    const divergence = buildDivergence(90, 'A', legacy)

    expect(divergence.fairnessScoreDelta).toBe(-30)
    expect(divergence.gradeMatches).toBe(false)
    expect(divergence.notes.some((n) => n.includes('Large divergence'))).toBe(true)
  })

  it('flags close agreement when graders are near', () => {
    const legacy: LegacyGraderResult = { graderId: 't2', fairnessScore: 89, grade: 'A-', error: null }
    const divergence = buildDivergence(88, 'A-', legacy)

    expect(divergence.gradeMatches).toBe(true)
    expect(divergence.notes.some((n) => n.includes('broadly agree'))).toBe(true)
  })

  it('reports null delta/gradeMatches when the legacy grader itself failed', () => {
    const legacy: LegacyGraderResult = { graderId: 't2', fairnessScore: null, grade: null, error: 'boom' }
    const divergence = buildDivergence(88, 'A-', legacy)

    expect(divergence.fairnessScoreDelta).toBeNull()
    expect(divergence.gradeMatches).toBeNull()
    expect(divergence.notes).toContain('boom')
  })
})

describe('buildRiskFromDrivers', () => {
  it('maps confidence rating to a risk level', () => {
    expect(buildRiskFromDrivers(makeDrivers({ confidenceRating: 'HIGH' })).level).toBe('low')
    expect(buildRiskFromDrivers(makeDrivers({ confidenceRating: 'MEDIUM' })).level).toBe('medium')
    expect(buildRiskFromDrivers(makeDrivers({ confidenceRating: 'LEARNING' })).level).toBe('high')
  })

  it('surfaces real riskFlags from the driver data', () => {
    const risk = buildRiskFromDrivers(makeDrivers({ riskFlags: ['injury_concern', 'age_cliff'] }))
    expect(risk.flags).toEqual(['injury_concern', 'age_cliff'])
  })
})

describe('buildRosterFitSummary', () => {
  it('passes through needs/surplus without transformation', () => {
    expect(buildRosterFitSummary(['RB'], ['WR'])).toEqual({ needs: ['RB'], surplus: ['WR'] })
  })
})

describe('buildEvidence', () => {
  it('cites the real verdict, dominant driver, narrative, and league context', () => {
    const evidence = buildEvidence(makeDrivers(), makeTradeCtx())
    expect(evidence.some((e) => e.includes('Fair'))).toBe(true)
    expect(evidence.some((e) => e.includes('market'))).toBe(true)
    expect(evidence.some((e) => e.includes('Superflex'))).toBe(true)
  })
})

describe('assembleShadowEvaluation', () => {
  it('builds a complete TradeShadowEvaluation with exactly one divergence entry (T2 only)', () => {
    const t2Result: LegacyGraderResult = { graderId: 't2', fairnessScore: 85, grade: 'A-', error: null }
    const evaluation = assembleShadowEvaluation({
      evaluationId: 'eval-1',
      leagueId: 'league-1',
      provider: 'sleeper',
      contextAssembledAt: new Date().toISOString(),
      tradeCtx: makeTradeCtx(),
      drivers: makeDrivers(),
      t2Result,
      sideATendency: unavailableTendency,
      sideBTendency: unavailableTendency,
    })

    expect(evaluation.evaluationId).toBe('eval-1')
    expect(evaluation.fairness.score).toBe(88)
    expect(evaluation.fairness.grade).toBe('Fair')
    expect(evaluation.rosterFit.sideA.needs).toEqual(['RB'])
    expect(evaluation.divergence).toHaveLength(1)
    expect(evaluation.divergence[0].graderId).toBe('t2')
    expect(evaluation.sourceAttribution.managerTendencySource).toBe('unavailable')
  })

  it('reflects knowledge_graph source attribution when at least one side has a real manager profile', () => {
    const okTendency: ManagerTendencyContext = {
      status: 'ok',
      reason: null,
      profile: {
        asOf: new Date(),
        computedAt: new Date(),
        value: {
          tradeCount: 5,
          tradeAcceptedCount: 3,
          tradeRejectedCount: 2,
          tradeCancelledCount: 0,
          tradeVetoedCount: 0,
          tradeAcceptRate: 0.6,
          waiverClaimCount: 0,
          waiverWonCount: 0,
          waiverLostCount: 0,
          waiverWinRate: null,
        },
        confidenceEnvelope: {
          confidence: 0.25,
          freshness: { computedAt: new Date(), isStale: false },
          evidence: [],
          sampleSize: 5,
          sourceAttribution: [],
          risk: 0.75,
          uncertainty: null,
        },
      },
    }

    const evaluation = assembleShadowEvaluation({
      evaluationId: 'eval-2',
      leagueId: 'league-1',
      provider: 'espn',
      contextAssembledAt: new Date().toISOString(),
      tradeCtx: makeTradeCtx(),
      drivers: makeDrivers(),
      t2Result: { graderId: 't2', fairnessScore: 85, grade: 'A-', error: null },
      sideATendency: okTendency,
      sideBTendency: unavailableTendency,
    })

    expect(evaluation.sourceAttribution.managerTendencySource).toBe('knowledge_graph')
    expect(evaluation.managerTendency.sideA.status).toBe('ok')
    expect(evaluation.freshness.managerProfileComputedAt.sideA).not.toBeNull()
    expect(evaluation.freshness.managerProfileComputedAt.sideB).toBeNull()
  })
})
