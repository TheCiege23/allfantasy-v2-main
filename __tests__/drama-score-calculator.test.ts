import { describe, expect, it } from 'vitest'
import { calculateDramaScore } from '@/lib/drama-engine/DramaScoreCalculator'

describe('DramaScoreCalculator', () => {
  it('ranks major upset above rebuild progress by default', () => {
    const upset = calculateDramaScore({ dramaType: 'MAJOR_UPSET', sport: 'NFL' })
    const rebuild = calculateDramaScore({ dramaType: 'REBUILD_PROGRESS', sport: 'NFL' })
    expect(upset).toBeGreaterThan(rebuild)
  })

  it('boosts score with richer signal factors', () => {
    const baseline = calculateDramaScore({ dramaType: 'RIVALRY_CLASH', sport: 'NBA' })
    const boosted = calculateDramaScore({
      dramaType: 'RIVALRY_CLASH',
      sport: 'NBA',
      intensityFactor: 1.2,
      rivalryScore: 92,
      playoffSwing: 0.28,
      leagueGraphHeat: 70,
    })
    expect(boosted).toBeGreaterThan(baseline)
    expect(boosted).toBeLessThanOrEqual(100)
  })
})
