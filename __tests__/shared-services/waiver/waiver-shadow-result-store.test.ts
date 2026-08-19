import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryWaiverShadowResultStore } from '@/lib/shared-services/waiver/WaiverShadowResultStore'
import type { WaiverEvaluation } from '@/lib/shared-services/waiver/types'

function makeEvaluation(overrides: Partial<WaiverEvaluation> = {}): WaiverEvaluation {
  return {
    evaluationId: 'eval-1',
    leagueId: 'league-1',
    rosterId: 'roster-1',
    platform: 'sleeper',
    evaluatedAt: new Date().toISOString(),
    topCandidate: null,
    recommendation: { score: 0, tier: null, dropCandidate: null },
    faab: { recommendedBid: null, faabRemaining: null, faabBudget: null },
    priority: { rank: null, waiverType: 'faab' },
    rosterImpact: { needs: [], surplus: [] },
    managerTendency: { status: 'unavailable', reason: null, profile: null },
    urgency: 'none',
    confidence: 50,
    evidence: [],
    risk: { level: 'low', flags: [] },
    uncertainty: [],
    freshness: { contextAssembledAt: new Date().toISOString(), managerProfileComputedAt: null },
    sourceAttribution: { contextProvider: 'sleeper', managerTendencySource: 'unavailable' },
    divergence: [],
    ...overrides,
  }
}

describe('InMemoryWaiverShadowResultStore', () => {
  let store: InMemoryWaiverShadowResultStore

  beforeEach(() => {
    store = new InMemoryWaiverShadowResultStore()
  })

  it('appends and returns all evaluations', async () => {
    await store.append(makeEvaluation())
    await store.append(makeEvaluation({ evaluationId: 'eval-2' }))
    expect(await store.all()).toHaveLength(2)
  })

  it('findDiverging returns only evaluations with a sameTopAdd:false divergence entry', async () => {
    await store.append(makeEvaluation({ evaluationId: 'aligned', divergence: [{ graderId: 'waiver_recommendation_service', legacyTopAddPlayerId: 'p1', legacyTopAddPlayerName: 'A', legacyFaabBid: null, legacyPriority: null, shadowTopAddPlayerId: 'p1', shadowTopAddPlayerName: 'A', shadowFaabBid: null, shadowPriority: null, sameTopAdd: true, faabBidDelta: null, notes: [] }] }))
    await store.append(makeEvaluation({ evaluationId: 'diverged', divergence: [{ graderId: 'waiver_recommendation_service', legacyTopAddPlayerId: 'p1', legacyTopAddPlayerName: 'A', legacyFaabBid: null, legacyPriority: null, shadowTopAddPlayerId: 'p2', shadowTopAddPlayerName: 'B', shadowFaabBid: null, shadowPriority: null, sameTopAdd: false, faabBidDelta: null, notes: [] }] }))

    const diverging = await store.findDiverging()
    expect(diverging).toHaveLength(1)
    expect(diverging[0].evaluationId).toBe('diverged')
  })

  it('empty store returns empty arrays', async () => {
    expect(await store.all()).toEqual([])
    expect(await store.findDiverging()).toEqual([])
  })
})
