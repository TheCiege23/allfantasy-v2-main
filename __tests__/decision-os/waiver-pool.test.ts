/**
 * R2.6 — the waiver wire pool, the input that made `waiverDecision` unproducible.
 *
 * The subtraction is the first correctness question: a pool that removes only YOUR players
 * recommends people your opponents already roster, with a FAAB bid attached. That is worse than no
 * recommendation, because it looks actionable.
 *
 * 🛑 THE SECOND IS THE PRICE. Until 2026-09-17 this module sent `{id, name, position}`, so the
 * scorer (which skips `value < 200`) dropped every candidate and every waiver answer was "Hold your
 * FAAB". These tests pin what it now sends: a league-adjusted value, the asker's slotted roster,
 * every roster in the league, the league's own slots and traits, and honest pricing coverage.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const rosterFindMany = vi.fn()
const leagueFindUnique = vi.fn()
const playerFindMany = vi.fn()
const getPool = vi.fn()
const getMarketValues = vi.fn()
const marketContextFor = vi.fn()
const latestProjectionWeek = vi.fn()
const resolveByeWeekMap = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: (a: unknown) => rosterFindMany(a) },
    league: { findUnique: (a: unknown) => leagueFindUnique(a) },
    sportsPlayer: { findMany: (a: unknown) => playerFindMany(a) },
  },
}))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForSport: (s: string, o: unknown) => getPool(s, o),
}))
vi.mock('@/lib/waiver-wire/roster-utils', () => ({
  getRosterPlayerIds: (pd: unknown) => ((pd as { ids?: string[] })?.ids ?? []),
}))
vi.mock('@/lib/player-identity/externalIdNamespace', () => ({
  sleeperIdWhere: (ids: readonly string[], sport?: string) => ({ sport, sleeperId: { in: [...ids] } }),
}))
vi.mock('@/lib/core-app/playerTradeVisual', () => ({
  marketContextFor: (...a: unknown[]) => marketContextFor(...a),
}))
vi.mock('@/lib/trade-intel/marketValueService', () => ({
  getMarketValues: (...a: unknown[]) => getMarketValues(...a),
  /* The real per-position adjustment is pinned in the market-value suite; here it is the identity. */
  playerValueForLeague: (values: { bySleeperId: Record<string, { value: number }> }, sleeperId: string) => {
    const v = values.bySleeperId[sleeperId]
    return v ? { base: v.value, adjusted: v.value, fit: null } : null
  },
}))
vi.mock('@/lib/core-app/playerProjections', () => ({
  latestProjectionWeek: () => latestProjectionWeek(),
}))
vi.mock('@/lib/core-app/byeWeekMap', () => ({ resolveByeWeekMap: (...a: unknown[]) => resolveByeWeekMap(...a) }))

const { loadWaiverPool } = await import('@/lib/decision-os/waiver/pool')

const player = (id: string, over: Record<string, unknown> = {}) => ({
  player_id: id,
  external_source_id: null,
  full_name: `Player ${id}`,
  position: 'WR',
  ...over,
})

const VALUES = { mode: 'redraft', numQbs: 1, ppr: 0.5, bySleeperId: { '4046': { value: 2200 }, '9221': { value: 900 } } }

