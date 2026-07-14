import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const isElevatedCommissionerMock = vi.fn()
const finalizeAfLeagueTradeProcessingMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMember: assertLeagueMemberMock,
}))

vi.mock('@/server/services/permissionService', () => ({
  isElevatedCommissioner: isElevatedCommissionerMock,
}))

vi.mock('@/lib/league-trade-engine/tradeService', () => ({
  finalizeAfLeagueTradeProcessing: finalizeAfLeagueTradeProcessingMock,
}))

describe('league trade process route authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    assertLeagueMemberMock.mockResolvedValue({ ok: true })
  })

  it('blocks league members who are not elevated commissioners', async () => {
    isElevatedCommissionerMock.mockResolvedValue(false)
    const { POST } = await import('@/app/api/leagues/[leagueId]/trades/[tradeId]/process/route')

    const res = await POST({} as never, {
      params: Promise.resolve({ leagueId: 'league-1', tradeId: 'trade-1' }),
    })

    expect(res.status).toBe(403)
    expect(finalizeAfLeagueTradeProcessingMock).not.toHaveBeenCalled()
  })

  it('allows elevated commissioners to finalize trade processing', async () => {
    isElevatedCommissionerMock.mockResolvedValue(true)
    finalizeAfLeagueTradeProcessingMock.mockResolvedValue(undefined)
    const { POST } = await import('@/app/api/leagues/[leagueId]/trades/[tradeId]/process/route')

    const res = await POST({} as never, {
      params: Promise.resolve({ leagueId: 'league-1', tradeId: 'trade-1' }),
    })

    expect(res.status).toBe(200)
    expect(finalizeAfLeagueTradeProcessingMock).toHaveBeenCalledWith({
      tradeId: 'trade-1',
      actorUserId: 'user-1',
    })
  })
})
