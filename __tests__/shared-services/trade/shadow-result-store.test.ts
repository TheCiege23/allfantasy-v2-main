import { describe, expect, it } from 'vitest'
import { InMemoryShadowResultStore } from '@/lib/shared-services/trade/ShadowResultStore'
import type { TradeShadowEvaluation } from '@/lib/shared-services/trade/types'

function makeEvaluation(overrides: Partial<TradeShadowEvaluation> = {}): TradeShadowEvaluation {
  return {
    evaluationId: Math.random().toString(),
    leagueId: 'league-1',
    provider: 'sleeper',
    evaluatedAt: new Date().toISOString(),
    fairness: { score: 88, grade: 'Fair', valueDifference: 100, leanedTo: 'even' },
    rosterFit: { sideA: { needs: [], surplus: [] }, sideB: { needs: [], surplus: [] } },
    managerTendency: {
      sideA: { status: 'unavailable', reason: null, profile: null },
      sideB: { status: 'unavailable', reason: null, profile: null },
    },
    leagueContext: { scoringType: 'PPR', isSF: true, isTEP: false, numTeams: 10 },
    confidence: 75,
    evidence: [],
    risk: { level: 'medium', flags: [] },
    freshness: { contextAssembledAt: new Date().toISOString(), managerProfileComputedAt: { sideA: null, sideB: null } },
    sourceAttribution: { contextProvider: 'sleeper', managerTendencySource: 'unavailable' },
    divergence: [
      { graderId: 't2', legacyFairnessScore: 85, legacyGrade: 'A-', shadowFairnessScore: 88, shadowGrade: 'Fair', fairnessScoreDelta: -3, gradeMatches: false, notes: [] },
    ],
    ...overrides,
  }
}

describe('InMemoryShadowResultStore', () => {
  it('appends and retrieves all logged evaluations', async () => {
    const store = new InMemoryShadowResultStore()
    await store.append(makeEvaluation({ evaluationId: 'e1' }))
    await store.append(makeEvaluation({ evaluationId: 'e2' }))

    const all = await store.all()
    expect(all).toHaveLength(2)
    expect(all.map((e) => e.evaluationId)).toEqual(['e1', 'e2'])
  })

  it('finds evaluations whose divergence exceeds a given threshold', async () => {
    const store = new InMemoryShadowResultStore()
    await store.append(
      makeEvaluation({
        evaluationId: 'small-divergence',
        divergence: [{ graderId: 't2', legacyFairnessScore: 85, legacyGrade: 'A-', shadowFairnessScore: 88, shadowGrade: 'Fair', fairnessScoreDelta: -3, gradeMatches: false, notes: [] }],
      })
    )
    await store.append(
      makeEvaluation({
        evaluationId: 'large-divergence',
        divergence: [{ graderId: 't2', legacyFairnessScore: 40, legacyGrade: 'D', shadowFairnessScore: 88, shadowGrade: 'Fair', fairnessScoreDelta: -48, gradeMatches: false, notes: [] }],
      })
    )

    const diverging = await store.findDiverging(20)
    expect(diverging).toHaveLength(1)
    expect(diverging[0].evaluationId).toBe('large-divergence')
  })

  it('excludes evaluations where the legacy grader failed (null delta) from divergence queries', async () => {
    const store = new InMemoryShadowResultStore()
    await store.append(
      makeEvaluation({
        evaluationId: 'failed-legacy',
        divergence: [{ graderId: 't2', legacyFairnessScore: null, legacyGrade: null, shadowFairnessScore: 88, shadowGrade: 'Fair', fairnessScoreDelta: null, gradeMatches: null, notes: ['boom'] }],
      })
    )

    const diverging = await store.findDiverging(1)
    expect(diverging).toHaveLength(0)
  })

  it('returns an empty array with no evaluations logged yet', async () => {
    const store = new InMemoryShadowResultStore()
    expect(await store.all()).toEqual([])
    expect(await store.findDiverging(0)).toEqual([])
  })
})