beforeEach(() => {
  for (const f of [rosterFindMany, leagueFindUnique, playerFindMany, getPool, getMarketValues, marketContextFor, latestProjectionWeek, resolveByeWeekMap]) {
    f.mockReset()
  }
  rosterFindMany.mockResolvedValue([])
  leagueFindUnique.mockResolvedValue({
    settings: { roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN'] },
    leagueType: 'Redraft',
    leagueSize: 12,
    season: 2026,
  })
  playerFindMany.mockResolvedValue([])
  getPool.mockResolvedValue([])
  marketContextFor.mockReturnValue({
    teams: 12,
    variant: { superflex: false, dynasty: false, keeper: false, idp: false, bestBall: false },
    scoring: { settings: { rec: 0.5 }, receptionWeight: 0.5, format: 'half_ppr' },
  })
  getMarketValues.mockResolvedValue(VALUES)
  latestProjectionWeek.mockResolvedValue({ season: '2026', week: 3 })
  resolveByeWeekMap.mockResolvedValue({ KC: 6, SEA: 9 })
})

describe('loadWaiverPool — the subtraction', () => {
  it('🛑 subtracts EVERY roster in the league, not just the asker’s', async () => {
    rosterFindMany.mockResolvedValue([
      { id: 'r-1', platformUserId: 'u1', playerData: { ids: ['p1'] } },
      { id: 'r-2', platformUserId: 'u2', playerData: { ids: ['p2'] } },
    ])
    getPool.mockResolvedValue([player('p1'), player('p2'), player('p3')])

    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.availablePlayers.map((p) => p.id)).toEqual(['p3'])
    expect(out.leagueRosterCount).toBe(2)
  })

  it('matches on external_source_id too, since the pool and rosters key differently', async () => {
    rosterFindMany.mockResolvedValue([{ id: 'r-1', platformUserId: 'u1', playerData: { ids: ['sleeper-99'] } }])
    getPool.mockResolvedValue([player('p9', { external_source_id: 'sleeper-99' }), player('p8')])

    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.availablePlayers.map((p) => p.id)).toEqual(['p8'])
  })

  it('also subtracts a player found only in a stored lineup slot', async () => {
    /* `getRosterPlayerIds` and the slot lists can disagree; a starter missing from one is still rostered. */
    rosterFindMany.mockResolvedValue([
      { id: 'r-1', platformUserId: 'u1', playerData: { ids: [], starters: ['p1'], players: ['p2'] } },
    ])
    getPool.mockResolvedValue([player('p1'), player('p2'), player('p3')])

    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.availablePlayers.map((p) => p.id)).toEqual(['p3'])
  })

  it('reports poolIncomplete when the resolver returned a full page', async () => {
    getPool.mockResolvedValue(Array.from({ length: 300 }, (_, i) => player(`p${i}`)))
    expect((await loadWaiverPool('L1', 'NFL')).poolIncomplete).toBe(true)
  })

  it('is NOT incomplete when the wire is genuinely smaller than the cap', async () => {
    getPool.mockResolvedValue([player('p1'), player('p2')])
    expect((await loadWaiverPool('L1', 'NFL')).poolIncomplete).toBe(false)
  })

  it('surfaces an empty league as leagueRosterCount 0 rather than a silent full pool', async () => {
    getPool.mockResolvedValue([player('p1')])
    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.leagueRosterCount).toBe(0)
    expect(out.availablePlayers).toHaveLength(1)
  })

  it('defaults a missing position to FLEX and uppercases, matching the waiver assistant exactly', async () => {
    getPool.mockResolvedValue([player('p1', { position: null }), player('p2', { position: 'rb' })])
    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.availablePlayers.map((p) => p.position)).toEqual(['FLEX', 'RB'])
  })

  it('reads rosters and the pool CONCURRENTLY, not one after the other', async () => {
    let rostersStarted = 0
    let poolStarted = 0
    let order = 0
    rosterFindMany.mockImplementation(async () => {
      rostersStarted = ++order
      await new Promise((r) => setTimeout(r, 20))
      return []
    })
    getPool.mockImplementation(async () => {
      poolStarted = ++order
      return []
    })

    await loadWaiverPool('L1', 'NFL')
    expect(Math.abs(rostersStarted - poolStarted)).toBe(1)
  })
})

