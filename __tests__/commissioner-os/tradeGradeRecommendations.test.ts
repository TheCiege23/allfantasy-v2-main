/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 11 tests.
 */
import { describe, expect, it } from 'vitest'
import { generateTradeGradeRecommendations } from '@/lib/shared-services/league-hub/generators/commissioner/tradeGradeRecommendations'
import { baseCommissionerOsContext, baseShared } from './fixtures'

function sharedWithTradeCount(tradeCount: number) {
  return baseShared({
    missionControl: {
      leagueId: 'league-1',
      activity: { tradeCount, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 },
      managersAtRetentionRisk: [],
      recommendedActions: [],
      fieldProvenance: null,
    },
  })
}

describe('generateTradeGradeRecommendations', () => {
  it('returns nothing when there are no real trades this period', () => {
    const context = baseCommissionerOsContext({ shared: sharedWithTradeCount(0) })
    const recs = generateTradeGradeRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(0)
  })

  it('surfaces a real trade count as a neutral recap pointer', () => {
    const context = baseCommissionerOsContext({ shared: sharedWithTradeCount(3) })
    const recs = generateTradeGradeRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs[0].title).toContain('3 trade')
    expect(recs[0].action?.href).toBe('/dynasty-trade-analyzer')
  })

  it('never recommends intervention merely because a trade is uneven — governanceSeverity is always none here', () => {
    const context = baseCommissionerOsContext({ shared: sharedWithTradeCount(5) })
    const recs = generateTradeGradeRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs[0].governanceSeverity).toBe('none')
    expect(recs[0].humanReviewRequired).toBe(false)
  })
})
