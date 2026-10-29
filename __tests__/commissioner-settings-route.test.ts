import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()
const assertCommissionerMock = vi.fn()
const isAdminRoleMock = vi.fn()
const isAdminEmailAllowedMock = vi.fn()
const validateCommissionerPatchMock = vi.fn()
const updateLeagueSettingsMock = vi.fn()

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

vi.mock('@/lib/commissioner-settings', () => ({
  getLeagueConfiguration: vi.fn(),
  validateCommissionerPatch: validateCommissionerPatchMock,
}))

vi.mock('@/lib/commissioner-settings/CommissionerSettingsService', () => ({
  updateLeagueSettings: updateLeagueSettingsMock,
}))

describe('/api/commissioner/leagues/[leagueId]/settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-commissioner', role: 'commissioner', email: 'comm@test.dev' } })
    assertCommissionerMock.mockResolvedValue(undefined)
    isAdminRoleMock.mockReturnValue(false)
    isAdminEmailAllowedMock.mockReturnValue(false)
    validateCommissionerPatchMock.mockReturnValue({ valid: true })
    updateLeagueSettingsMock.mockResolvedValue({ id: 'league-1', settings: { allowMemberInviteRankBypass: true } })
  })

  it('commissioner can update allowMemberInviteRankBypass', async () => {
    const { PATCH } = await import('@/app/api/commissioner/leagues/[leagueId]/settings/route')
    const res = await PATCH(
      new Request('http://localhost/api/commissioner/leagues/league-1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowMemberInviteRankBypass: true }),
      }),
      { params: { leagueId: 'league-1' } }
    )

    expect(res.status).toBe(200)
    expect(assertCommissionerMock).toHaveBeenCalledWith('league-1', 'u-commissioner')
    expect(updateLeagueSettingsMock).toHaveBeenCalledWith('league-1', { allowMemberInviteRankBypass: true }, 'u-commissioner')
    const body = await res.json()
    expect(body.settings.allowMemberInviteRankBypass).toBe(true)
  })

  it('admin can update settings without commissioner ownership', async () => {
    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'u-admin', role: 'admin', email: 'admin@test.dev' } })
    isAdminRoleMock.mockReturnValueOnce(true)

    const { PATCH } = await import('@/app/api/commissioner/leagues/[leagueId]/settings/route')
    const res = await PATCH(
      new Request('http://localhost/api/commissioner/leagues/league-1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowMemberInviteRankBypass: false }),
      }),
      { params: { leagueId: 'league-1' } }
    )

    expect(res.status).toBe(200)
    expect(assertCommissionerMock).not.toHaveBeenCalled()
    expect(updateLeagueSettingsMock).toHaveBeenCalledWith('league-1', { allowMemberInviteRankBypass: false }, 'u-admin')
  })

  it('non-commissioner non-admin cannot update settings', async () => {
    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'u-member', role: 'member', email: 'member@test.dev' } })
    assertCommissionerMock.mockRejectedValueOnce(new Error('forbidden'))

    const { PATCH } = await import('@/app/api/commissioner/leagues/[leagueId]/settings/route')
    const res = await PATCH(
      new Request('http://localhost/api/commissioner/leagues/league-1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowMemberInviteRankBypass: true }),
      }),
      { params: { leagueId: 'league-1' } }
    )

    expect(res.status).toBe(403)
    expect(updateLeagueSettingsMock).not.toHaveBeenCalled()
  })
})
