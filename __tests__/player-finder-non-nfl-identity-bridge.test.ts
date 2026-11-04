import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  playerIdentityMap: { findMany: vi.fn() },
  league: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { identityForFinderPlayer, resolveNonNflLeagueSlots, rosterIdForFinderPlayer } from '@/lib/core-app/playerFinderIdentityBridge'

const player = { sport: 'NCAAF', source: 'rolling_insights', externalId: '340', name: 'Jordan Smith', position: 'QB' }
const identity = {
  id: 'identity-1', canonicalName: 'Jordan Smith', position: 'QB', rollingInsightsId: '340', sleeperId: null, sleeperNbaId: null, cfbdId: null,
  espnId: '777', mflId: null, fleaflickerId: null, fantraxId: '06k5m',
}
const leagues = [
  { id: 'native', name: 'College Native', sport: 'NCAAF', platform: 'allfantasy', leagueType: 'dynasty', platformLeagueId: 'n1', season: 2026, bestBallMode: false, leagueVariant: null, settings: {} },
  { id: 'fantrax', name: 'College Fantrax', sport: 'NCAAF', platform: 'fantrax', leagueType: 'dynasty', platformLeagueId: 'f1', season: 2026, bestBallMode: false, leagueVariant: null, settings: {} },
  { id: 'espn', name: 'College ESPN', sport: 'NCAAF', platform: 'espn', leagueType: 'dynasty', platformLeagueId: 'e1', season: 2026, bestBallMode: false, leagueVariant: null, settings: {} },
]
const rosters = [
  { leagueId: 'native', platformUserId: 'me', playerData: { players: ['340'], starters: ['340'] } },
  { leagueId: 'fantrax', platformUserId: 'rival', playerData: { players: ['06k5m'] } },
  // Same digits as the Rolling Insights id. ESPN's 340 belongs to somebody else.
  { leagueId: 'espn', platformUserId: 'other', playerData: { players: ['340'] } },
]
const teams = [
  { leagueId: 'native', platformUserId: 'me', externalId: '1', claimedByUserId: 'u1', ownerName: 'Me', teamName: 'Mine', avatarUrl: null },
  { leagueId: 'fantrax', platformUserId: 'rival', externalId: '2', claimedByUserId: null, ownerName: 'Rival', teamName: 'Rivals', avatarUrl: null },
  { leagueId: 'espn', platformUserId: 'other', externalId: '3', claimedByUserId: null, ownerName: 'Other', teamName: 'Others', avatarUrl: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  db.playerIdentityMap.findMany.mockImplementation(async () => [{ ...identity, sport: 'NCAAF' }])
  db.league.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    leagues.filter((l) => where.id.in.includes(l.id)))
  db.roster.findMany.mockImplementation(async ({ where }: { where: { leagueId: { in: string[] } } }) =>
    rosters.filter((r) => where.leagueId.in.includes(r.leagueId)))
  db.leagueTeam.findMany.mockImplementation(async ({ where }: { where: { leagueId: { in: string[] } } }) =>
    teams.filter((t) => where.leagueId.in.includes(t.leagueId)))
})

