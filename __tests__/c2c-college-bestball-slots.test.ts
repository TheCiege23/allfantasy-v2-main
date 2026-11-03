import { describe, expect, it } from 'vitest'
import { optimizeC2CCollegeBestBall } from '@/lib/merged-devy-c2c/bestball/C2CBestBallOptimizer'
import type { C2CLeagueConfigShape } from '@/lib/merged-devy-c2c/types'
import type { BestBallPlayerInput } from '@/lib/devy/bestball/DevyBestBallOptimizer'

function player(id: string, position: string, points: number, isNcaaDevy = true): BestBallPlayerInput {
  return { playerId: id, name: id, position, points, isNcaaDevy, isTaxi: false }
}
function config(sport: 'NFL' | 'NBA', slots: Record<string, number>): C2CLeagueConfigShape {
  return { sport, collegeActiveLineupSlots: slots } as C2CLeagueConfigShape
}

describe('C2C college best ball lineup settings', () => {
  it('uses configured basketball slots and omits pro players', () => {
    const result = optimizeC2CCollegeBestBall([
      player('g1', 'PG', 30), player('g2', 'SG', 20), player('f1', 'SF', 15),
      player('c1', 'C', 10), player('pro', 'PG', 100, false),
    ], config('NBA', { G: 1, F: 0, C: 1, FLEX: 0 }))
    expect(result.totalPoints).toBe(40)
    expect(result.starters.map(p => p.playerId)).toEqual(['g1', 'c1'])
  })
  it('uses configured football slots including zero and flexible positions', () => {
    const result = optimizeC2CCollegeBestBall([
      player('qb', 'QB', 30), player('rb', 'RB', 20), player('wr', 'WR', 15), player('te', 'TE', 10),
    ], config('NFL', { QB: 0, RB: 1, WR: 0, TE: 0, FLEX: 1 }))
    expect(result.totalPoints).toBe(35)
    expect(result.starters.map(p => p.playerId)).toEqual(['rb', 'wr'])
  })
})
