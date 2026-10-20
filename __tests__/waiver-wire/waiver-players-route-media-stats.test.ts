/**
 * The waiver `/players` route carries each available player's photo, team crest and season stats,
 * read from Postgres. Before 2026-10-20 it joined `sports_players` on the pool's SportsPlayer UUID —
 * an id no `sports_players` row has — so every sport came back with no stats, and outside the NFL
 * the pool row's own photo was dropped on the way to the normalizer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getServerSessionMock,
  leagueFindFirstMock,
  rosterFindFirstMock,
  rosterFindManyMock,
  getPlayerPoolForLeagueMock,
  sportsPlayerRecordFindManyMock,
  storedLogoMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  leagueFindFirstMock: vi.fn(),
  rosterFindFirstMock: vi.fn(),
  rosterFindManyMock: vi.fn(),
  getPlayerPoolForLeagueMock: vi.fn(),
  sportsPlayerRecordFindManyMock: vi.fn(),
  storedLogoMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: leagueFindFirstMock, findUnique: leagueFindFirstMock },
    roster: { findFirst: rosterFindFirstMock, findMany: rosterFindManyMock },
    sportsPlayerRecord: { findMany: sportsPlayerRecordFindManyMock },
  },
}))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForLeague: getPlayerPoolForLeagueMock,
  getPlayerPoolForSport: vi.fn(),
}))
vi.mock('@/lib/sport-teams/storedTeamLogos', () => ({
  getStoredTeamLogoResolver: async () => storedLogoMock,
}))

import { adaptWaiverWirePlayer } from '@/lib/player-data/adapters/waiverPlayerAdapter'
import { matchPoolRowsToRecords } from '@/lib/waiver-wire/waiverPoolEnrichment'

const BRUNSON_PHOTO = 'https://r2.thesportsdb.com/images/media/player/cutout/mr4fe21711892054.png'
const KNICKS_CREST = 'https://r2.thesportsdb.com/images/media/team/badge/knicks.png'

const brunsonStats = {
  points: 1927, total_rebounds: 247, assists: 503, games_played: 74, minutes: 155393, fouls: 170,
}

async function callRoute() {
  const { GET } = await import('@/app/api/waiver-wire/leagues/[leagueId]/players/route')
  const res = await GET({ nextUrl: new URL('http://localhost/api/waiver-wire/leagues/l1/players?limit=200') } as any, {
    params: Promise.resolve({ leagueId: 'l1' }),
  })
  expect(res.status).toBe(200)
  return res.json()
}

describe('waiver players route — photo, crest and stats from the DB', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    rosterFindFirstMock.mockResolvedValue(null)
    rosterFindManyMock.mockResolvedValue([{ playerData: { players: [] } }])
    storedLogoMock.mockImplementation((team: string | null | undefined) => (team === 'New York Knicks' ? KNICKS_CREST : null))
  })

  it('NBA: a pool row with a full team name and a different position still gets its photo, crest and per-game line', async () => {
    leagueFindFirstMock.mockResolvedValue({ id: 'l1', sport: 'NBA', userId: 'u1' })
    getPlayerPoolForLeagueMock.mockResolvedValue([
      {
        player_id: '7d0b2f9e-uuid-not-a-record-id',
        full_name: 'Jalen Brunson',
        position: 'SG',
        team: 'New York Knicks',
        team_abbreviation: 'New York Knicks',
        external_source_id: null,
        image_url: BRUNSON_PHOTO,
        metadata: { source: 'thesportsdb' },
      },
    ])
    sportsPlayerRecordFindManyMock.mockResolvedValue([
      // A statless duplicate must not win over the row that carries the season.
      { id: 'NBA:dup', name: 'Jalen Brunson', team: 'NYK', position: 'PG', stats: {}, projections: {}, adp: null, dataSource: 'x', headshotSource: null },
      { id: 'NBA:jalen-brunson:NEW YORK KNICKS', name: 'Jalen Brunson', team: 'NYK', position: 'PG', stats: brunsonStats, projections: {}, adp: 29.34, dataSource: 'rolling_insights', headshotSource: null },
    ])

    const data = await callRoute()
    expect(sportsPlayerRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sport: 'NBA', name: { in: ['Jalen Brunson'] } } }),
    )
    const p = data.players[0]
    expect(p.headshotUrl).toBe(BRUNSON_PHOTO)
    expect(p.teamLogoUrl).toBe(KNICKS_CREST)
    expect(p.adp).toBe(29.34)
    // Only the headline keys travel.
    expect(p.normalizedStats.cacheStats).toEqual({ points: 1927, total_rebounds: 247, assists: 503, games_played: 74 })
    expect(adaptWaiverWirePlayer(p).seasonStatsSummary).toEqual(['PTS/G 26', 'REB/G 3.3', 'AST/G 6.8'])
  })

  it('NFL: a code-keyed pool row matches its sports_players season and keeps the NFL logo path', async () => {
    leagueFindFirstMock.mockResolvedValue({ id: 'l1', sport: 'NFL', userId: 'u1' })
    getPlayerPoolForLeagueMock.mockResolvedValue([
      {
        player_id: 'a1b2-uuid',
        full_name: 'Tank Bigsby',
        position: 'RB',
        team: 'Jacksonville Jaguars',
        team_abbreviation: 'JAX',
        external_source_id: '9997',
        sleeper_id: '9997',
        image_url: 'https://sleepercdn.com/content/nfl/players/9997.jpg',
        metadata: { source: 'sleeper' },
      },
    ])
    sportsPlayerRecordFindManyMock.mockResolvedValue([
      {
        id: 'NFL:9997', name: 'Tank Bigsby', team: 'JAX', position: 'RB', adp: 120, dataSource: 'rolling_insights', headshotSource: null,
        stats: { rushing_yards: 766, rushing_touchdowns: 7, receiving_yards: 54, receiving_touchdowns: 0, receptions: 7, games_played: 17, snap_count_offense: 300 },
        projections: {},
      },
    ])

    const data = await callRoute()
    const p = data.players[0]
    expect(p.headshotUrl).toBe('https://sleepercdn.com/content/nfl/players/9997.jpg')
    expect(p.teamLogoUrl).toMatch(/^https?:\/\//)
    expect(storedLogoMock).not.toHaveBeenCalled()
    expect(adaptWaiverWirePlayer(p).seasonStatsSummary).toEqual(['RUSH YDS 766', 'REC YDS 54', 'TD 7'])
  })

  it('a database failure on the stats read still returns the pool', async () => {
    leagueFindFirstMock.mockResolvedValue({ id: 'l1', sport: 'NBA', userId: 'u1' })
    getPlayerPoolForLeagueMock.mockResolvedValue([
      { player_id: 'u-1', full_name: 'Someone', position: 'C', team: 'Utah Jazz', team_abbreviation: 'Utah Jazz', external_source_id: null },
    ])
    sportsPlayerRecordFindManyMock.mockRejectedValue(new Error('db down'))
    const data = await callRoute()
    expect(data.players).toHaveLength(1)
    expect(data.players[0].normalizedStats.cacheStats).toBeUndefined()
  })
})

describe('matchPoolRowsToRecords', () => {
  const rec = (over: Record<string, unknown>) => ({ id: 'r', name: 'X', team: '', position: '', stats: { games_played: 1 }, projections: {}, adp: null, dataSource: 'ri', headshotSource: null, ...over }) as any

  it('maps vendor team variants onto one code (NO / New Orleans Pelicans, LA / Los Angeles Kings)', () => {
    const nba = matchPoolRowsToRecords('NBA', [{ player_id: 'p', full_name: 'Zion Williamson', position: 'PF', team: 'New Orleans Pelicans', team_abbreviation: 'New Orleans Pelicans' }], [rec({ id: 'NBA:1', name: 'Zion Williamson', team: 'NO', position: 'F' })])
    expect(nba.get('p')?.id).toBe('NBA:1')
    const nhl = matchPoolRowsToRecords('NHL', [{ player_id: 'k', full_name: 'Adrian Kempe', position: 'RW', team: 'Los Angeles Kings', team_abbreviation: 'Los Angeles Kings' }], [rec({ id: 'NHL:1', name: 'Adrian Kempe', team: 'LA', position: 'RW' })])
    expect(nhl.get('k')?.id).toBe('NHL:1')
  })

  it('never matches a rostered player to a same-named player on another team', () => {
    const out = matchPoolRowsToRecords('NFL', [{ player_id: 'p', full_name: 'Josh Allen', position: 'QB', team: 'BUF', team_abbreviation: 'BUF' }], [rec({ id: 'NFL:2', name: 'Josh Allen', team: 'JAX', position: 'QB' })])
    expect(out.has('p')).toBe(false)
  })

  it('a teamless row matches by name only when the name names one player', () => {
    const pool = [{ player_id: 'fa', full_name: 'Sam Smith', position: 'WR', team: null, team_abbreviation: null }]
    expect(matchPoolRowsToRecords('NFL', pool, [rec({ id: 'NFL:a', name: 'Sam Smith', team: 'DAL', position: 'WR' })]).get('fa')?.id).toBe('NFL:a')
    expect(
      matchPoolRowsToRecords('NFL', pool, [
        rec({ id: 'NFL:a', name: 'Sam Smith', team: 'DAL', position: 'WR' }),
        rec({ id: 'NFL:b', name: 'Sam Smith', team: 'NYG', position: 'WR' }),
      ]).has('fa'),
    ).toBe(false)
  })
})
