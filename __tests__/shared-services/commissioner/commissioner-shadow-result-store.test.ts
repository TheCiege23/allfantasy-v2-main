import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryCommissionerShadowResultStore } from '@/lib/shared-services/commissioner/CommissionerShadowResultStore'
import type { CommissionerShadowEvaluation } from '@/lib/shared-services/commissioner/types'

function makeEvaluation(overrides: Partial<CommissionerShadowEvaluation> = {}): CommissionerShadowEvaluation {
  return {
    evaluationId: 'eval-1',
    leagueId: 'league-1',
    generatedAt: new Date().toISOString(),
    context: {} as never,
    pulse: {} as never,
    health: {} as never,
    attentionItems: [],
    ranking: null,
    brief: {} as never,
    divergence: [],
    ...overrides,
  }
}

describe('InMemoryCommissionerShadowResultStore', () => {
  let store: InMemoryCommissionerShadowResultStore

  beforeEach(() => {
    store = new InMemoryCommissionerShadowResultStore()
  })

  it('appends and returns all evaluations', async () => {
    await store.append(makeEvaluation())
    await store.append(makeEvaluation({ evaluationId: 'eval-2' }))
    expect(await store.all()).toHaveLength(2)
  })

  it('latestForLeague returns the most recently generated evaluation for that league only', async () => {
    await store.append(makeEvaluation({ evaluationId: 'e1', leagueId: 'league-1', generatedAt: '2026-01-01T00:00:00.000Z' }))
    await store.append(makeEvaluation({ evaluationId: 'e2', leagueId: 'league-1', generatedAt: '2026-01-02T00:00:00.000Z' }))
    await store.append(makeEvaluation({ evaluationId: 'e3', leagueId: 'league-2', generatedAt: '2026-01-03T00:00:00.000Z' }))

    const latest = await store.latestForLeague('league-1')
    expect(latest?.evaluationId).toBe('e2')
  })

  it('returns null when the league has no evaluations', async () => {
    expect(await store.latestForLeague('nobody')).toBeNull()
  })

  it('empty store returns empty arrays', async () => {
    expect(await store.all()).toEqual([])
  })
})
