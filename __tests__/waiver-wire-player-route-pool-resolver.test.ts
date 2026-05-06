import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()
const leagueFindFirstMock = vi.fn()
const rosterFindFirstMock = vi.fn()
const rosterFindManyMock = vi.fn()
const getRosterPlayerIdsMock = vi.fn()
const getPlayerPoolForLeagueMock = vi.fn()
const getPlayerPoolForSportMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

const sportsPlayerRecordFindManyMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: leagueFindFirstMock,
      findUnique: leagueFindFirstMock,
    },
    roster: {
      findFirst: rosterFindFirstMock,
      findMany: rosterFindManyMock,
    },
    sportsPlayerRecord: {
      findMany: sportsPlayerRecordFindManyMock,
    },
  },
}))

vi.mock('@/lib/waiver-wire/roster-utils', () => ({
  getRosterPlayerIds: getRosterPlayerIdsMock,
}))

vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForLeague: getPlayerPoolForLeagueMock,
  getPlayerPoolForSport: getPlayerPoolForSportMock,
}))

describe('GET /api/waiver-wire/leagues/[leagueId]/players', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    leagueFindFirstMock.mockResolvedValue({ id: 'l1', sport: 'NFL', userId: 'u1', settings: {} })
    rosterFindFirstMock.mockResolvedValue(null)
    rosterFindManyMock.mockResolvedValue([{ playerData: { starters: [] } }])
    sportsPlayerRecordFindManyMock.mockResolvedValue([])
    getRosterPlayerIdsMock.mockReturnValue([])
    getPlayerPoolForLeagueMock.mockResolvedValue([])
    getPlayerPoolForSportMock.mockResolvedValue([])
  })

  it('uses shared league pool resolver and filters by rostered internal/external ids', async () => {
    getRosterPlayerIdsMock.mockReturnValue(['slp-rostered-1'])
    getPlayerPoolForLeagueMock.mockResolvedValue([
      {
        player_id: 'player-1',
        full_name: 'Rostered Defender',
        position: 'LB',
        team_abbreviation: 'DAL',
        external_source_id: 'slp-rostered-1',
      },
      {
        player_id: 'player-2',
        full_name: 'Available Defender',
        position: 'DE',
        team_abbreviation: 'KC',
        external_source_id: 'slp-available-2',
      },
    ])

    const { GET } = await import('@/app/api/waiver-wire/leagues/[leagueId]/players/route')
    const req = {
      nextUrl: new URL('http://localhost/api/waiver-wire/leagues/l1/players?limit=20'),
    } as any

    const res = await GET(req, { params: { leagueId: 'l1' } })
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(getPlayerPoolForLeagueMock).toHaveBeenCalledWith('l1', 'NFL', {
      limit: 800,
      position: undefined,
      teamId: undefined,
    })
    expect(getPlayerPoolForSportMock).not.toHaveBeenCalled()

    expect(data.players).toHaveLength(1)
    expect(data.players[0]).toMatchObject({
      id: 'player-2',
      name: 'Available Defender',
      position: 'DE',
      team: 'KC',
    })
    expect(data.rosteredCount).toBe(1)
  })

  it('rejects cross-sport query overrides to prevent player pool leakage', async () => {

    const { GET } = await import('@/app/api/waiver-wire/leagues/[leagueId]/players/route')
    const req = {
      nextUrl: new URL('http://localhost/api/waiver-wire/leagues/l1/players?sport=SOCCER&position=MID'),
    } as any

    const res = await GET(req, { params: { leagueId: 'l1' } })
    expect(res.status).toBe(400)
    const data = await res.json()

    expect(data.error).toContain('Sport mismatch')
    expect(getPlayerPoolForSportMock).not.toHaveBeenCalled()
    expect(getPlayerPoolForLeagueMock).not.toHaveBeenCalled()
  })
})
