import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * "Your shares" loaders (Phase 2) against a mocked database boundary: the all-leagues board
 * (playerShares.ts) and the same players read in one league (playerSharesLeague.ts).
 */

const db = vi.hoisted(() => ({
  teamFindMany: vi.fn(),
  leagueFindMany: vi.fn(),
  leagueFindUnique: vi.fn(),
  rosterFindMany: vi.fn(),
  playerFindMany: vi.fn(),
  injuryFindMany: vi.fn(),
  identityFindMany: vi.fn(),
  statFindMany: vi.fn(),
}))
const mockValueMap = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: db.teamFindMany },
    league: { findMany: db.leagueFindMany, findUnique: db.leagueFindUnique },
    roster: { findMany: db.rosterFindMany },
    sportsPlayer: { findMany: db.playerFindMany },
    sportsInjury: { findMany: db.injuryFindMany },
    playerIdentityMap: { findMany: db.identityFindMany },
    playerGameStat: { findMany: db.statFindMany },
  },
}))
vi.mock('@/lib/core-app/playerDepth', () => ({ loadLeagueValueMap: mockValueMap }))

import { loadPlayerShares } from '@/lib/core-app/playerShares'
import { loadLeagueShareView } from '@/lib/core-app/playerSharesLeague'

const catalog = (id: string, name: string, team = 'NYG') => ({ sleeperId: id, sport: 'NFL', externalId: `x-${id}`, name, position: 'WR', team, imageUrl: null })

beforeEach(() => {
  vi.clearAllMocks()
  db.identityFindMany.mockResolvedValue([])
  db.injuryFindMany.mockResolvedValue([])
})

describe('loadPlayerShares', () => {
  beforeEach(() => {
    db.teamFindMany.mockResolvedValue([
      { leagueId: 'S1', platformUserId: 'me-s1', externalId: '1' },
      { leagueId: 'S2', platformUserId: 'me-s2', externalId: '1' },
      { leagueId: 'E1', platformUserId: 'me-e1', externalId: '7' },
      { leagueId: 'Y1', platformUserId: 'me-y1', externalId: '3' },
    ])
    db.leagueFindMany.mockResolvedValue([
      { id: 'S1', platform: 'sleeper' },
      { id: 'S2', platform: 'sleeper' },
      { id: 'E1', platform: 'espn' },
      { id: 'Y1', platform: 'yahoo' },
    ])
    db.rosterFindMany.mockResolvedValue([
      { leagueId: 'S1', platformUserId: 'me-s1', playerData: { starters: ['100', '200'], players: ['100', '200', '300'] } },
      { leagueId: 'S1', platformUserId: 'someone-else', playerData: { players: ['999'] } }, // not yours
      { leagueId: 'S2', platformUserId: 'me-s2', playerData: { starters: ['100'], players: ['100', '300'] } },
      // ESPN: 4046 links to 100; 5555 is unlinked and must not become Sleeper 5555.
      { leagueId: 'E1', platformUserId: 'me-e1', playerData: { starters: ['4046'], players: ['4046', '5555'] } },
      // Yahoo ids cannot be translated: the league is counted as unreadable, never read.
      { leagueId: 'Y1', platformUserId: 'me-y1', playerData: { players: ['100', '300'] } },
    ])
    db.identityFindMany.mockResolvedValue([{ espnId: '4046', sleeperId: '100' }])
    db.playerFindMany.mockImplementation(async ({ where }: { where: { sleeperId: { in: string[] } } }) =>
      // Every number is SOMEBODY in the Sleeper catalog — which is exactly why a raw ESPN id must never be looked up.
      where.sleeperId.in.map((id) => catalog(id, `Player ${id}`)),
    )
    db.injuryFindMany.mockResolvedValue([{ playerName: 'Player 100', team: 'NYG', status: 'Out', description: 'Knee', date: new Date('2026-09-26T20:00:00Z'), fetchedAt: new Date('2026-09-27T12:00:00Z') }])
  })

  it('counts your rosters only, ESPN translated, unlinked and untranslatable ids never read', async () => {
    const out = await loadPlayerShares('me', ['S1', 'S2', 'E1', 'Y1'])
    if (!out.available) throw new Error(out.reason)
    expect(out.data.leaguesRead).toBe(3)
    expect(out.data.unsupportedLeagues).toBe(1)
    expect(out.data.rows.map((r) => [r.player.sleeperId, r.leagues, r.starts])).toEqual([
      ['100', 3, 3],
      ['300', 2, 0],
      ['200', 1, 1],
    ])
    expect(out.data.rows.some((r) => r.player.sleeperId === '999' || r.player.sleeperId === '5555')).toBe(false)
  })

  it('flags the hurt and stays quiet about the healthy', async () => {
    const out = await loadPlayerShares('me', ['S1', 'S2', 'E1', 'Y1'])
    if (!out.available) throw new Error(out.reason)
    expect(out.data.rows[0]).toMatchObject({ status: { tone: 'bad', label: 'Out' }, description: 'Knee' })
    expect(out.data.rows[1].status).toBeNull()
  })

  it('says why when there is nothing to read', async () => {
    expect(await loadPlayerShares(null, ['S1'])).toMatchObject({ available: false })
    db.teamFindMany.mockResolvedValue([])
    expect(await loadPlayerShares('me', ['S1'])).toMatchObject({ available: false })
  })
})

