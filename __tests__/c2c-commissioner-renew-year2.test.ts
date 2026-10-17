import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getServerSessionMock,
  notifyCommissionerChangeMock,
  checkAndTriggerRatingIfOffseasonMock,
  leagueFindUniqueMock,
  leagueUpdateMock,
  leagueSeasonUpsertMock,
  leagueTeamUpdateManyMock,
  leagueTeamCountMock,
  findLeagueListingUpsertMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  notifyCommissionerChangeMock: vi.fn(),
  checkAndTriggerRatingIfOffseasonMock: vi.fn(),
  leagueFindUniqueMock: vi.fn(),
  leagueUpdateMock: vi.fn(),
  leagueSeasonUpsertMock: vi.fn(),
  leagueTeamUpdateManyMock: vi.fn(),
  leagueTeamCountMock: vi.fn(),
  findLeagueListingUpsertMock: vi.fn(),
}))

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/commissioner/CommissionerChangeNotifier', () => ({
  notifyCommissionerChange: notifyCommissionerChangeMock,
}))

vi.mock('@/lib/commissioner/CommissionerRatingTrigger', () => ({
  checkAndTriggerRatingIfOffseason: checkAndTriggerRatingIfOffseasonMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
      update: leagueUpdateMock,
    },
    leagueSeason: {
      upsert: leagueSeasonUpsertMock,
    },
    leagueTeam: {
      updateMany: leagueTeamUpdateManyMock,
      count: leagueTeamCountMock,
    },
    findLeagueListing: {
      upsert: findLeagueListingUpsertMock,
    },
  },
}))

describe('C2C commissioner renew / continue-to-next-year', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    getServerSessionMock.mockResolvedValue({ user: { id: 'commissioner-1' } })
    notifyCommissionerChangeMock.mockResolvedValue(undefined)
    checkAndTriggerRatingIfOffseasonMock.mockResolvedValue(undefined)
    leagueSeasonUpsertMock.mockResolvedValue({ id: 'ls-1' })
    leagueTeamUpdateManyMock.mockResolvedValue({ count: 0 })
    leagueTeamCountMock.mockResolvedValue(1)
    findLeagueListingUpsertMock.mockResolvedValue({ id: 'listing-1' })
    leagueUpdateMock.mockResolvedValue({ id: 'league-1' })

    leagueFindUniqueMock.mockResolvedValue({
      userId: 'commissioner-1',
      season: 2026,
      settings: {
        league_type: 'c2c',
        c2cTaxiLockMode: 'season_start',
        c2cCustomSetting: 'keep-me',
      },
      leagueVariant: 'merged_devy_c2c',
      isDynasty: true,
      sport: 'NFL',
      name: 'C2C Test League',
      scoring: 'ppr',
      teams: [
        {
          id: 't1',
          teamName: 'Team One',
          ownerName: 'Owner One',
          isOrphan: false,
          isCommissioner: true,
          wins: 10,
          losses: 4,
          pointsFor: 1510,
          platformUserId: 'u1',
          currentRank: 1,
        },
      ],
    })
  })

  it('🛑 refuses an IMPORTED league: it is renewed on its platform, never by moving this row a season', async () => {
    // Renewing an imported Sleeper row left it pointing at last season's Sleeper league with season + 1,
    // and every sync then refused it for a season mismatch.
    leagueFindUniqueMock.mockResolvedValue({ ...(await leagueFindUniqueMock()), platform: 'sleeper' })
    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/renew/route')
    const req = new Request('http://localhost/api/commissioner/leagues/league-1/renew', { method: 'POST', body: '{}' })
    const res = await POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('imported_league')
    expect(json.message).toMatch(/Renew it there — AllFantasy picks up the new season on its own/)
    expect(leagueUpdateMock).not.toHaveBeenCalled()
  })

  it('advances season and preserves C2C settings when commissioner continues to next year', async () => {
    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/renew/route')

    const req = new Request('http://localhost/api/commissioner/leagues/league-1/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duesEnabled: true, duesAmount: 25, listInFinder: false }),
    })

    const res = await POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.nextSeason).toBe(2027)

    const lastUpdateCall = leagueUpdateMock.mock.calls[leagueUpdateMock.mock.calls.length - 1]?.[0]
    expect(lastUpdateCall.data.season).toBe(2027)
    expect(lastUpdateCall.data.status).toBe('pre_draft')
    expect(lastUpdateCall.data.settings.c2cTaxiLockMode).toBe('season_start')
    expect(lastUpdateCall.data.settings.c2cCustomSetting).toBe('keep-me')
    expect(lastUpdateCall.data.settings.renewal_completed_for_season).toBe(2027)
  })

  it('allows commissioner league-type update to c2c and forces dynasty=true', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      userId: 'commissioner-1',
      season: 2026,
      settings: {},
      leagueVariant: 'redraft',
      isDynasty: false,
      sport: 'NFL',
      name: 'Redraft League',
      scoring: 'standard',
      teams: [
        {
          id: 't1',
          teamName: 'Team One',
          ownerName: 'Owner One',
          isOrphan: false,
          isCommissioner: true,
          wins: 8,
          losses: 6,
          pointsFor: 1300,
          platformUserId: 'u1',
          currentRank: 2,
        },
      ],
    })

    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/renew/route')

    const req = new Request('http://localhost/api/commissioner/leagues/league-1/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueType: 'c2c' }),
    })

    const res = await POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })
    expect(res.status).toBe(200)

    const typeChangeCall = leagueUpdateMock.mock.calls.find(
      (c) => c?.[0]?.data?.leagueVariant === 'c2c',
    )?.[0]

    expect(typeChangeCall).toBeTruthy()
    expect(typeChangeCall.data.isDynasty).toBe(true)
  })
})
