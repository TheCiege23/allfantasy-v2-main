import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getDashboardLeagueListForUser: vi.fn(),
  resolveCommissionerCommandCenterSnapshot: vi.fn(),
  leagueSettingsCount: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/dashboard/get-dashboard-league-list', () => ({
  getDashboardLeagueListForUser: mocks.getDashboardLeagueListForUser,
}))
vi.mock('@/lib/decision-os/commissionerCommandCenter', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/commissionerCommandCenter')>(
    '@/lib/decision-os/commissionerCommandCenter',
  )
  return { ...actual, resolveCommissionerCommandCenterSnapshot: mocks.resolveCommissionerCommandCenterSnapshot }
})
vi.mock('@/lib/prisma', () => ({
  prisma: { leagueSettings: { count: mocks.leagueSettingsCount } },
}))

function getReq() {
  return new Request('http://localhost/api/decision-os/commissioner-command-center')
}

describe('GET /api/decision-os/commissioner-command-center', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.leagueSettingsCount.mockResolvedValue(0)
  })

  it('denies an unauthenticated caller with 401, never resolving any league data', async () => {
    mocks.getServerSession.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/decision-os/commissioner-command-center/route')
    const res = await GET(getReq())
    expect(res.status).toBe(401)
    expect(mocks.getDashboardLeagueListForUser).not.toHaveBeenCalled()
    expect(mocks.resolveCommissionerCommandCenterSnapshot).not.toHaveBeenCalled()
  })

  it('resolves only the caller\'s OWN commissioner leagues — never a client-supplied list (there is none to supply)', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })
    mocks.getDashboardLeagueListForUser.mockResolvedValueOnce({
      leagues: [
        { id: 'league-1', isCommissioner: true },
        { id: 'league-2', isCommissioner: false }, // member-only league — must be excluded
        { id: 'league-3', isCommissioner: true },
      ],
      sleeperUserId: null,
    })
    mocks.resolveCommissionerCommandCenterSnapshot.mockResolvedValueOnce({
      generatedAt: '2026-07-09T00:00:00.000Z',
      totalLeagues: 2,
      healthyLeagueCount: 2,
      atRiskLeagueCount: 0,
      unavailableLeagueCount: 0,
      totalActiveManagers: 0,
      totalInactiveManagers: 0,
      totalRetentionRiskManagers: 0,
      leagueSummaries: [],
      attentionQueue: [],
      recentChanges: [],
      warnings: [],
    })

    const { GET } = await import('@/app/api/decision-os/commissioner-command-center/route')
    const res = await GET(getReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.getDashboardLeagueListForUser).toHaveBeenCalledWith('user-1')
    expect(mocks.resolveCommissionerCommandCenterSnapshot).toHaveBeenCalledWith(
      ['league-1', 'league-3'],
      expect.any(Date),
    )
    expect(body.totalLeagues).toBe(2)
  })

  it('includes a real draftsApproachingCount from LeagueSettings.draftDateUtc, scoped to the resolved league ids', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })
    mocks.getDashboardLeagueListForUser.mockResolvedValueOnce({
      leagues: [{ id: 'league-1', isCommissioner: true }],
      sleeperUserId: null,
    })
    mocks.resolveCommissionerCommandCenterSnapshot.mockResolvedValueOnce({
      generatedAt: '2026-07-09T00:00:00.000Z',
      totalLeagues: 1,
      healthyLeagueCount: 1,
      atRiskLeagueCount: 0,
      unavailableLeagueCount: 0,
      totalActiveManagers: 0,
      totalInactiveManagers: 0,
      totalRetentionRiskManagers: 0,
      leagueSummaries: [],
      attentionQueue: [],
      recentChanges: [],
      warnings: [],
    })
    mocks.leagueSettingsCount.mockResolvedValueOnce(1)

    const { GET } = await import('@/app/api/decision-os/commissioner-command-center/route')
    const res = await GET(getReq())
    const body = await res.json()

    expect(body.draftsApproachingCount).toBe(1)
    expect(mocks.leagueSettingsCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ leagueId: { in: ['league-1'] } }) }),
    )
  })

  it('degrades draftsApproachingCount to 0 (never a 500) when the LeagueSettings query fails', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })
    mocks.getDashboardLeagueListForUser.mockResolvedValueOnce({
      leagues: [{ id: 'league-1', isCommissioner: true }],
      sleeperUserId: null,
    })
    mocks.resolveCommissionerCommandCenterSnapshot.mockResolvedValueOnce({
      generatedAt: '2026-07-09T00:00:00.000Z',
      totalLeagues: 1,
      healthyLeagueCount: 1,
      atRiskLeagueCount: 0,
      unavailableLeagueCount: 0,
      totalActiveManagers: 0,
      totalInactiveManagers: 0,
      totalRetentionRiskManagers: 0,
      leagueSummaries: [],
      attentionQueue: [],
      recentChanges: [],
      warnings: [],
    })
    mocks.leagueSettingsCount.mockRejectedValueOnce(new Error('boom'))

    const { GET } = await import('@/app/api/decision-os/commissioner-command-center/route')
    const res = await GET(getReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.draftsApproachingCount).toBe(0)
  })

  it('returns an honest empty snapshot when the caller commissions no leagues', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })
    mocks.getDashboardLeagueListForUser.mockResolvedValueOnce({ leagues: [], sleeperUserId: null })
    mocks.resolveCommissionerCommandCenterSnapshot.mockResolvedValueOnce({
      generatedAt: '2026-07-09T00:00:00.000Z',
      totalLeagues: 0,
      healthyLeagueCount: 0,
      atRiskLeagueCount: 0,
      unavailableLeagueCount: 0,
      totalActiveManagers: 0,
      totalInactiveManagers: 0,
      totalRetentionRiskManagers: 0,
      leagueSummaries: [],
      attentionQueue: [],
      recentChanges: [],
      warnings: ['no_leagues_specified'],
    })

    const { GET } = await import('@/app/api/decision-os/commissioner-command-center/route')
    const res = await GET(getReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalLeagues).toBe(0)
    expect(body.draftsApproachingCount).toBe(0)
    expect(mocks.resolveCommissionerCommandCenterSnapshot).toHaveBeenCalledWith([], expect.any(Date))
  })
})
