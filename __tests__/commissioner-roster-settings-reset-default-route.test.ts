import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()
const checkCommissionerPermissionMock = vi.fn()
const resetLeagueRosterToDefaultMock = vi.fn()
const getLeagueRosterConfigMock = vi.fn()
const getServiceMock = vi.fn()
const isSupportedMock = vi.fn()
const leagueFindUniqueMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

// The lifecycle gate (lib/league/settingsLifecycleGate.ts) is covered by
// __tests__/settings-editors-lifecycle-gate.test.ts; here it always allows.
vi.mock('@/lib/league/settingsLifecycleGate', () => ({
  settingsLifecycleRefusal: vi.fn(async () => null),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
    },
  },
}))

vi.mock('@/lib/roster-engine', () => ({
  checkCommissionerPermission: checkCommissionerPermissionMock,
  resetLeagueRosterToDefault: resetLeagueRosterToDefaultMock,
  getLeagueRosterConfig: getLeagueRosterConfigMock,
  getRosterEngineRegistry: () => ({
    isSupported: isSupportedMock,
    getService: getServiceMock,
  }),
}))

describe('/api/commissioner/leagues/[leagueId]/roster-settings/reset-default route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-commissioner' } })
    checkCommissionerPermissionMock.mockResolvedValue({ isCommissioner: true, readOnly: false })
    leagueFindUniqueMock.mockResolvedValue({ sport: 'NFL' })
    isSupportedMock.mockReturnValue(true)
    getServiceMock.mockReturnValue({
      getConfig: vi.fn().mockResolvedValue({ templateKey: 'redraft', slots: { QB: 1 }, isCustom: false }),
    })
    getLeagueRosterConfigMock.mockResolvedValue({ rosterMatchesTemplate: true, rosterWarnings: [] })
    resetLeagueRosterToDefaultMock.mockResolvedValue({})
  })

  it('returns 401 when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValueOnce(null)
    const { POST } = await import('../app/api/commissioner/leagues/[leagueId]/roster-settings/reset-default/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, {
      params: Promise.resolve({ leagueId: 'l1' }),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 for non-commissioners', async () => {
    checkCommissionerPermissionMock.mockResolvedValueOnce({ isCommissioner: false, readOnly: true })
    const { POST } = await import('../app/api/commissioner/leagues/[leagueId]/roster-settings/reset-default/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, {
      params: Promise.resolve({ leagueId: 'l1' }),
    })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Commissioner only' })
  })

  it('resets roster and returns updated config payload', async () => {
    const { POST } = await import('../app/api/commissioner/leagues/[leagueId]/roster-settings/reset-default/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, {
      params: Promise.resolve({ leagueId: 'l1' }),
    })

    expect(resetLeagueRosterToDefaultMock).toHaveBeenCalledWith('l1', 'u-commissioner')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.config).toBeTruthy()
    expect(body.unifiedConfig).toBeTruthy()
  })
})
