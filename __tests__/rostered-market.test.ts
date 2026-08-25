import { beforeEach, describe, expect, it, vi } from 'vitest'

const { leagueFindMany, rosterFindMany } = vi.hoisted(() => ({
  leagueFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findMany: leagueFindMany }, roster: { findMany: rosterFindMany } },
}))
// unstable_cache wraps a function; in tests it should just call through.
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

import { getRosteredMarket, MIN_LEAGUES_FOR_MARKET } from '@/lib/core-app/rosteredMarket'

/**
 * Own % and start % over AllFantasy's own rosters.
 *
 * This was previously written off as "no vendor supplies it", which was true
 * and beside the point — every imported league already tells us who is rostered
 * and who is started.
 */

function leagues(n: number) {
  leagueFindMany.mockResolvedValue(Array.from({ length: n }, (_, i) => ({ id: `L${i}` })))
}

/** One roster per league: [leagueIndex, players, starters]. */
function rosters(rows: Array<[number, string[], string[]]>) {
  rosterFindMany.mockResolvedValue(
    rows.map(([i, players, starters]) => ({
      leagueId: `L${i}`,
      playerData: { players, starters },
    })),
  )
}

beforeEach(() => {
  leagueFindMany.mockReset()
  rosterFindMany.mockReset()
})

describe('getRosteredMarket', () => {
  it('computes own % across every league the app holds', async () => {
    leagues(4)
    rosters([
      [0, ['p1', 'p2'], ['p1']],
      [1, ['p1'], ['p1']],
      [2, ['p2'], []],
      [3, [], []],
    ])

    const board = await getRosteredMarket({})
    // p1 is on 2 of 4 rosters.
    expect(board.byPlayerId.get('p1')!.ownPct).toBe(0.5)
    expect(board.byPlayerId.get('p1')!.rosteredIn).toBe(2)
    expect(board.leaguesCounted).toBe(4)
  })

  it('⚠ takes start % over the leagues that ROSTER him, not over all of them', async () => {
    /*
     * A player on 3 of 100 rosters and started in all three is started
     * everywhere he is owned. Dividing by every league would report 3% started
     * and describe him as a universal bench player, which is the opposite of
     * the truth.
     */
    leagues(100)
    rosters([
      [0, ['p1'], ['p1']],
      [1, ['p1'], ['p1']],
      [2, ['p1'], ['p1']],
    ])

    const p1 = (await getRosteredMarket({})).byPlayerId.get('p1')!
    expect(p1.ownPct).toBe(0.03)
    expect(p1.startPct).toBe(1)
  })

  it('drops start % when he is rostered but benched — byes and injuries move this', async () => {
    leagues(4)
    rosters([
      [0, ['p1'], ['p1']],
      [1, ['p1'], []],
      [2, ['p1'], []],
      [3, ['p1'], ['p1']],
    ])

    const p1 = (await getRosteredMarket({})).byPlayerId.get('p1')!
    expect(p1.ownPct).toBe(1)
    expect(p1.startPct).toBe(0.5)
    expect(p1.startedIn).toBe(2)
  })

  it('⚠ returns NULL start % for a free agent, never 0%', async () => {
    // A start rate over zero leagues is undefined, not zero. Rendering 0%
    // would call an unrostered player a universal bench player.
    leagues(4)
    rosters([[0, ['other'], ['other']]])

    const board = await getRosteredMarket({})
    expect(board.byPlayerId.has('p1')).toBe(false)
  })

  it('⚠ ignores the "0" empty-slot sentinel instead of counting it as a player', async () => {
    // Sleeper writes an unfilled starting slot as "0". Counted, it would become
    // the most-owned and most-started "player" in the app.
    leagues(2)
    rosters([
      [0, ['0', 'p1'], ['0', 'p1']],
      [1, ['0'], ['0']],
    ])

    const board = await getRosteredMarket({})
    expect(board.byPlayerId.has('0')).toBe(false)
    expect(board.byPlayerId.get('p1')!.rosteredIn).toBe(1)
  })

  it('counts a player once per league even if the roster row repeats him', async () => {
    leagues(2)
    rosters([
      [0, ['p1', 'p1', 'p1'], ['p1']],
      [1, [], []],
    ])
    expect((await getRosteredMarket({})).byPlayerId.get('p1')!.rosteredIn).toBe(1)
  })

  it('reports the denominator so a caller can refuse a tiny sample', async () => {
    // Early on, one manager's decision swings a percentage by double digits.
    leagues(3)
    rosters([[0, ['p1'], ['p1']]])

    const board = await getRosteredMarket({})
    expect(board.leaguesCounted).toBe(3)
    expect(board.leaguesCounted).toBeLessThan(MIN_LEAGUES_FOR_MARKET)
  })

  it('scopes to dynasty or redraft, because the same player is not the same asset', async () => {
    leagues(2)
    rosters([[0, ['p1'], ['p1']]])
    await getRosteredMarket({ dynastyOnly: true })
    expect(leagueFindMany.mock.calls[0][0].where.isDynasty).toBe(true)
  })

  it('blends both formats when no scope is given', async () => {
    leagues(2)
    rosters([[0, ['p1'], ['p1']]])
    await getRosteredMarket({})
    expect(leagueFindMany.mock.calls[0][0].where.isDynasty).toBeUndefined()
  })

  it('returns an empty board rather than throwing when nothing is imported', async () => {
    leagueFindMany.mockResolvedValue([])
    const board = await getRosteredMarket({})
    expect(board.leaguesCounted).toBe(0)
    expect(board.byPlayerId.size).toBe(0)
  })

  it('survives a database error without taking the screen down', async () => {
    leagueFindMany.mockRejectedValueOnce(new Error('db down'))
    await expect(getRosteredMarket({})).resolves.toMatchObject({ leaguesCounted: 0 })
  })
})
