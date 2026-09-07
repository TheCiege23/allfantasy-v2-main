import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * ESPN rosters speak ESPN ids; the Finder reads Sleeper ids. The bridge is
 * PlayerIdentityMap.espnId -> sleeperId, which the import pipeline maintains.
 * Pure translation here, plus the one read, mocked at the module boundary.
 */

const mockIdentityFindMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { playerIdentityMap: { findMany: mockIdentityFindMany } } }))

import {
  collectRosterIds,
  loadEspnToSleeperMap,
  rosterIdSpaceOf,
  translatePlayerData,
  translateRostersByLeague,
  translateRostersToSleeperIds,
} from '@/lib/core-app/rosterIdSpace'

const MAP = new Map([
  ['4430737', '9509'], // Kyren Williams
  ['2577417', '3294'], // Dak Prescott
])

beforeEach(() => {
  vi.clearAllMocks()
  mockIdentityFindMany.mockImplementation(async (args: { where: { espnId: { in: string[] } } }) =>
    args.where.espnId.in.filter((id) => MAP.has(id)).map((id) => ({ espnId: id, sleeperId: MAP.get(id)! })),
  )
})

describe('rosterIdSpaceOf', () => {
  it('ESPN is its own vocabulary; Sleeper, manual and AllFantasy leagues are Sleeper ids; anything else is unknown', () => {
    expect(rosterIdSpaceOf('espn')).toBe('espn')
    expect(rosterIdSpaceOf('ESPN ')).toBe('espn')
    for (const p of ['sleeper', 'manual', 'allfantasy', '', null, undefined]) expect(rosterIdSpaceOf(p)).toBe('sleeper')
    expect(rosterIdSpaceOf('yahoo')).toBe('other')
  })
})

describe('translatePlayerData', () => {
  it('rewrites every roster array through the map, keeps an unlinked id as it is, and leaves other keys alone', () => {
    const pd = { players: ['4430737', 2577417, '99999'], starters: ['4430737'], reserve: [], taxi: null, import: { proTeamId: '1' } }
    expect(translatePlayerData(pd, MAP)).toEqual({
      players: ['9509', '3294', '99999'],
      starters: ['9509'],
      reserve: [],
      taxi: null,
      import: { proTeamId: '1' },
    })
  })

  it('returns the input untouched for an empty map', () => {
    const pd = { players: ['1'] }
    expect(translatePlayerData(pd, new Map())).toBe(pd)
  })
})

describe('collectRosterIds', () => {
  it('draws distinct string ids across every roster array', () => {
    expect(collectRosterIds([{ players: ['1', 2], starters: [2] }, { players: ['3'], reserve: ['1'] }]).sort()).toEqual(['1', '2', '3'])
  })
})

describe('loadEspnToSleeperMap', () => {
  it('asks once for the distinct ids and keeps only rows carrying both ids', async () => {
    mockIdentityFindMany.mockResolvedValueOnce([
      { espnId: '4430737', sleeperId: '9509' },
      { espnId: '1', sleeperId: null },
      { espnId: null, sleeperId: '7' },
    ])
    const map = await loadEspnToSleeperMap(['4430737', '4430737', '1', ''])
    expect([...map.entries()]).toEqual([['4430737', '9509']])
    expect(mockIdentityFindMany).toHaveBeenCalledTimes(1)
    expect(mockIdentityFindMany.mock.calls[0][0].where.espnId.in).toEqual(['4430737', '1'])
  })

  it('is empty, without a read, when there is nothing to ask about', async () => {
    expect((await loadEspnToSleeperMap([])).size).toBe(0)
    expect(mockIdentityFindMany).not.toHaveBeenCalled()
  })
})

describe('translateRostersToSleeperIds', () => {
  it('translates an ESPN league\'s rosters and reports how many ids it could', async () => {
    const out = await translateRostersToSleeperIds('espn', [
      { platformUserId: 'a', playerData: { players: ['4430737', '99999'], starters: ['4430737'] } },
      { platformUserId: 'b', playerData: { players: ['2577417'] } },
    ])
    expect(out.idSpace).toBe('espn')
    expect(out.total).toBe(3)
    expect(out.translated).toBe(2)
    expect(out.rosters.map((r) => r.playerData)).toEqual([
      { players: ['9509', '99999'], starters: ['9509'] },
      { players: ['3294'] },
    ])
  })

  it('never reads for a Sleeper-id league, and never rewrites it', async () => {
    const rosters = [{ platformUserId: 'a', playerData: { players: ['4430737'] } }]
    const out = await translateRostersToSleeperIds('sleeper', rosters)
    expect(out.rosters[0]!.playerData).toEqual({ players: ['4430737'] })
    expect(mockIdentityFindMany).not.toHaveBeenCalled()
  })

  it('leaves a Yahoo league untouched, with no read: there is no column to translate through yet', async () => {
    const out = await translateRostersToSleeperIds('yahoo', [{ platformUserId: 'a', playerData: { players: ['461.p.100'] } }])
    expect(out.idSpace).toBe('other')
    expect(out.rosters[0]!.playerData).toEqual({ players: ['461.p.100'] })
    expect(mockIdentityFindMany).not.toHaveBeenCalled()
  })
})

describe('translateRostersByLeague', () => {
  it('translates only the ESPN leagues\' rosters, with one read for all of them', async () => {
    const platforms = new Map([['L-espn-1', 'espn'], ['L-espn-2', 'espn'], ['L-sleeper', 'sleeper']])
    const out = await translateRostersByLeague(
      [
        { leagueId: 'L-espn-1', platformUserId: 'a', playerData: { players: ['4430737'] } },
        { leagueId: 'L-sleeper', platformUserId: 'b', playerData: { players: ['4430737'] } },
        { leagueId: 'L-espn-2', platformUserId: 'c', playerData: { players: ['2577417'] } },
        { leagueId: 'L-unknown', platformUserId: 'd', playerData: { players: ['2577417'] } },
      ],
      platforms,
    )
    expect(out.map((r) => r.playerData.players)).toEqual([['9509'], ['4430737'], ['3294'], ['2577417']])
    expect(mockIdentityFindMany).toHaveBeenCalledTimes(1)
    expect(mockIdentityFindMany.mock.calls[0][0].where.espnId.in.sort()).toEqual(['2577417', '4430737'])
  })
})
