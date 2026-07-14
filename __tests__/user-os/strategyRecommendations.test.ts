import { describe, expect, it } from 'vitest'
import { classifyStrategy, generateStrategyRecommendations } from '@/lib/shared-services/league-hub/generators/strategyRecommendations'
import { baseContext, standing } from './fixtures'

const NOW = '2026-07-13T00:00:00.000Z'

describe('classifyStrategy', () => {
  it('returns insufficient_evidence before week 3', () => {
    const context = baseContext({ currentWeek: 1 })
    const result = classifyStrategy(context)
    expect(result?.classification).toBe('insufficient_evidence')
  })

  it('classifies a top-record team as a contender', () => {
    const viewer = standing({ teamId: 'team-1', wins: 8, losses: 1, pointsFor: 1200, isViewerTeam: true })
    const context = baseContext({
      currentWeek: 9,
      viewerTeam: viewer,
      standings: [
        viewer,
        standing({ teamId: 'team-2', wins: 4, losses: 5, pointsFor: 900, isViewerTeam: false }),
        standing({ teamId: 'team-3', wins: 2, losses: 7, pointsFor: 700, isViewerTeam: false }),
      ],
    })
    const result = classifyStrategy(context)
    expect(['strong_contender', 'contender']).toContain(result?.classification)
  })

  it('classifies a low-standing redraft team as retool, never rebuild', () => {
    const viewer = standing({ teamId: 'team-1', wins: 1, losses: 8, pointsFor: 600, isViewerTeam: true })
    const context = baseContext({
      isDynasty: false,
      currentWeek: 9,
      viewerTeam: viewer,
      standings: [
        standing({ teamId: 'team-2', wins: 8, losses: 1, pointsFor: 1200, isViewerTeam: false }),
        standing({ teamId: 'team-3', wins: 6, losses: 3, pointsFor: 1000, isViewerTeam: false }),
        viewer,
      ],
    })
    const result = classifyStrategy(context)
    expect(result?.classification).toBe('retool')
    expect(result?.posture.toLowerCase()).not.toContain('rebuild')
  })

  it('classifies a low-standing dynasty team as rebuild (dynasty-specific language allowed)', () => {
    const viewer = standing({ teamId: 'team-1', wins: 1, losses: 8, pointsFor: 600, isViewerTeam: true })
    const context = baseContext({
      isDynasty: true,
      currentWeek: 9,
      viewerTeam: viewer,
      standings: [
        standing({ teamId: 'team-2', wins: 8, losses: 1, pointsFor: 1200, isViewerTeam: false }),
        standing({ teamId: 'team-3', wins: 6, losses: 3, pointsFor: 1000, isViewerTeam: false }),
        viewer,
      ],
    })
    const result = classifyStrategy(context)
    expect(result?.classification).toBe('rebuild')
  })

  it('returns null when the viewer has no claimed team', () => {
    const context = baseContext({ viewerTeam: null })
    const result = classifyStrategy(context)
    expect(result).toBeNull()
  })
})

describe('generateStrategyRecommendations', () => {
  it('produces exactly one strategy recommendation with real evidence', () => {
    const context = baseContext({ currentWeek: 9 })
    const recs = generateStrategyRecommendations(context, NOW)
    expect(recs).toHaveLength(1)
    expect(recs[0].evidence.length).toBeGreaterThan(0)
    expect(recs[0].rationale.length).toBeGreaterThan(0)
  })

  it('returns nothing for insufficient evidence at low priority when the caller filters low-priority items (priority is honestly low)', () => {
    const context = baseContext({ currentWeek: 1 })
    const recs = generateStrategyRecommendations(context, NOW)
    expect(recs[0]?.priority).toBe('low')
  })
})