describe('loadWaiverPool — the price', () => {
  it('🛑 prices the wire from THIS league’s value set, by sleeper id', async () => {
    getPool.mockResolvedValue([
      player('p1', { external_source_id: '4046', full_name: 'Priced Add', position: 'RB', team_abbreviation: 'DET', age: 23 }),
      player('p2', { external_source_id: '999999', full_name: 'Unpriced Add' }),
    ])
    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.availablePlayers).toEqual([
      { id: 'p1', name: 'Priced Add', position: 'RB', team: 'DET', age: 23, value: 2200, byeWeek: null },
      { id: 'p2', name: 'Unpriced Add', position: 'WR', team: null, age: null, value: 0, byeWeek: null },
    ])
    expect(out.pricing).toEqual({ priced: 1, total: 2, basis: 'redraft, 1QB, 12 teams, 0.5 PPR' })
    expect(marketContextFor).toHaveBeenCalledWith({ roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN'] }, 'Redraft', 12)
  })

  it('🛑 a provider id in that column is not read as a sleeper id', async () => {
    /* `external_source_id` falls back to a provider id, and bare-number providers collide with sleeper ids. */
    getPool.mockResolvedValue([
      player('p1', { external_source_id: 'ri:4046' }),
      player('p2', { external_source_id: 'nfl:def:KC', position: 'DEF' }),
    ])
    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.availablePlayers.map((p) => p.value)).toEqual([0, 0])
    expect(out.pricing.priced).toBe(0)
  })

  it('🛑 never asks the sleeper column for a provider id', async () => {
    /*
     * `SportsPlayer.externalId` carries bare-number provider ids that collide with sleeper ids, so a
     * lookup that passes one through joins to whatever row happens to share the digits.
     */
    rosterFindMany.mockResolvedValue([
      { id: 'r-1', platformUserId: 'u1', playerData: { ids: ['4046', 'ri:9221', 'nfl:def:KC'] } },
    ])
    await loadWaiverPool('L1', 'NFL', 'r-1')
    expect(playerFindMany).toHaveBeenCalledTimes(1)
    expect(playerFindMany.mock.calls[0][0].where).toEqual({ sport: 'NFL', sleeperId: { in: ['4046'] } })
  })

  it('reports an unpriced wire rather than scoring it zero silently', async () => {
    getMarketValues.mockResolvedValue(null)
    getPool.mockResolvedValue([player('p1', { external_source_id: '4046' })])
    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.pricing).toEqual({ priced: 0, total: 1, basis: null })
  })

  it('survives a value service that throws', async () => {
    getMarketValues.mockRejectedValue(new Error('down'))
    getPool.mockResolvedValue([player('p1', { external_source_id: '4046' })])
    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.pricing.priced).toBe(0)
    expect(out.availablePlayers).toHaveLength(1)
  })
})

describe('loadWaiverPool — the rosters', () => {
  const ROSTERS = [
    { id: 'r-mine', platformUserId: 'u1', playerData: { ids: ['4046', '9221'], starters: ['4046'], players: ['4046', '9221'] } },
    { id: 'r-theirs', platformUserId: 'u2', playerData: { ids: ['5555'], starters: ['5555'], players: ['5555'] } },
  ]

  beforeEach(() => {
    rosterFindMany.mockResolvedValue(ROSTERS)
    playerFindMany.mockResolvedValue([
      { sleeperId: '4046', name: 'Starting RB', position: 'RB', team: 'DET', age: 24 },
      { sleeperId: '9221', name: 'Bench WR', position: 'WR', team: 'MIA', age: 27 },
      { sleeperId: '5555', name: 'Their Guy', position: 'TE', team: 'KC', age: 25 },
    ])
  })

  it('🛑 hands back the asker’s roster, slotted and priced — this is what names a drop', async () => {
    const out = await loadWaiverPool('L1', 'NFL', 'r-mine')
    expect(out.myRoster).toEqual([
      { id: '4046', name: 'Starting RB', position: 'RB', team: 'DET', slot: 'starter', age: 24, value: 2200 },
      { id: '9221', name: 'Bench WR', position: 'WR', team: 'MIA', slot: 'bench', age: 27, value: 900 },
    ])
  })

  it('reads the slot from the stored lineup: starters, IR and taxi before bench', async () => {
    rosterFindMany.mockResolvedValue([
      {
        id: 'r-mine',
        platformUserId: 'u1',
        /* A null entry is an empty slot; this repo stores NO '0' marker, so none is invented here. */
        playerData: { starters: ['4046', null], reserve: ['9221'], taxi: ['5555'], players: ['4046', '9221', '5555', '7777'] },
      },
    ])
    const out = await loadWaiverPool('L1', 'NFL', 'r-mine')
    expect(out.myRoster.map((p) => [p.id, p.slot])).toEqual([
      ['4046', 'starter'],
      ['9221', 'ir'],
      ['5555', 'taxi'],
      ['7777', 'bench'],
    ])
  })

  it('every roster in the league is priced too — the median behind "your weakest slot"', async () => {
    const out = await loadWaiverPool('L1', 'NFL', 'r-mine')
    expect(out.leagueRosters).toHaveLength(2)
    expect(out.leagueRosters[1].players.map((p) => p.name)).toEqual(['Their Guy'])
  })

  it('no roster id asked for means no roster returned, not somebody else’s', async () => {
    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.myRoster).toEqual([])
    expect(out.leagueRosters).toHaveLength(2)
  })

  it('a player with no row still appears, under a placeholder rather than a dropped slot', async () => {
    playerFindMany.mockResolvedValue([])
    const out = await loadWaiverPool('L1', 'NFL', 'r-mine')
    expect(out.myRoster.map((p) => p.name)).toEqual(['Player 4046', 'Player 9221'])
    expect(out.myRoster.map((p) => p.value)).toEqual([2200, 900])
  })
})

