import { describe, expect, it, vi } from 'vitest'

import { MIN_FORM_GAMES, projectFromRecentForm } from '@/lib/waivers/recentFormProjection'

/**
 * The vendor projection feed is one week deep — ~1,000 rows for a single week and preset — so on
 * a standard league only 141 of 449 startable free agents had a projection at all and the waiver
 * board could not rank the rest. This fills those gaps from what a player has actually scored
 * under the league's own rules.
 */

const PPR = { rec: 1, rec_yd: 0.1, rec_td: 6, rush_yd: 0.1, rush_td: 6 }

const prismaWith = (rows: Array<{ playerId: string; weekOrRound: number; normalizedStatMap: unknown }>) =>
  ({ playerGameStat: { findMany: vi.fn(async () => rows) } }) as never

const game = (playerId: string, weekOrRound: number, m: Record<string, number>) => ({
  playerId,
  weekOrRound,
  normalizedStatMap: m,
})

describe('projectFromRecentForm', () => {
  it('weights recent games more heavily than old ones', async () => {
    /*
     * On a waiver wire the reason a player is available is usually that he was not producing
     * until recently, so an unweighted mean systematically understates exactly the players this
     * board exists to surface.
     */
    const rising = await projectFromRecentForm({
      prisma: prismaWith([
        game('p', 18, { rec: 10 }),
        game('p', 17, { rec: 10 }),
        game('p', 16, { rec: 0 }),
        game('p', 15, { rec: 0 }),
      ]),
      season: 2025,
      playerIds: ['p'],
      scoring: PPR,
    })
    // A flat mean would be 5.0; recency weighting puts him above it.
    expect(rising.get('p')!.points).toBeGreaterThan(5)
    expect(rising.get('p')!.games).toBe(4)
  })

  it('skips a game this league prices at nothing rather than averaging in a zero', async () => {
    /*
     * A defender's line in an offence-only league scores nothing because the league does not
     * price it — that says nothing about the player. Counting it as a zero would drag every
     * estimate toward the floor.
     */
    const res = await projectFromRecentForm({
      prisma: prismaWith([
        game('p', 18, { rec: 10 }),
        game('p', 17, { idp_tkl: 9 }), // priced at nothing here
        game('p', 16, { rec: 10 }),
      ]),
      season: 2025,
      playerIds: ['p'],
      scoring: PPR,
    })
    expect(res.get('p')!.games).toBe(2)
    expect(res.get('p')!.points).toBeCloseTo(10, 1)
  })

  it('refuses below the minimum sample instead of letting one game define a player', async () => {
    const res = await projectFromRecentForm({
      prisma: prismaWith([game('p', 18, { rec: 30 })]),
      season: 2025,
      playerIds: ['p'],
      scoring: PPR,
    })
    expect(res.has('p')).toBe(false)
    expect(MIN_FORM_GAMES).toBe(2)
  })

  it('reports the game count so a thin estimate can be weighed as one', async () => {
    const res = await projectFromRecentForm({
      prisma: prismaWith([game('p', 18, { rec: 8 }), game('p', 17, { rec: 8 })]),
      season: 2025,
      playerIds: ['p'],
      scoring: PPR,
    })
    expect(res.get('p')!.games).toBe(2)
  })

  it('returns nothing at all when the league states no scoring', async () => {
    // Scoring a player against another league's weights is worse than returning nothing.
    const res = await projectFromRecentForm({
      prisma: prismaWith([game('p', 18, { rec: 10 }), game('p', 17, { rec: 10 })]),
      season: 2025,
      playerIds: ['p'],
      scoring: null,
    })
    expect(res.size).toBe(0)
  })

  it('keeps players separate', async () => {
    const res = await projectFromRecentForm({
      prisma: prismaWith([
        game('a', 18, { rec: 10 }), game('a', 17, { rec: 10 }),
        game('b', 18, { rec: 2 }), game('b', 17, { rec: 2 }),
      ]),
      season: 2025,
      playerIds: ['a', 'b'],
      scoring: PPR,
    })
    expect(res.get('a')!.points).toBeGreaterThan(res.get('b')!.points)
  })
})
