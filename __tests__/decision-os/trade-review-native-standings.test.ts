// @vitest-environment node
/**
 * `defaultNativeStandings` — who is out of the race in a league played on AllFantasy, any sport, from its
 * own standings (the eliminated-team lineup rule's `eliminatedTeams`), keyed by redraft and league roster id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  season: { id: 's1', currentWeek: 10, playoffStartWeek: 13 } as Record<string, unknown> | null,
  rosters: [] as Array<{ id: string; wins: number; losses: number; ties: number; playoffSeed: number | null }>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: vi.fn(async () => h.season) },
    redraftRoster: { findMany: vi.fn(async () => h.rosters) },
    roster: { findMany: vi.fn(async () => h.rosters.map((r) => ({ id: `af-${r.id}`, redraftRosterId: r.id }))) },
  },
}))

import { defaultNativeStandings } from '@/lib/decision-os/trade/tradeReviewContext'

const league = (over: Record<string, unknown> = {}) =>
  ({ id: 'L', platform: 'allfantasy', season: 2026, sport: 'NBA', playoffTeams: 4, settings: { playoff_team_count: 4 }, ...over }) as never
const team = (id: string, wins: number, losses: number, playoffSeed: number | null = null) => ({ id, wins, losses, ties: 0, playoffSeed })

beforeEach(() => {
  h.season = { id: 's1', currentWeek: 10, playoffStartWeek: 13 }
  // Week 10 of a 12-week regular season: weeks 10, 11 and 12 are left — three games.
  h.rosters = [team('a', 8, 1), team('b', 7, 2), team('c', 6, 3), team('d', 5, 4), team('e', 3, 6), team('f', 1, 8)]
})

describe('defaultNativeStandings', () => {
  it('eliminates only a team that cannot reach the playoff line with every game left, and marks who holds a spot', async () => {
    const r = await defaultNativeStandings(league())
    if (!r.ok) throw new Error(r.reason)
    // The 4th spot is at 5 wins. f (1 win) cannot reach it in three games; e (3 wins) still can.
    expect(r.value.get('f')).toEqual({ eliminated: true, holdsPlayoffSpot: false })
    expect(r.value.get('e')).toEqual({ eliminated: false, holdsPlayoffSpot: false })
    expect(r.value.get('d')).toEqual({ eliminated: false, holdsPlayoffSpot: true })
    // Keyed by the league roster id too, which is what a native trade side carries.
    expect(r.value.get('af-f')).toEqual(r.value.get('f'))
  })

  it('in the playoffs, a team without a seed is out and a seeded one holds a spot', async () => {
    h.season = { id: 's1', currentWeek: 13, playoffStartWeek: 13 }
    // g has the 4th-best record but lost the seed on a tiebreak; e is seeded below it. The seed decides now.
    h.rosters = [team('a', 10, 2, 1), team('b', 3, 9, null), team('c', 9, 3, 2), team('d', 8, 4, 3), team('e', 7, 5, 4), team('g', 7, 5, null)]
    const r = await defaultNativeStandings(league())
    if (!r.ok) throw new Error(r.reason)
    expect(r.value.get('b')).toEqual({ eliminated: true, holdsPlayoffSpot: false })
    expect(r.value.get('a')).toEqual({ eliminated: false, holdsPlayoffSpot: true })
    expect(r.value.get('g')).toEqual({ eliminated: true, holdsPlayoffSpot: false })
    expect(r.value.get('e')).toEqual({ eliminated: false, holdsPlayoffSpot: true })
  })

  it('declines an imported league, a league with no season, or no set playoff size', async () => {
    expect((await defaultNativeStandings(league({ platform: 'sleeper' }))).ok).toBe(false)
    expect((await defaultNativeStandings(league({ playoffTeams: null, settings: {} }))).ok).toBe(false)
    h.season = null
    expect((await defaultNativeStandings(league())).ok).toBe(false)
  })
})
