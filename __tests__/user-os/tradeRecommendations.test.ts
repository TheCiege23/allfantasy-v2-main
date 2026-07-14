import { describe, expect, it } from 'vitest'
import { generateTradeRecommendations } from '@/lib/shared-services/league-hub/generators/tradeRecommendations'
import { baseContext, standing } from './fixtures'

const NOW = '2026-07-13T00:00:00.000Z'

describe('generateTradeRecommendations', () => {
  it('reuses the existing Trade Decision OS by pointing to it rather than fabricating trade math', () => {
    const viewer = standing({ teamId: 'team-1', wins: 8, losses: 1, isViewerTeam: true })
    const context = baseContext({
      currentWeek: 9,
      viewerTeam: viewer,
      standings: [viewer, standing({ teamId: 'team-2', wins: 2, losses: 7, isViewerTeam: false })],
    })
    const recs = generateTradeRecommendations(context, NOW)
    expect(recs).toHaveLength(1)
    expect(recs[0].action?.href).toBe('/trade-finder')
    expect(recs[0].executionCapability).toBe('recommendation_only')
  })

  it('never claims a trade was evaluated or proposed on the user\'s behalf', () => {
    const context = baseContext({ currentWeek: 9 })
    const recs = generateTradeRecommendations(context, NOW)
    for (const rec of recs) {
      expect(rec.executionCapability).not.toBe('native_execute')
    }
  })

  it('frames a contender posture as buy-low', () => {
    const viewer = standing({ teamId: 'team-1', wins: 9, losses: 0, pointsFor: 1300, isViewerTeam: true })
    const context = baseContext({
      currentWeek: 9,
      viewerTeam: viewer,
      standings: [viewer, standing({ teamId: 'team-2', wins: 1, losses: 8, pointsFor: 500, isViewerTeam: false })],
    })
    const recs = generateTradeRecommendations(context, NOW)
    expect(recs[0].type).toBe('buy_low_posture')
  })

  it('frames a redraft retool posture as sell-high, not rebuild', () => {
    const viewer = standing({ teamId: 'team-1', wins: 1, losses: 8, pointsFor: 500, isViewerTeam: true })
    const context = baseContext({
      isDynasty: false,
      currentWeek: 9,
      viewerTeam: viewer,
      standings: [viewer, standing({ teamId: 'team-2', wins: 9, losses: 0, pointsFor: 1300, isViewerTeam: false })],
    })
    const recs = generateTradeRecommendations(context, NOW)
    expect(recs[0].type).toBe('sell_high_posture')
  })

  it('discloses limited manager-history confidence honestly when evidence is insufficient (early season)', () => {
    const context = baseContext({ currentWeek: 1 })
    const recs = generateTradeRecommendations(context, NOW)
    expect(recs).toEqual([])
  })

  it('returns nothing when the trade domain is unavailable', () => {
    const context = baseContext({ unavailableDomains: ['trade'] })
    const recs = generateTradeRecommendations(context, NOW)
    expect(recs).toEqual([])
  })
})
