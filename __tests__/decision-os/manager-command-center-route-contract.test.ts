import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getDashboardLeagueListForUser: vi.fn(),
  resolveManagerCommandCenterSnapshot: vi.fn(),
  leagueSettingsCount: vi.fn(),
  loadCareerDecisionInput: vi.fn(),
  loadSurvivorDecisionSignals: vi.fn(async () => [] as unknown[]),
  loadSurvivorAttentionSignals: vi.fn(async () => [] as unknown[]),
  loadSurvivorFinaleSignals: vi.fn(async () => [] as unknown[]),
  loadSurvivorChallengeSignals: vi.fn(async () => [] as unknown[]),
  loadSurvivorSideGameSignals: vi.fn(async () => [] as unknown[]),
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
// Live-career plan, phase 4: the route starts the career read beside the snapshot and hands the
// promise over. Mocked so this contract test never reaches the career profile or Prisma.
vi.mock('@/lib/core-app/careerDecisionInput', () => ({
  loadCareerDecisionInput: mocks.loadCareerDecisionInput,
}))
// Survivor format signals: ONE loader (`loadSurvivorFormatSignals`, real here), started beside the
// snapshot and handed over as a single promise like career. Its five SOURCES are mocked, so this
// test proves every source reaches the one argument and none reaches Prisma.
vi.mock('@/lib/survivor/survivorDecisionSignals', () => ({
  loadSurvivorDecisionSignals: mocks.loadSurvivorDecisionSignals,
}))
// Survivor governance signals: the SAME format-signal argument as the reward signals, not a sixth one.
vi.mock('@/lib/survivor/survivorDecisionSignalInput', () => ({
  loadSurvivorAttentionSignals: mocks.loadSurvivorAttentionSignals,
}))
// Finale / Tribal deadlines and open challenges: the same argument.
vi.mock('@/lib/survivor/survivorFinaleSignalsLoader', () => ({
  loadSurvivorFinaleSignals: mocks.loadSurvivorFinaleSignals,
}))
vi.mock('@/lib/survivor/survivorChallengeSignalsLoader', () => ({
  loadSurvivorChallengeSignals: mocks.loadSurvivorChallengeSignals,
}))
// Side-game signals (pool pick due, auction closing, shop open): the same argument again.
vi.mock('@/lib/survivor/survivorSideGameSignalInput', () => ({
  loadSurvivorSideGameSignals: mocks.loadSurvivorSideGameSignals,
}))
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
    mocks.loadCareerDecisionInput.mockResolvedValue(null)
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
      expect.any(Promise),
      // ONE Survivor format-signals promise (rewards + governance + finale/Tribal + challenges + side games), like the career read.
      expect.any(Promise),
    )
    // The career read gets the SAME rows the league ids came from — no second list read.
    expect(mocks.loadCareerDecisionInput).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        leagueRows: expect.arrayContaining([expect.objectContaining({ id: 'league-2' })]),
      }),
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
    expect(mocks.resolveManagerCommandCenterSnapshot).toHaveBeenCalledWith('user-1', [], expect.any(Date), expect.any(Promise), expect.any(Promise))
  })

  it('folds every Survivor signal source into the ONE format-signal argument, and a failing source hides no other', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })
    mocks.getDashboardLeagueListForUser.mockResolvedValueOnce({ leagues: [{ id: 'league-1' }], sleeperUserId: null })
    mocks.resolveManagerCommandCenterSnapshot.mockResolvedValueOnce(emptySnapshot({ totalLeagues: 1 }))
    mocks.leagueSettingsCount.mockResolvedValueOnce(0)
    const reward = { id: 'survivor_reward:league-1:r1', leagueId: 'league-1' }
    const governance = { id: 'survivor_trade_window:league-1:3', leagueId: 'league-1' }
    mocks.loadSurvivorDecisionSignals.mockResolvedValueOnce([reward])
    mocks.loadSurvivorAttentionSignals.mockResolvedValueOnce([governance, reward])
    const sideGame = { id: 'survivor_side_game:league-1:pool_pick:3', leagueId: 'league-1' }
    mocks.loadSurvivorSideGameSignals.mockResolvedValueOnce([sideGame])
    const finale = { id: 'survivor_finale:league-1:jury_vote', leagueId: 'league-1' }
    mocks.loadSurvivorFinaleSignals.mockResolvedValueOnce([finale])
    const challenge = { id: 'survivor_challenge:league-1:c1', leagueId: 'league-1' }
    mocks.loadSurvivorChallengeSignals.mockResolvedValueOnce([challenge, governance])

    const { GET } = await import('@/app/api/decision-os/manager-command-center/route')
    await GET()

    const call = mocks.resolveManagerCommandCenterSnapshot.mock.calls.at(-1)!
    expect(call).toHaveLength(5)
    // All five sources (A rewards, C governance, B finale, D challenges, E side games) reach the one
    // argument, and a duplicate id across sources is admitted once.
    await expect(call[4]).resolves.toEqual([reward, governance, finale, challenge, sideGame])

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })
    mocks.getDashboardLeagueListForUser.mockResolvedValueOnce({ leagues: [{ id: 'league-1' }], sleeperUserId: null })
    mocks.resolveManagerCommandCenterSnapshot.mockResolvedValueOnce(emptySnapshot({ totalLeagues: 1 }))
    mocks.leagueSettingsCount.mockResolvedValueOnce(0)
    mocks.loadSurvivorDecisionSignals.mockRejectedValueOnce(new Error('ledger down'))
    mocks.loadSurvivorAttentionSignals.mockResolvedValueOnce([governance])
    mocks.loadSurvivorSideGameSignals.mockRejectedValueOnce(new Error('side games down'))
    mocks.loadSurvivorFinaleSignals.mockImplementationOnce(() => { throw new Error('finale threw synchronously') })
    mocks.loadSurvivorChallengeSignals.mockResolvedValueOnce([challenge])
    await GET()
    await expect(mocks.resolveManagerCommandCenterSnapshot.mock.calls.at(-1)![4]).resolves.toEqual([governance, challenge])
  })
})
