/**
 * `/api/leagues/:id/dynasty-hub` now also feeds the dynasty League home: `titles` (championship
 * rafters, league-wide, read from league_seasons + league_championships) and `pipeline` (the
 * viewer's taxi / devy / rookie counts). Real rows only; the devy section is no longer folded into
 * taxi for this count.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: { id: 'me' } as { id: string } | null,
  context: null as unknown,
  seasons: [] as unknown[],
  championships: [] as unknown[],
  yearsExp: new Map<string, number>(),
  yearsExpCalls: [] as Array<[string[], string[]]>,
}))

vi.mock('@/lib/get-current-user', () => ({ getCurrentUser: async () => mocks.user }))
vi.mock('@/lib/dynasty-war-room/dynastyWarRoomContext', () => ({
  buildDynastyWarRoomContext: async () => ({ ok: true, context: mocks.context }),
}))
vi.mock('@/lib/roster-lineup-engine/playerYearsExp', () => ({
  loadKnownYearsExp: async (sports: string[], ids: string[]) => {
    mocks.yearsExpCalls.push([sports, ids])
    return mocks.yearsExp
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: async () => ({ leagueVariant: 'devy_dynasty', leagueType: 'dynasty' }) },
    leagueSeason: { findMany: async () => mocks.seasons },
    leagueChampionship: { findMany: async () => mocks.championships },
  },
}))

import { GET } from '@/app/api/leagues/[leagueId]/dynasty-hub/handler'

const player = (playerId: string, lineupSection: string) => ({
  playerId, playerName: playerId, position: 'WR', team: null, age: null,
  slotType: lineupSection === 'devy' ? 'taxi' : lineupSection === 'starters' ? 'starter' : lineupSection, lineupSection,
})

function ctx(isUserTeam = true) {
  return {
    sport: 'NFL',
    season: 2026,
    roster: { taxiSlots: 4 },
    availability: { futurePicks: 'available' },
    teams: [
      {
        rosterId: 'r1', ownerName: 'me', teamName: 'Gold', isUserTeam,
        players: [player('t1', 'taxi'), player('d1', 'devy'), player('s1', 'starters'), player('b1', 'bench')],
        picks: [],
      },
    ],
  }
}

const call = async () => (await GET({} as never, { params: Promise.resolve({ leagueId: 'L1' }) })).json()

beforeEach(() => {
  mocks.user = { id: 'me' }
  mocks.context = ctx()
  mocks.seasons = [
    { season: 2024, championName: 'guap', championTeam: { platformUserId: 'me', claimedByUserId: null, teamName: 'Gold' } },
    { season: 2023, championName: 'Owls', championTeam: null },
  ]
  mocks.championships = []
  mocks.yearsExp = new Map([['t1', 0], ['s1', 4]])
  mocks.yearsExpCalls = []
})

describe('dynasty-hub home fields', () => {
  it('titles: pennants oldest first, gold for the viewer, the current season open', async () => {
    const body = await call()
    expect(body.titles).toEqual({
      pennants: [
        { season: 2023, label: 'Owls', mine: false },
        { season: 2024, label: 'guap', mine: true },
      ],
      openSeason: 2026,
      myTitles: 1,
    })
  })

  it('pipeline: devy counted apart from taxi; experience asked only for pros', async () => {
    const body = await call()
    expect(body.pipeline).toEqual({
      taxi: { count: 1, slots: 4 },
      devy: { count: 1 },
      rookies: { count: 1, unknown: 1 },
      rookiesUnknownOnly: 0,
    })
    expect(mocks.yearsExpCalls[0]?.[1]).toEqual(['t1', 's1', 'b1'])
    // The devy player still appears in the taxi list exactly as before (that list is unchanged).
    expect(body.taxi.map((p: { id: string }) => p.id)).toEqual(['t1', 'd1'])
  })

  it('no team (commissioner host): titles still returned, no pipeline', async () => {
    mocks.context = ctx(false)
    const body = await call()
    expect(body.hasTeam).toBe(false)
    expect(body.titles?.pennants).toHaveLength(2)
    expect(body.pipeline).toBeNull()
  })

  it('no history → titles null', async () => {
    mocks.seasons = []
    expect((await call()).titles).toBeNull()
  })
})
