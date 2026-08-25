import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany } } }))

import { getByeWeeks } from '@/lib/core-app/byeWeeks'

/** All 32, so a week can be built that is genuinely complete. */
const ALL = [
  'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND',
  'JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF',
  'TB','TEN','WAS',
]

/** A full 16-fixture week, optionally with some teams held out on bye. */
function week(n: number, onBye: string[] = [], seasonType = 'regular') {
  const teams = ALL.filter((t) => !onBye.includes(t))
  const games = []
  for (let i = 0; i + 1 < teams.length; i += 2) {
    games.push({ homeTeam: teams[i], awayTeam: teams[i + 1], week: n, seasonType })
  }
  return games
}

beforeEach(() => findMany.mockReset())

describe('getByeWeeks', () => {
  it('finds the week a player is off', async () => {
    findMany.mockResolvedValue(week(7, ['DEN', 'LV', 'KC', 'LAC']))

    const out = await getByeWeeks({
      sport: 'NFL',
      season: 2026,
      playerTeams: new Map([
        ['p1', 'DEN'],
        ['p2', 'BUF'],
      ]),
      fromWeek: 7,
    })

    expect(out!.byWeek.get(7)).toEqual(['p1'])
  })

  it('⚠ refuses to call anything a bye when the slate is incomplete', async () => {
    /*
     * THE FAILURE THIS GUARDS. A bye is inferred from ABSENCE, so a partially
     * ingested week reports every team we did not see as off — which on this
     * repo's schedule data would flag most of a roster. Telling someone their
     * RB1 is on bye when he is playing is worse than saying nothing.
     */
    findMany.mockResolvedValue([
      { homeTeam: 'DEN', awayTeam: 'LV', week: 7, seasonType: 'regular' },
      { homeTeam: 'KC', awayTeam: 'LAC', week: 7, seasonType: 'regular' },
    ])

    const out = await getByeWeeks({
      sport: 'NFL',
      season: 2026,
      playerTeams: new Map([['p1', 'BUF']]),
      fromWeek: 7,
    })
    expect(out).toBeNull()
  })

  it('⚠ dedupes the same fixture arriving from four providers', async () => {
    /*
     * The unique key includes `source`, so one game can appear four times. A
     * naive fixture count would make a quarter-ingested week look complete and
     * re-open the bug above.
     */
    const single = week(7, ['DEN', 'LV']).slice(0, 4)
    const duplicated = [...single, ...single, ...single, ...single]
    findMany.mockResolvedValue(duplicated)

    const out = await getByeWeeks({
      sport: 'NFL',
      season: 2026,
      playerTeams: new Map([['p1', 'DEN']]),
      fromWeek: 7,
    })
    // 16 rows but only 4 distinct fixtures — below the gate.
    expect(out).toBeNull()
  })

  it('ignores preseason, where everybody sits somebody', async () => {
    findMany.mockResolvedValue(week(3, ['DEN'], 'preseason'))
    const out = await getByeWeeks({
      sport: 'NFL',
      season: 2026,
      playerTeams: new Map([['p1', 'DEN']]),
      fromWeek: 3,
    })
    expect(out).toBeNull()
  })

  it('matches on normalised names, not raw provider strings', async () => {
    // ESPN writes "Denver Broncos", the roster says "DEN".
    const games = week(7, ['DEN', 'LV']).map((g) => ({
      ...g,
      homeTeam: g.homeTeam === 'KC' ? 'Kansas City Chiefs' : g.homeTeam,
    }))
    findMany.mockResolvedValue(games)

    const out = await getByeWeeks({
      sport: 'NFL',
      season: 2026,
      playerTeams: new Map([
        ['kc', 'KC'],
        ['den', 'DEN'],
      ]),
      fromWeek: 7,
    })
    // KC is playing under a display name, so only DEN is off.
    expect(out!.byWeek.get(7)).toEqual(['den'])
  })

  it('reports several byes stacking in one week — the planning problem', async () => {
    findMany.mockResolvedValue(week(7, ['DEN', 'LV', 'KC', 'LAC']))
    const out = await getByeWeeks({
      sport: 'NFL',
      season: 2026,
      playerTeams: new Map([
        ['a', 'DEN'],
        ['b', 'LV'],
        ['c', 'KC'],
        ['d', 'BUF'],
      ]),
      fromWeek: 7,
    })
    expect(out!.byWeek.get(7)).toEqual(['a', 'b', 'c'])
  })

  it('returns null rather than throwing when the schedule read fails', async () => {
    findMany.mockRejectedValueOnce(new Error('db down'))
    await expect(
      getByeWeeks({
        sport: 'NFL',
        season: 2026,
        playerTeams: new Map([['p1', 'DEN']]),
        fromWeek: 7,
      }),
    ).resolves.toBeNull()
  })
})