describe('Player Finder sport-qualified identity bridge', () => {
  it.each(['NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'])(
    'uses a %s Rolling Insights id only in a native league of that sport',
    (sport) => {
      const athlete = { ...player, sport }
      expect(rosterIdForFinderPlayer(athlete, 'allfantasy', null)).toBe('340')
      expect(rosterIdForFinderPlayer(athlete, 'fantrax', null)).toBeNull()
    },
  )

  it('reads a Sleeper NBA id only in an NBA Sleeper league', () => {
    const athlete = { sport: 'NBA', source: 'sleeper', externalId: 'sleeper:1029', sleeperId: '1029' }
    expect(rosterIdForFinderPlayer(athlete, 'sleeper', null)).toBe('1029')
    expect(rosterIdForFinderPlayer(athlete, 'allfantasy', null)).toBeNull()
    expect(rosterIdForFinderPlayer({ ...athlete, sport: 'NFL' }, 'sleeper', null)).toBeNull()
  })

  it('uses the NBA-specific crosswalk for an RI player on a Sleeper NBA roster', async () => {
    const nba = { sport: 'NBA', source: 'rolling_insights', externalId: '340', name: 'Jordan Smith', position: 'PG' }
    db.playerIdentityMap.findMany.mockImplementation(async ({ select }: { select: { canonicalName?: boolean } }) =>
      select.canonicalName ? [{ ...identity, sport: 'NBA', position: 'PG', sleeperNbaId: '1029' }] :
        [{ ...identity, sport: 'NBA', position: 'PG', sleeperNbaId: '1029' }])
    const mapped = await identityForFinderPlayer(nba)
    expect(rosterIdForFinderPlayer(nba, 'sleeper', mapped)).toBe('1029')
    expect(rosterIdForFinderPlayer({ ...nba, sport: 'NHL' }, 'sleeper', mapped)).toBeNull()
  })

  it('finds native and Fantrax rosters without treating an ESPN numeric collision as the same player', async () => {
    const result = await resolveNonNflLeagueSlots(player, leagues.map((l) => l.id), 'u1')
    expect(result.resolved).toBe(true)
    expect(result.slots.map((s) => [s.leagueId, s.isYours, s.slot])).toEqual([
      ['native', true, 'STARTER'],
      ['fantrax', false, 'NOT YOURS'],
    ])
    expect(db.playerIdentityMap.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ sport: 'NCAAF', rollingInsightsId: '340' }] },
    }))
  })

  it('does not scan a provider roster when its id has no verified map', async () => {
    db.playerIdentityMap.findMany.mockResolvedValue([])
    const result = await resolveNonNflLeagueSlots(player, ['native', 'fantrax', 'espn'], 'u1')
    expect(result.slots.map((s) => s.leagueId)).toEqual(['native'])
    expect(result.unmatched.map((l) => l.leagueId)).toEqual(['fantrax', 'espn'])
  })

  it('marks a league with no readable rosters as unchecked rather than available', async () => {
    db.roster.findMany.mockResolvedValueOnce([])
    const result = await resolveNonNflLeagueSlots(player, ['fantrax'], 'u1')
    expect(result.slots).toEqual([])
    expect(result.unmatched.map((l) => l.leagueId)).toEqual(['fantrax'])
  })

  it('refuses ambiguous or wrong-name identity rows', async () => {
    db.playerIdentityMap.findMany.mockResolvedValueOnce([{ ...identity, sport: 'NCAAF' }, { ...identity, sport: 'NCAAF', canonicalName: 'Another Player' }])
    expect(await identityForFinderPlayer(player)).toBeNull()
    db.playerIdentityMap.findMany.mockResolvedValueOnce([{ ...identity, sport: 'NCAAF', canonicalName: 'Another Player' }])
    expect(await identityForFinderPlayer(player)).toBeNull()
    db.playerIdentityMap.findMany.mockResolvedValueOnce([{ ...identity, sport: 'NCAAF', position: 'LB' }])
    expect(await identityForFinderPlayer(player)).toBeNull()
  })

  it('drops a target provider id that belongs to two identity rows', async () => {
    db.playerIdentityMap.findMany.mockImplementation(async ({ select }: { select: { canonicalName?: boolean } }) =>
      select.canonicalName ? [{ ...identity, sport: 'NCAAF' }] : [
        { ...identity, sport: 'NCAAF' },
        { ...identity, sport: 'NCAAF', id: 'identity-2', rollingInsightsId: null, espnId: null },
      ])
    const result = await resolveNonNflLeagueSlots(player, ['native', 'fantrax'], 'u1')
    expect(result.slots.map((s) => s.leagueId)).toEqual(['native'])
    expect(result.unmatched.map((l) => l.leagueId)).toEqual(['fantrax'])
  })

  it('does not treat a source-colliding soccer id as a Rolling Insights or API-Sports roster id', async () => {
    const soccer = { sport: 'SOCCER', source: 'api_football', externalId: '1100' }
    expect(rosterIdForFinderPlayer(soccer, 'allfantasy', null)).toBeNull()
    expect(rosterIdForFinderPlayer(soccer, 'fantrax', null)).toBeNull()
    expect(await identityForFinderPlayer({ ...soccer, name: 'Erling Haaland' })).toBeNull()
    expect(db.playerIdentityMap.findMany).not.toHaveBeenCalled()
  })
})
