import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getDashboardLeagueListForUser: vi.fn(),
  resolveManagerCommandCenterSnapshot: vi.fn(),
  leagueSettingsCount: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/dashboard/get-dashboard-league-list', () => ({
  getDashboardLeagueListForUser: mocks.getDashboardLeagueListForUser,
}))
vi.mock('@/lib/decision-os/managerCommandCenter', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/managerCommandCenter')>(
    '@/lib/decision-os/managerCommandCenter',
  )
  return { ...actual, resolveManagerCommandCenterSnapshot: mocks.resolveManagerCommandCenterSnapshot }
})
vi.mock('@/lib/prisma', () => ({
  prisma: { leagueSettings: { count: mocks.leagueSettingsCount } },
}))

function emptySnapshot(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-07-09T00:00:00.000Z',
    totalLeagues: 0,
    healthyLeagueCount: 0,
    atRiskLeagueCount: 0,
    unavailableLeagueCount: 0,
    leagueSummaries: [],
    attentionQueue: [],
    leagueTrends: [],
    warnings: [],
    ...overrides,
  }
}

describe('GET /api/decision-os/manager-command-center', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.leagueSettingsCount.mockResolvedValue(0)
  })

  it('denies an unauthenticated caller with 401, never resolving any league data', async () => {
    mocks.getServerSession.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/decision-os/manager-command-center/route')
    const res = await GET()
    expect(res.status).toBe(401)
    expect(mocks.getDashboardLeagueListForUser).not.toHaveBeenCalled()
    expect(mocks.resolveManagerCommandCenterSnapshot).not.toHaveBeenCalled()
  })

  it('resolves EVERY league the caller belongs to — commissioner, member, and imported alike (no isCommissioner filter)', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })
    mocks.getDashboardLeagueListForUser.mockResolvedValueOnce({
      leagues: [
        { id: 'league-1', isCommissioner: true },
        { id: 'league-2', isCommissioner: false, userRole: 'member' },
        { id: 'league-3', isCommissioner: false, userRole: 'imported' },
      ],
      sleeperUserId: null,
    })
    mocks.resolveManagerCommandCenterSnapshot.mockResolvedValueOnce(emptySnapshot({ totalLeagues: 3 }))

    const { GET } = await import('@/app/api/decision-os/manager-command-center/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.getDashboardLeagueListForUser).toHaveBeenCalledWith('user-1')
    expect(mocks.resolveManagerCommandCenterSnapshot).toHaveBeenCalledWith(
      'user-1',
      ['league-1', 'league-2', 'league-3'],
      expect.any(Date),
    )
    expect(body.totalLeagues).toBe(3)
  })

  it('includes a real draftsApproachingCount from LeagueSettings.draftDateUtc, scoped to every resolved league id', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })
    mocks.getDashboardLeagueListForUser.mockResolvedValueOnce({
      leagues: [{ id: 'league-1' }],
      sleeperUserId: null,
    })
    mocks.resolveManagerCommandCenterSnapshot.mockResolvedValueOnce(emptySnapshot({ totalLeagues: 1 }))
    mocks.leagueSettingsCount.mockResolvedValueOnce(1)

    const { GET } = await import('@/app/api/decision-os/manager-command-center/route')
    const res = await GET()
    const body = await res.json()

    expect(body.draftsApproachingCount).toBe(1)
    expect(mocks.leagueSettingsCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ leagueId: { in: ['league-1'] } }) }),
    )
  })

  it('degrades draftsApproachingCount to 0 (never a 500) when the LeagueSettings query fails', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })
    mocks.getDashboardLeagueListForUser.mockResolvedValueOnce({
      leagues: [{ id: 'league-1' }],
      sleeperUserId: null,
    })
    mocks.resolveManagerCommandCenterSnapshot.mockResolvedValueOnce(emptySnapshot({ totalLeagues: 1 }))
    mocks.leagueSettingsCount.mockRejectedValueOnce(new Error('boom'))

    const { GET } = await import('@/app/api/decision-os/manager-command-center/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.draftsApproachingCount).toBe(0)
  })

  it('returns an honest empty snapshot when the caller belongs to no leagues', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })
    mocks.getDashboardLeagueListForUser.mockResolvedValueOnce({ leagues: [], sleeperUserId: null })
    mocks.resolveManagerCommandCenterSnapshot.mockResolvedValueOnce(emptySnapshot({ warnings: ['no_leagues_specified'] }))

    const { GET } = await import('@/app/api/decision-os/manager-command-center/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalLeagues).toBe(0)
    expect(body.draftsApproachingCount).toBe(0)
    expect(mocks.resolveManagerCommandCenterSnapshot).toHaveBeenCalledWith('user-1', [], expect.any(Date))
  })
})
