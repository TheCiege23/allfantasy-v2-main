import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Running a league is free (owner's rule for the Oct 15 paywall). Two commissioner
 * settings were locked behind AF Commissioner for no reason the code could name:
 *
 *  - 7- and 9-team playoff brackets. The bracket engine pads ANY field to the next power
 *    of two with first-round byes, so a 7-team bracket is built exactly like the free
 *    6-team one.
 *  - Rookie draft order (dynasty/C2C/devy/keeper). Both modes are a deterministic sort of
 *    last season, yet saving required `commissioner_ai_tools`.
 *
 * Every test here runs as a commissioner with NO plan, through the real handler.
 */

const {
  prismaMock,
  requireCommissionerRoleMock,
  resolveForUserMock,
  saveRookieConfigMock,
  getServerSessionMock,
} = vi.hoisted(() => ({
  prismaMock: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    userProfile: { findFirst: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
  },
  requireCommissionerRoleMock: vi.fn(),
  resolveForUserMock: vi.fn(),
  saveRookieConfigMock: vi.fn(),
  getServerSessionMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: requireCommissionerRoleMock }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = resolveForUserMock
  }),
}))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn() }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({
  syncCommissionerDerivedLeagueState: vi.fn(),
}))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/rookieDraftOrder', () => ({
  computeRookieDraftOrder: vi.fn().mockResolvedValue({ slots: [], season: 2027 }),
  saveRookieDraftOrderConfig: saveRookieConfigMock,
  getRookieDraftOrderConfig: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/commissioner/CommissionerChangeNotifier', () => ({
  notifyCommissionerChange: vi.fn().mockResolvedValue(undefined),
}))

const FREE_COMMISSIONER = 'user-free'

beforeEach(() => {
  vi.clearAllMocks()
  requireCommissionerRoleMock.mockResolvedValue(undefined)
  // No plan anywhere: neither the legacy profile flag nor the entitlement resolver.
  resolveForUserMock.mockResolvedValue({ hasAccess: false })
  prismaMock.userProfile.findFirst.mockResolvedValue({ afCommissionerSub: false })
  prismaMock.league.findFirst.mockResolvedValue({
    id: 'league-1',
    platform: 'native',
    leagueSize: 12,
    settings: {},
    teams: [],
    leagueSettings: null,
  })
  prismaMock.league.update.mockResolvedValue({})
  getServerSessionMock.mockResolvedValue({ user: { id: FREE_COMMISSIONER } })
})

describe('playoff bracket size is free', () => {
  it.each([7, 9])('a commissioner with no plan can save a %i-team playoff bracket', async (playoffTeams) => {
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    const res = await executeLeagueSettingsPatch(FREE_COMMISSIONER, { leagueId: 'league-1', playoffTeams })

    expect(res.status).toBe(200)
    const writes = prismaMock.league.update.mock.calls.map(([arg]) => arg.data)
    expect(writes.some((data) => data.playoffTeams === playoffTeams)).toBe(true)
  })

  it('still refuses a bracket larger than the league', async () => {
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    const res = await executeLeagueSettingsPatch(FREE_COMMISSIONER, { leagueId: 'league-1', playoffTeams: 13 })
    expect(res.status).toBe(400)
    expect(prismaMock.league.update).not.toHaveBeenCalled()
  })

  it('still gates the AI commissioner settings on AF Commissioner', async () => {
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    const res = await executeLeagueSettingsPatch(FREE_COMMISSIONER, {
      leagueId: 'league-1',
      aiQueueSuggestions: true,
    })
    expect(res.status).toBe(403)
  })
})

describe('rookie draft order is free', () => {
  function putRequest(body: unknown) {
    return new Request('http://localhost/api/commissioner/leagues/league-1/rookie-draft-order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  beforeEach(() => {
    prismaMock.league.findUnique.mockResolvedValue({
      userId: FREE_COMMISSIONER,
      isDynasty: true,
      leagueVariant: 'dynasty',
      settings: {},
      season: 2026,
    })
  })

  it('a dynasty commissioner with no plan can turn on auto-ordering', async () => {
    const { PUT } = await import('@/app/api/commissioner/leagues/[leagueId]/rookie-draft-order/route')
    const res = await PUT(putRequest({ mode: 'reverse_max_pf', enabled: true }) as never, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })

    expect(res.status).toBe(200)
    expect(saveRookieConfigMock).toHaveBeenCalledWith('league-1', {
      mode: 'reverse_max_pf',
      enabled: true,
      userId: FREE_COMMISSIONER,
    })
  })

  it('still refuses anyone but the commissioner', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'someone-else' } })
    const { PUT } = await import('@/app/api/commissioner/leagues/[leagueId]/rookie-draft-order/route')
    const res = await PUT(putRequest({ mode: 'worst_to_first' }) as never, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })
    expect(res.status).toBe(403)
    expect(saveRookieConfigMock).not.toHaveBeenCalled()
  })
})
