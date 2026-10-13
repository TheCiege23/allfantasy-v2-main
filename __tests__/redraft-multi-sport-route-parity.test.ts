import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from './helpers/createMockNextRequest'

const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const generateScheduleMock = vi.fn()
const leagueUsesDevyEngineMock = vi.fn()
const calculateOfficialTeamScoreMock = vi.fn()
const leagueUsesC2CEngineMock = vi.fn()
const updateC2CMatchupScoresMock = vi.fn()
const syncWeeklyScoresMock = vi.fn()
const checkAllMatchupsCompleteMock = vi.fn()
const runWeeklyResolutionMock = vi.fn()
const requireAdminOrBearerMock = vi.fn()

const prismaMock = {
  league: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  redraftSeason: {
    findFirst: vi.fn(),
  },
  redraftWaiverClaim: {
    findMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  redraftRoster: {
    findFirst: vi.fn(),
  },
  redraftMatchup: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  c2CMatchupScore: {
    findUnique: vi.fn(),
  },
  zombieLeague: {
    findMany: vi.fn(),
  },
  c2CLeague: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMember: assertLeagueMemberMock,
}))

vi.mock('@/lib/redraft/scheduleEngine', () => ({
  generateSchedule: generateScheduleMock,
}))

vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: leagueUsesDevyEngineMock,
  calculateOfficialTeamScore: calculateOfficialTeamScoreMock,
}))

vi.mock('@/lib/c2c/scoringEngine', () => ({
  leagueUsesC2CEngine: leagueUsesC2CEngineMock,
  updateC2CMatchupScores: updateC2CMatchupScoresMock,
}))

vi.mock('@/lib/survivor/gameStateMachine', () => ({
  syncWeeklyScores: syncWeeklyScoresMock,
}))

vi.mock('@/lib/zombie/matchupCompletion', () => ({
  getZombieWeekReadiness: checkAllMatchupsCompleteMock,
}))

vi.mock('@/lib/zombie/weeklyResolutionEngine', () => ({
  runWeeklyResolution: runWeeklyResolutionMock,
}))

vi.mock('@/lib/adminAuth', () => ({
  requireAdminOrBearer: requireAdminOrBearerMock,
}))

describe('Redraft multi-sport route parity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-1' } })
    assertLeagueMemberMock.mockResolvedValue({ ok: true, status: 200 })
    leagueUsesDevyEngineMock.mockResolvedValue(false)
    leagueUsesC2CEngineMock.mockResolvedValue(false)
    requireAdminOrBearerMock.mockResolvedValue({ ok: true, user: { id: 'admin-1' } })
    calculateOfficialTeamScoreMock.mockResolvedValue({ officialScore: 0 })
    generateScheduleMock.mockReturnValue([{ week: 1, home: 'r-1', away: 'r-2', type: 'regular', sport: 'NFL' }])
  })

  it('creates redraft seasons for all target sports', async () => {
    const sports = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const

    prismaMock.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        league: {
          update: vi.fn().mockResolvedValue({}),
        },
        redraftSeason: {
          create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rs-1', ...data })),
          findFirst: vi.fn().mockResolvedValue({ id: 'rs-1', sport: 'NFL', rosters: [], schedule: [] }),
        },
        redraftRoster: {
          create: vi.fn().mockResolvedValue({ id: 'r-1' }),
        },
        redraftMatchup: {
          create: vi.fn().mockResolvedValue({ id: 'm-1' }),
        },
        guillotineSeason: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        league: {
          update: vi.fn().mockResolvedValue({}),
        },
      }
      return cb(tx)
    })

    const { POST } = await import('../app/api/redraft/season/route')

    for (const sport of sports) {
      prismaMock.league.findFirst.mockResolvedValueOnce({
        id: 'lg-1',
        sport,
        season: 2026,
        medianGame: false,
        userId: 'u-1',
        teams: [
          { claimedByUserId: 'u-1', ownerName: 'A', teamName: 'Team A', avatarUrl: null },
          { claimedByUserId: 'u-2', ownerName: 'B', teamName: 'Team B', avatarUrl: null },
        ],
      })

      const req = createMockNextRequest('http://localhost/api/redraft/season', {
        method: 'POST',
        body: { leagueId: 'lg-1', sport },
      })
      const res = await POST(req as any)
      expect(res.status).toBe(200)

      const args = generateScheduleMock.mock.calls.at(-1)
      const expectedSport = sport === 'NCAAF' ? 'NCAAFB' : sport
      expect(args?.[3]).toBe(expectedSport)
    }
  })

  it('supports waiver and matchup route contracts across sports', async () => {
    const sports = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const
    const waivers = await import('../app/api/redraft/waivers/route')
    const matchup = await import('../app/api/redraft/matchup/route')

    for (const sport of sports) {
      prismaMock.redraftRoster.findFirst.mockResolvedValueOnce({ ownerId: 'u-1', waiverPriority: 1 })
      prismaMock.redraftWaiverClaim.findFirst.mockResolvedValueOnce(null)
      prismaMock.redraftWaiverClaim.create.mockResolvedValueOnce({ id: `wc-${sport}`, addPlayerId: 'p-1' })
      const postReq = createMockNextRequest('http://localhost/api/redraft/waivers', {
        method: 'POST',
        body: {
          rosterId: 'r-1',
          seasonId: `s-${sport}`,
          leagueId: `l-${sport}`,
          addPlayerId: 'p-1',
          addPlayerName: 'Player One',
        },
      })
      const postRes = await waivers.POST(postReq as any)
      expect(postRes.status).toBe(200)

      prismaMock.redraftSeason.findFirst.mockResolvedValueOnce({ id: `s-${sport}`, leagueId: `l-${sport}`, season: 2026 })
      prismaMock.redraftMatchup.findMany.mockResolvedValueOnce([{ id: `m-${sport}`, leagueId: `l-${sport}` }])

      const getReq = createMockNextRequest(
        `http://localhost/api/redraft/matchup?seasonId=${encodeURIComponent(`s-${sport}`)}&week=1`,
      )
      const getRes = await matchup.GET(getReq as any)
      expect(getRes.status).toBe(200)
      const body = await getRes.json()
      expect(Array.isArray(body.matchups)).toBe(true)
    }
  })

  it('runs score-sync contract path', async () => {
    prismaMock.league.findMany.mockResolvedValueOnce([])
    prismaMock.zombieLeague.findMany.mockResolvedValueOnce([])
    prismaMock.c2CLeague.findMany.mockResolvedValueOnce([])

    const { POST } = await import('../app/api/redraft/score-sync/route')
    const req = createMockNextRequest('http://localhost/api/redraft/score-sync', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('message')
    expect(body).toHaveProperty('survivorBridge')
  })
})
