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
 * ⚠ THE ROOKIE ORDER WAS REVISITED 2026-10-27, AT THE OWNER'S CALL. Previewing and saving a mode
 * stay free, but switching AUTOMATIC ordering on is now AF Commissioner, the same rule as the
 * live rookie order (`rookie-draft-order/live`), which sells that automation. The wrong gate
 * (`commissioner_ai_tools`) is still gone; the right one is the owner's plan.
 *
 * Every test here runs as a commissioner with NO plan, through the real handler, unless it says otherwise.
 */

const {
  prismaMock,
  requireCommissionerRoleMock,
  resolveForUserMock,
  saveRookieConfigMock,
  getServerSessionMock,
  ownerEntitledMock,
} = vi.hoisted(() => ({
  prismaMock: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    userProfile: { findFirst: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    redraftPlayoffRound: { findFirst: vi.fn() },
  },
  requireCommissionerRoleMock: vi.fn(),
  resolveForUserMock: vi.fn(),
  saveRookieConfigMock: vi.fn(),
  getServerSessionMock: vi.fn(),
  ownerEntitledMock: vi.fn(),
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
vi.mock('@/lib/rookie-order/liveRookieOrderService', () => ({ isLeagueEntitledToLiveRookieOrder: ownerEntitledMock }))
vi.mock('@/lib/commissioner/CommissionerChangeNotifier', () => ({
  notifyCommissionerChange: vi.fn().mockResolvedValue(undefined),
}))

const FREE_COMMISSIONER = 'user-free'

beforeEach(() => {
  vi.clearAllMocks()
  requireCommissionerRoleMock.mockResolvedValue(undefined)
  // No plan: the entitlement resolver says no. (The profile flag is no longer read; the mock stays so a
  // regression that reads it again sees `false`, not a missing delegate.)
  resolveForUserMock.mockResolvedValue({ hasAccess: false })
  prismaMock.userProfile.findFirst.mockResolvedValue({ afCommissionerSub: false })
  prismaMock.league.findFirst.mockResolvedValue({
    id: 'league-1',
    platform: 'native',
    leagueSize: 12,
    // A 9-team bracket is four rounds: from week 14 its final is week 17, the NFL season's last. From
    // the default week 15 it would be week 18, which the bracket-fit check refuses (championshipLengthFit).
    playoffStartWeek: 14,
    settings: {},
    teams: [],
    leagueSettings: null,
  })
  prismaMock.league.findUnique.mockResolvedValue({ dynastyConfig: null, settings: {} })
  prismaMock.redraftSeason.findFirst.mockResolvedValue(null)
  prismaMock.redraftPlayoffRound.findFirst.mockResolvedValue(null)
  prismaMock.league.update.mockResolvedValue({})
  getServerSessionMock.mockResolvedValue({ user: { id: FREE_COMMISSIONER } })
  ownerEntitledMock.mockResolvedValue(false)
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

describe('rookie draft order: the preview and the mode are free, automatic ordering is AF Commissioner', () => {
  function putRequest(body: unknown) {
    return new Request('http://localhost/api/commissioner/leagues/league-1/rookie-draft-order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
  const params = { params: Promise.resolve({ leagueId: 'league-1' }) }

  beforeEach(() => {
    prismaMock.league.findUnique.mockResolvedValue({
      userId: FREE_COMMISSIONER,
      isDynasty: true,
      leagueVariant: 'dynasty',
      settings: {},
      season: 2026,
    })
  })

  it('🛑 with no plan, turning auto-ordering on is refused and nothing is saved', async () => {
    const { PUT } = await import('@/app/api/commissioner/leagues/[leagueId]/rookie-draft-order/route')
    const res = await PUT(putRequest({ mode: 'reverse_max_pf', enabled: true }) as never, params)
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ errorCode: 'AF_COMMISSIONER_REQUIRED', upgradePath: '/upgrade?plan=commissioner' })
    expect(ownerEntitledMock).toHaveBeenCalledWith(FREE_COMMISSIONER)
    expect(saveRookieConfigMock).not.toHaveBeenCalled()
    // `enabled` defaults to on, so a body without it is a switch-on too.
    expect((await PUT(putRequest({ mode: 'worst_to_first' }) as never, params)).status).toBe(402)
  })

  it('with no plan, switching it off or saving a mode with it off is free', async () => {
    const { PUT } = await import('@/app/api/commissioner/leagues/[leagueId]/rookie-draft-order/route')
    const res = await PUT(putRequest({ mode: 'reverse_max_pf', enabled: false }) as never, params)
    expect(res.status).toBe(200)
    expect(saveRookieConfigMock).toHaveBeenCalledWith('league-1', { mode: 'reverse_max_pf', enabled: false, userId: FREE_COMMISSIONER })
  })

  it('on the owner’s plan, auto-ordering is switched on', async () => {
    ownerEntitledMock.mockResolvedValue(true)
    const { PUT } = await import('@/app/api/commissioner/leagues/[leagueId]/rookie-draft-order/route')
    const res = await PUT(putRequest({ mode: 'reverse_max_pf', enabled: true }) as never, params)
    expect(res.status).toBe(200)
    expect(saveRookieConfigMock).toHaveBeenCalledWith('league-1', { mode: 'reverse_max_pf', enabled: true, userId: FREE_COMMISSIONER })
  })

  it('the preview stays free, and tells the commissioner whether auto-ordering can be switched on', async () => {
    const { GET } = await import('@/app/api/commissioner/leagues/[leagueId]/rookie-draft-order/route')
    const get = () => GET(new Request('http://localhost/api/commissioner/leagues/league-1/rookie-draft-order') as never, { params: Promise.resolve({ leagueId: 'league-1' }) })
    let res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ isCommissioner: true, canAutomate: false })
    ownerEntitledMock.mockResolvedValue(true)
    res = await get()
    expect(await res.json()).toMatchObject({ canAutomate: true })
  })

  it('still refuses anyone but the commissioner', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'someone-else' } })
    const { PUT } = await import('@/app/api/commissioner/leagues/[leagueId]/rookie-draft-order/route')
    const res = await PUT(putRequest({ mode: 'worst_to_first' }) as never, params)
    expect(res.status).toBe(403)
    expect(saveRookieConfigMock).not.toHaveBeenCalled()
  })
})
