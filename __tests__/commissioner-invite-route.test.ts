import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()
const assertCommissionerMock = vi.fn()
const isAdminRoleMock = vi.fn()
const isAdminEmailAllowedMock = vi.fn()
const getLeagueRoleMock = vi.fn()

const leagueFindUniqueMock = vi.fn()
const leagueUpdateMock = vi.fn()
const leagueInviteUpsertMock = vi.fn()
const redraftLeagueExtendedSettingsFindUniqueMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/commissioner/permissions', () => ({
  assertCommissioner: assertCommissionerMock,
}))

vi.mock('@/lib/adminAuth', () => ({
  isAdminRole: isAdminRoleMock,
  isAdminEmailAllowed: isAdminEmailAllowedMock,
}))

vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: getLeagueRoleMock,
}))

const canManageClassExceptionsMock = vi.fn()
const decideClassExceptionMock = vi.fn()
const getClassGateSummaryMock = vi.fn()

vi.mock('@/lib/league-join/classExceptions', () => ({
  canManageClassExceptions: canManageClassExceptionsMock,
  decideClassException: decideClassExceptionMock,
  getClassGateSummary: getClassGateSummaryMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
      update: leagueUpdateMock,
    },
    leagueInvite: {
      upsert: leagueInviteUpsertMock,
    },
    redraftLeagueExtendedSettings: {
      findUnique: redraftLeagueExtendedSettingsFindUniqueMock,
    },
  },
}))

describe('/api/commissioner/leagues/[leagueId]/invite route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-commissioner', role: 'commissioner', email: 'comm@test.dev' } })
    assertCommissionerMock.mockResolvedValue(undefined)
    isAdminRoleMock.mockReturnValue(false)
    isAdminEmailAllowedMock.mockReturnValue(false)
    getLeagueRoleMock.mockResolvedValue('commissioner')
    redraftLeagueExtendedSettingsFindUniqueMock.mockResolvedValue({ allowMemberInviteRankBypass: false })
  })

  it('refuses the retired shared-code bypass, even for the commissioner', async () => {
    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/invite/route')
    const res = await POST(
      new Request('http://localhost/api/commissioner/leagues/league-1/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bypassRankGate: true, regenerate: false }),
      }) as any,
      { params: Promise.resolve({ leagueId: 'league-1' }) }
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('SHARED_BYPASS_RETIRED')
    expect(leagueInviteUpsertMock).not.toHaveBeenCalled()
    expect(leagueUpdateMock).not.toHaveBeenCalled()
  })

  it('PATCH lets a commissioner approve one named manager', async () => {
    canManageClassExceptionsMock.mockResolvedValueOnce(true)
    decideClassExceptionMock.mockResolvedValueOnce({ ok: true, summary: { range: null, exceptions: [], requests: [] } })

    const { PATCH } = await import('@/app/api/commissioner/leagues/[leagueId]/invite/route')
    const res = await PATCH(
      new Request('http://localhost/api/commissioner/leagues/league-1/invite', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', userId: 'u-outside' }),
      }) as any,
      { params: Promise.resolve({ leagueId: 'league-1' }) }
    )

    expect(res.status).toBe(200)
    expect(decideClassExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'league-1', decidedBy: 'u-commissioner', action: 'approve', userId: 'u-outside' }),
    )
  })

  it('PATCH refuses a member', async () => {
    canManageClassExceptionsMock.mockResolvedValueOnce(false)

    const { PATCH } = await import('@/app/api/commissioner/leagues/[leagueId]/invite/route')
    const res = await PATCH(
      new Request('http://localhost/api/commissioner/leagues/league-1/invite', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'grant', username: 'someone' }),
      }) as any,
      { params: Promise.resolve({ leagueId: 'league-1' }) }
    )

    expect(res.status).toBe(403)
    expect(decideClassExceptionMock).not.toHaveBeenCalled()
  })

  it('PATCH rejects an unknown action', async () => {
    canManageClassExceptionsMock.mockResolvedValueOnce(true)

    const { PATCH } = await import('@/app/api/commissioner/leagues/[leagueId]/invite/route')
    const res = await PATCH(
      new Request('http://localhost/api/commissioner/leagues/league-1/invite', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open_to_everyone' }),
      }) as any,
      { params: Promise.resolve({ leagueId: 'league-1' }) }
    )

    expect(res.status).toBe(400)
    expect(decideClassExceptionMock).not.toHaveBeenCalled()
  })

  it('normal invite remains bypassRankGate false', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({ settings: { inviteCode: 'NORMAL01' } })

    leagueUpdateMock.mockResolvedValue({
      id: 'league-1',
      settings: {
        inviteCode: 'NORMAL01',
        inviteLink: 'https://allfantasy.ai/join?code=NORMAL01',
        inviteExpiresAt: '2030-01-01T00:00:00.000Z',
      },
    })

    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/invite/route')
    const res = await POST(
      new Request('http://localhost/api/commissioner/leagues/league-1/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate: false }),
      }) as any,
      { params: Promise.resolve({ leagueId: 'league-1' }) }
    )

    expect(res.status).toBe(200)
    expect(assertCommissionerMock).toHaveBeenCalledWith('league-1', 'u-commissioner')
    expect(leagueInviteUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { token: 'NORMAL01' },
        update: expect.objectContaining({ bypassRankGate: false }),
        create: expect.objectContaining({ bypassRankGate: false }),
      })
    )
    const body = await res.json()
    expect(body.bypassRankGate).toBe(false)
  })
})