describe('loadLeagueShareView', () => {
  const rows = ['100', '300', '400', '500'].map((id) => ({ player: { sport: 'NFL', externalId: `x-${id}`, sleeperId: id, name: `P${id}`, position: 'WR', team: 'NYG', imageUrl: null }, leagues: 2, starts: 1, ir: 0, leagueIds: [], status: null, description: null }))

  beforeEach(() => {
    db.leagueFindUnique.mockResolvedValue({ id: 'S1', name: 'KBFL', platform: 'sleeper', settings: { scoring_settings: { rec: 1, rec_yd: 0.1 } } })
    db.rosterFindMany.mockResolvedValue([
      { platformUserId: 'me-s1', playerData: { starters: ['100'], players: ['100'], reserve: ['500'] } },
      // A Sleeper import carries the roster's own id; the shared owner rule (teamForRoster) matches on it first.
      { platformUserId: 'rival', playerData: { players: ['300'], source_team_id: 2 } },
    ])
    db.teamFindMany.mockResolvedValue([
      { id: 't1', externalId: '1', platformUserId: 'me-s1', claimedByUserId: 'me', ownerName: 'guap', teamName: 'Cafe' },
      { id: 't2', externalId: '2', platformUserId: 'rival', claimedByUserId: null, ownerName: 'tasha', teamName: 'Titans' },
    ])
    db.statFindMany.mockResolvedValue([
      { playerId: '100', weekOrRound: 1, normalizedStatMap: { gp: 1, pts_ppr: 99, rec: 5, rec_yd: 60 } },
      { playerId: '100', weekOrRound: 2, normalizedStatMap: { gp: 1, rec: 3, rec_yd: 40 } },
    ])
    mockValueMap.mockResolvedValue(new Map([['S1', new Map([['100', { value: 4200, base: 4200, fitNote: null, mode: 'redraft', numQbs: 1 }]])]]))
  })

  it('names who has each player in THIS league, and what he has scored under its scoring', async () => {
    const v = await loadLeagueShareView('me', 'S1', rows, { season: 2026 })
    // rec 1 each + 0.1 a yard: wk1 5 + 6 = 11, wk2 3 + 4 = 7 → 18. The feed's own pts_ppr (99) is never read.
    expect(v?.cells['100']).toMatchObject({ holder: { kind: 'you', slot: 'STARTER' }, value: { value: 4200 }, season: { points: 18, games: 2 } })
    expect(v?.cells['300'].holder).toEqual({ kind: 'other', teamName: 'Titans', ownerName: 'tasha' })
    expect(v?.cells['400'].holder).toEqual({ kind: 'free' })
    expect(v?.cells['500'].holder).toEqual({ kind: 'you', slot: 'IR' })
  })

  it('computes no value for a viewer without AF Pro', async () => {
    const v = await loadLeagueShareView('me', 'S1', rows, { season: 2026, includeValues: false })
    expect(mockValueMap).not.toHaveBeenCalled()
    expect(v?.cells['100'].value).toBeNull()
  })

  it('answers "unknown", never "free agent", when the league cannot be read', async () => {
    db.leagueFindUnique.mockResolvedValue({ id: 'Y1', name: 'Yahoo', platform: 'yahoo', settings: {} })
    const v = await loadLeagueShareView('me', 'Y1', rows, { season: 2026 })
    expect(v?.cells['400'].holder).toEqual({ kind: 'unknown' })
    expect(v?.scoringKnown).toBe(false)
    db.leagueFindUnique.mockResolvedValue({ id: 'S1', name: 'KBFL', platform: 'sleeper', settings: {} })
    db.rosterFindMany.mockResolvedValue([])
    const empty = await loadLeagueShareView('me', 'S1', rows, { season: 2026 })
    expect(empty?.cells['400'].holder).toEqual({ kind: 'unknown' })
  })
})
