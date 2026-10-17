/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 7 tests.
 */
import { describe, expect, it } from 'vitest'
import { generateRankingsRecommendations } from '@/lib/shared-services/league-hub/generators/commissioner/rankingsRecommendations'
import { baseCommissionerOsContext, baseRanking, baseShared } from './fixtures'

describe('generateRankingsRecommendations', () => {
  it('summarizes real power rankings with real rank movement', () => {
    const context = baseCommissionerOsContext({ ranking: baseRanking() })
    const recs = generateRankingsRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(1)
    expect(recs[0].rationale.length).toBeGreaterThan(0)
  })

  it('never presents a stub ranking for a specialty format — honestly declines instead', () => {
    const context = baseCommissionerOsContext({
      shared: baseShared({
        formatAwareness: { leagueVariant: 'best_ball', isDynasty: false, powerRankingSupport: 'specialty_adapter_required', reason: 'Best Ball power rankings are a confirmed preview-only stub.' },
      }),
    })
    const recs = generateRankingsRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(0)
  })

  it('returns nothing when there is no real ranking yet', () => {
    const context = baseCommissionerOsContext({ ranking: null })
    const recs = generateRankingsRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(0)
  })

  it('never uses a Sleeper roster id as canonical manager identity in evidence', () => {
    const context = baseCommissionerOsContext({ ranking: baseRanking() })
    const recs = generateRankingsRecommendations(context, '2026-07-12T00:00:00.000Z')
    // The generator's evidence cites the ranking basis/generation date, never a bare provider id as identity.
    expect(recs[0].evidence.map((e) => e.label)).toEqual(['Ranking basis', 'Generated'])
  })
})
