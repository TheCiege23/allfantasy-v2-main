import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryDraftShadowResultStore } from '@/lib/shared-services/draft/DraftShadowResultStore'
import type { DraftEvaluation } from '@/lib/shared-services/draft/types'

function makeEvaluation(overrides: Partial<DraftEvaluation> = {}): DraftEvaluation {
  return {
    evaluationId: 'eval-1',
    leagueId: 'league-1',
    rosterId: 'roster-1',
    sessionId: 'session-1',
    platform: 'sleeper',
    evaluatedAt: new Date().toISOString(),
    draftState: { round: 3, pick: 30, totalTeams: 12, status: 'in_progress' },
    topCandidate: null,
    recommendation: { score: 0, reason: '', needScore: 0, adpEdge: 0 },
    alternatives: [],
    positionalImpact: { reachWarning: null, valueWarning: null, scarcityInsight: null, formatInsight: null },
    draftValue: { adp: null, overallPickAtEvaluation: 30 },
    scarcityImpact: { insight: null },
    opportunityCost: { alternativesForegone: [] },
    managerTendency: { status: 'unavailable', reason: null, profile: null },
    playerExposure: { status: 'unavailable', reason: null, exposure: null },
    confidence: 50,
    evidence: [],
    risk: { level: 'low', flags: [] },
    uncertainty: [],
    freshness: { contextAssembledAt: new Date().toISOString(), managerProfileComputedAt: null, playerExposureComputedAt: null },
    sourceAttribution: { contextProvider: 'sleeper', managerTendencySource: 'unavailable', playerExposureSource: 'unavailable' },
    divergence: [],
    ...overrides,
  }
}

describe('InMemoryDraftShadowResultStore', () => {
  let store: InMemoryDraftShadowResultStore

  beforeEach(() => {
    store = new InMemoryDraftShadowResultStore()
  })

  it('appends and returns all evaluations', async () => {
    await store.append(makeEvaluation())
    await store.append(makeEvaluation({ evaluationId: 'eval-2' }))
    expect(await store.all()).toHaveLength(2)
  })

  it('findDiverging returns only evaluations with a sameTopPlayer:false divergence entry', async () => {
    await store.append(
      makeEvaluation({
        evaluationId: 'aligned',
        divergence: [
          { graderId: 'ai_opponent_draft', legacyTopPlayerId: 'p1', legacyTopPlayerName: 'A', legacyConfidence: 0.7, shadowTopPlayerId: 'p1', shadowTopPlayerName: 'A', shadowConfidence: 80, sameTopPlayer: true, notes: [] },
        ],
      })
    )
    await store.append(
      makeEvaluation({
        evaluationId: 'diverged',
        divergence: [
          { graderId: 'ai_opponent_draft', legacyTopPlayerId: 'p1', legacyTopPlayerName: 'A', legacyConfidence: 0.7, shadowTopPlayerId: 'p2', shadowTopPlayerName: 'B', shadowConfidence: 80, sameTopPlayer: false, notes: [] },
        ],
      })
    )

    const diverging = await store.findDiverging()
    expect(diverging).toHaveLength(1)
    expect(diverging[0].evaluationId).toBe('diverged')
  })

  it('empty store returns empty arrays', async () => {
    expect(await store.all()).toEqual([])
    expect(await store.findDiverging()).toEqual([])
  })
})
