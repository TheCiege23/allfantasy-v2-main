import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetLeagueRole, mockRequireCommissionerRole, mockRequireCommissionerOnly } = vi.hoisted(() => ({
  mockGetLeagueRole: vi.fn(),
  mockRequireCommissionerRole: vi.fn(),
  mockRequireCommissionerOnly: vi.fn(),
}))

vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: mockGetLeagueRole,
  requireCommissionerRole: mockRequireCommissionerRole,
  requireCommissionerOnly: mockRequireCommissionerOnly,
}))

import {
  requireCommissionerOrCoCommissioner,
  requireHeadCommissionerOnly,
  resolveCommissionerAccess,
} from '@/lib/shared-services/commissioner/CommissionerAuthorization'

describe('resolveCommissionerAccess', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports commissioner access as identity-verified only for native leagues', async () => {
    mockGetLeagueRole.mockResolvedValue('commissioner')
    const result = await resolveCommissionerAccess('league-1', 'user-1', 'native')
    expect(result).toEqual({ role: 'commissioner', isCommissioner: true, isCoCommissioner: false, isMember: true, commissionerIdentityVerified: true })
  })

  it('reports commissioner access as NOT identity-verified for an imported league (real, documented gap)', async () => {
    mockGetLeagueRole.mockResolvedValue('commissioner')
    const result = await resolveCommissionerAccess('league-1', 'user-1', 'sleeper')
    expect(result.isCommissioner).toBe(true)
    expect(result.commissionerIdentityVerified).toBe(false)
  })

  it('reports co-commissioner access correctly', async () => {
    mockGetLeagueRole.mockResolvedValue('co_commissioner')
    const result = await resolveCommissionerAccess('league-1', 'user-1', 'native')
    expect(result.isCoCommissioner).toBe(true)
    expect(result.isCommissioner).toBe(false)
  })

  it('reports a normal member as a member, not a commissioner', async () => {
    mockGetLeagueRole.mockResolvedValue('member')
    const result = await resolveCommissionerAccess('league-1', 'user-1', 'native')
    expect(result).toEqual({ role: 'member', isCommissioner: false, isCoCommissioner: false, isMember: true, commissionerIdentityVerified: false })
  })

  it('reports a non-member honestly (null role)', async () => {
    mockGetLeagueRole.mockResolvedValue(null)
    const result = await resolveCommissionerAccess('league-1', 'user-1', 'native')
    expect(result).toEqual({ role: null, isCommissioner: false, isCoCommissioner: false, isMember: false, commissionerIdentityVerified: false })
  })
})

describe('requireCommissionerOrCoCommissioner / requireHeadCommissionerOnly', () => {
  beforeEach(() => vi.clearAllMocks())

  it('delegates directly to the real requireCommissionerRole, never a second framework', async () => {
    mockRequireCommissionerRole.mockResolvedValue(undefined)
    await requireCommissionerOrCoCommissioner('league-1', 'user-1')
    expect(mockRequireCommissionerRole).toHaveBeenCalledWith('league-1', 'user-1')
  })

  it('propagates a real authorization failure from requireCommissionerRole', async () => {
    mockRequireCommissionerRole.mockRejectedValue(new Error('Forbidden'))
    await expect(requireCommissionerOrCoCommissioner('league-1', 'user-1')).rejects.toThrow('Forbidden')
  })

  it('delegates directly to the real requireCommissionerOnly', async () => {
    mockRequireCommissionerOnly.mockResolvedValue(undefined)
    await requireHeadCommissionerOnly('league-1', 'user-1')
    expect(mockRequireCommissionerOnly).toHaveBeenCalledWith('league-1', 'user-1')
  })

  it('propagates a real authorization failure from requireCommissionerOnly (e.g. a co-commissioner attempting a head-only action)', async () => {
    mockRequireCommissionerOnly.mockRejectedValue(new Error('Head commissioner only'))
    await expect(requireHeadCommissionerOnly('league-1', 'user-1')).rejects.toThrow('Head commissioner only')
  })
})