describe('loadWaiverPool — the league', () => {
  it('carries the league’s own slots, traits and the current week', async () => {
    marketContextFor.mockReturnValue({
      teams: 12,
      variant: { superflex: true, dynasty: false, keeper: true, idp: false, bestBall: false },
      scoring: { settings: { rec: 1, bonus_rec_te: 0.5 }, receptionWeight: 1, format: 'ppr' },
    })
    leagueFindUnique.mockResolvedValue({
      settings: { roster_positions: ['qb', 'rb', 'super_flex', 'bn'] },
      leagueType: 'Keeper',
      leagueSize: 10,
    })
    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.rosterPositions).toEqual(['QB', 'RB', 'SUPER_FLEX', 'BN'])
    /* 10 teams: no rosters are on file, so the league's own size answers. */
    expect(out.leagueTraits).toEqual({ numTeams: 10, isSF: true, isTEP: true, isDynasty: true })
    expect(out.currentWeek).toBe(3)
  })

  it('counts the rosters it found, and falls back to 12 with neither rosters nor a size', async () => {
    rosterFindMany.mockResolvedValue([
      { id: 'a', platformUserId: 'u1', playerData: {} },
      { id: 'b', platformUserId: 'u2', playerData: {} },
    ])
    expect((await loadWaiverPool('L1', 'NFL')).leagueTraits.numTeams).toBe(2)
    rosterFindMany.mockResolvedValue([])
    leagueFindUnique.mockResolvedValue({ settings: null, leagueType: null, leagueSize: null })
    expect((await loadWaiverPool('L1', 'NFL')).leagueTraits.numTeams).toBe(12)
  })

  it('🛑 carries THIS season’s byes, read from the schedule rather than a table', async () => {
    leagueFindUnique.mockResolvedValue({ settings: null, leagueType: null, leagueSize: 12, season: 2026 })
    getPool.mockResolvedValue([
      player('p1', { external_source_id: '4046', team_abbreviation: 'SEA' }),
      player('p2', { external_source_id: '9221', team_abbreviation: 'DET' }),
    ])
    const out = await loadWaiverPool('L1', 'NFL')
    expect(resolveByeWeekMap).toHaveBeenCalledWith(2026, 'NFL')
    expect(out.byeWeekByClub).toEqual({ KC: 6, SEA: 9 })
    /* A candidate's own bye travels with him, so the scorer does not offer cover for the week he is out. */
    expect(out.availablePlayers.map((p) => p.byeWeek)).toEqual([9, null])
  })

  it('falls back to the projection feed’s season, and asks for none without either', async () => {
    leagueFindUnique.mockResolvedValue({ settings: null, leagueType: null, leagueSize: 12, season: null })
    await loadWaiverPool('L1', 'NFL')
    expect(resolveByeWeekMap).toHaveBeenCalledWith(2026, 'NFL')

    resolveByeWeekMap.mockClear()
    latestProjectionWeek.mockResolvedValue(null)
    const out = await loadWaiverPool('L1', 'NFL')
    expect(resolveByeWeekMap).not.toHaveBeenCalled()
    expect(out.byeWeekByClub).toEqual({})
  })

  it('a schedule that cannot answer is an empty slate, not a crash', async () => {
    resolveByeWeekMap.mockRejectedValue(new Error('down'))
    expect((await loadWaiverPool('L1', 'NFL')).byeWeekByClub).toEqual({})
  })

  it('no projection week on file is null, never week 1', async () => {
    /* Week 1 would put every team's bye two weeks out and boost the wrong players. */
    latestProjectionWeek.mockResolvedValue(null)
    expect((await loadWaiverPool('L1', 'NFL')).currentWeek).toBeNull()
  })

  it('a missing league row does not take the pool down', async () => {
    leagueFindUnique.mockResolvedValue(null)
    getPool.mockResolvedValue([player('p1')])
    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.availablePlayers).toHaveLength(1)
    expect(out.rosterPositions).toEqual([])
  })
})
