import { describe, expect, it } from 'vitest'

import { bestBallSource, isBestBallLeagueRow } from '@/lib/core-app/leagueBestBall'

/*
 * Best ball has no lineup to set. Production 2026-09-27: 0 of 344 Sleeper 2026 NFL
 * leagues carried the flag while 43 were named best ball, so the game-day list put
 * "Open lineup" buttons on leagues the platform sets itself.
 */
describe('bestBallSource', () => {
  it('reads the column and the variant first', () => {
    expect(bestBallSource({ bestBallMode: true })).toBe('column')
    expect(bestBallSource({ leagueVariant: 'best_ball' })).toBe('column')
    expect(bestBallSource({ leagueType: 'best_ball' })).toBe('leagueType')
  })

  it("reads the provider's own flag in the spellings the importer writes", () => {
    expect(bestBallSource({ settings: { best_ball: 1 } })).toBe('settings')
    expect(bestBallSource({ settings: { best_ball: true } })).toBe('settings')
    expect(bestBallSource({ settings: { best_ball: 0 } })).toBeNull()
  })

  it('never reads the league NAME — #1371: a name never proves lineup rules', () => {
    for (const name of ['Dynasty BestBall League!', 'Real Deal (best ball)', 'BSB1 Blood Sweat and Beers BB Dynasty']) {
      expect(isBestBallLeagueRow({ name, settings: {} })).toBe(false)
    }
  })
})
