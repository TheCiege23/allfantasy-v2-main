import { describe, expect, it } from 'vitest'
import { getEmptyRecommendationBundle } from '@/lib/shared-services/league-hub/recommendationContract'

describe('getEmptyRecommendationBundle', () => {
  it('returns all five domains as empty arrays, never fabricated data', () => {
    const bundle = getEmptyRecommendationBundle()
    expect(bundle.lineup).toEqual([])
    expect(bundle.waiver).toEqual([])
    expect(bundle.trade).toEqual([])
    expect(bundle.roster).toEqual([])
    expect(bundle.commissioner).toEqual([])
    expect(bundle.totalCount).toBe(0)
  })

  it('returns a fresh object each call (no shared mutable reference)', () => {
    const a = getEmptyRecommendationBundle()
    const b = getEmptyRecommendationBundle()
    a.lineup.push({
      id: 'x',
      domain: 'lineup',
      leagueId: 'league-1',
      summary: 'test',
      priority: 'low',
      createdAt: new Date().toISOString(),
    })
    expect(b.lineup).toEqual([])
  })
})
