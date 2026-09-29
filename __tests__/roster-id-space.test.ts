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
  sleeperReadablePlayerDataOf,
  sleeperReadableRosters,
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
  /*
   * This pinned "keeps an unlinked id as it is", on the theory that it fails every Sleeper-id match
   * honestly. ESPN 12483 (Matthew Stafford) IS Sleeper's 12483 (Jack Bech): a kept id is a HIT.
   */
  it('rewrites every roster array through the map, DROPS an unlinked id, and leaves other keys alone', () => {
    const pd = { players: ['4430737', 2577417, '12483'], starters: ['4430737'], reserve: [], taxi: null, import: { proTeamId: '1' } }
    expect(translatePlayerData(pd, MAP)).toEqual({
      players: ['9509', '3294'],
      starters: ['9509'],
      reserve: [],
      taxi: null,
      import: { proTeamId: '1' },
    })
  })

  it('translates lineup_sections entries too — objects keep their other fields, unlinked entries drop', () => {
    const pd = {
      lineup_sections: { starters: [{ id: '4430737', position: 'RB' }, { id: '12483', position: 'QB' }], bench: ['2577417'], note: 'kept' },
      ir: ['12483'],
    }
    expect(translatePlayerData(pd, MAP)).toEqual({
      lineup_sections: { starters: [{ id: '9509', position: 'RB' }], bench: ['3294'], note: 'kept' },
      ir: [],
    })
  })

  it('with an empty map every roster id drops — no id is a Sleeper id until the map says whose', () => {
    expect(translatePlayerData({ players: ['12483'], settings: { x: 1 } }, new Map())).toEqual({ players: [], settings: { x: 1 } })
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
    // 99999 has no identity row: counted in `total`, dropped from the roster (it used to be kept).
    expect(out.rosters.map((r) => r.playerData)).toEqual([
      { players: ['9509'], starters: ['9509'] },
      { players: ['3294'] },
    ])
  })

  it('never reads for a Sleeper-id league, and never rewrites it', async () => {
    const rosters = [{ platformUserId: 'a', playerData: { players: ['4430737'] } }]
    const out = await translateRostersToSleeperIds('sleeper', rosters)
    expect(out.rosters[0]!.playerData).toEqual({ players: ['4430737'] })
    expect(mockIdentityFindMany).not.toHaveBeenCalled()
  })

  /*
   * This used to pin "leaves a Yahoo league UNTOUCHED". Untouched was the bug: a foreign roster's ids
   * reached Sleeper-id reads (44 of 248 Fleaflicker ids ARE Sleeper ids, 2026-09-27). It is now
   * stripped — and still costs no read, since there is no column to translate through.
   */
  it('strips a Yahoo league, with no read: there is no column to translate through yet', async () => {
    const out = await translateRostersToSleeperIds('yahoo', [{ platformUserId: 'a', playerData: { players: ['461.p.100'] } }])
    expect(out.idSpace).toBe('other')
    expect(out.rosters[0]!.playerData).toEqual({ players: [] })
    expect(out.total).toBe(1)
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

/*
 * THE one way to read rosters as Sleeper ids. ESPN 12483 is Matthew Stafford (Sleeper 421) and Sleeper
 * 12483 is Jack Bech — on 8 production ESPN rosters, 2026-09-29 — so an ESPN id is a Sleeper id only
 * once the identity map says whose, and one it cannot place drops rather than colliding.
 */
describe('sleeperReadableRosters', () => {
  const STAFFORD_ROSTER = { players: ['2577417', '12483'], starters: ['12483'], lineup_sections: { starters: [{ id: '12483' }] } }

  it('translates ESPN, drops the unplaceable id, strips a foreign platform, and leaves Sleeper/native as the same object', async () => {
    const sleeper = { leagueId: 'S', playerData: { players: ['12483'] } }
    const native = { leagueId: 'N', playerData: { players: ['12483'] } }
    const out = await sleeperReadableRosters(
      [
        sleeper,
        native,
        { leagueId: 'E', playerData: STAFFORD_ROSTER },
        { leagueId: 'F', playerData: { players: ['12483'], starters: ['12483'] } },
      ],
      (r) => ({ S: 'sleeper', N: 'manual', E: 'espn', F: 'fleaflicker' })[r.leagueId],
    )
    expect(out[0]).toBe(sleeper)
    expect(out[1]).toBe(native)
    // 2577417 → Dak's 3294; 12483 has no identity row here, so it is gone — never read as Jack Bech.
    expect(out[2]!.playerData).toEqual({ players: ['3294'], starters: [], lineup_sections: { starters: [] } })
    expect(out[3]!.playerData).toEqual({ players: [], starters: [] })
  })

  it('asks the identity map ONCE for every ESPN roster passed, and not at all without one', async () => {
    await sleeperReadableRosters(
      [{ playerData: { players: ['4430737'] } }, { playerData: { players: ['2577417'] } }],
      'espn',
    )
    expect(mockIdentityFindMany).toHaveBeenCalledTimes(1)
    mockIdentityFindMany.mockClear()
    await sleeperReadableRosters([{ playerData: { players: ['12483'] } }], 'sleeper')
    await sleeperReadableRosters([{ playerData: { players: ['12483'] } }], 'fleaflicker')
    expect(mockIdentityFindMany).not.toHaveBeenCalled()
  })

  it('an array-shaped playerData from ESPN comes back empty rather than guessed at', async () => {
    const out = await sleeperReadableRosters([{ playerData: ['12483'] as unknown }], 'espn')
    expect(out[0]!.playerData).toEqual([])
  })

  it('sleeperReadablePlayerDataOf is the one-roster form of the same rule', async () => {
    expect(await sleeperReadablePlayerDataOf('espn', { players: ['4430737', '12483'] })).toEqual({ players: ['9509'] })
    const pd = { players: ['12483'] }
    expect(await sleeperReadablePlayerDataOf('sleeper', pd)).toBe(pd)
  })
})
