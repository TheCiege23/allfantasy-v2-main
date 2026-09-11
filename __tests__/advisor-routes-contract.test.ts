import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()
const getLeagueAdvisorAdviceMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/league-advisor', () => ({
  getLeagueAdvisorAdvice: getLeagueAdvisorAdviceMock,
}))

describe('Advisor route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-1' } })
  })

  it('enforces auth and validates required leagueId', async () => {
    const { GET } = await import('@/app/api/leagues/[leagueId]/advisor/handler')

    getServerSessionMock.mockResolvedValueOnce(null)
    const unauthRes = await GET(new Request('http://localhost/api/leagues/lg-1/advisor'), {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })
    expect(unauthRes.status).toBe(401)
    await expect(unauthRes.json()).resolves.toEqual({ error: 'Unauthorized' })

    const missingLeagueRes = await GET(new Request('http://localhost/api/leagues//advisor'), {
      params: Promise.resolve({ leagueId: '' }),
    })
    expect(missingLeagueRes.status).toBe(400)
    await expect(missingLeagueRes.json()).resolves.toEqual({ error: 'Missing leagueId' })
  })

  it('returns 404 when advisor has no accessible league/roster', async () => {
    const { GET } = await import('@/app/api/leagues/[leagueId]/advisor/handler')
    getLeagueAdvisorAdviceMock.mockResolvedValueOnce(null)

    const res = await GET(new Request('http://localhost/api/leagues/lg-1/advisor'), {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({
      error: 'League or roster not found, or you do not have access.',
    })
  })

  it('forwards user-scoped params and returns structured advice', async () => {
    const { GET } = await import('@/app/api/leagues/[leagueId]/advisor/handler')
    getLeagueAdvisorAdviceMock.mockResolvedValueOnce({
      lineup: [{ summary: 'Start A', priority: 'high' }],
      trade: [],
      waiver: [{ summary: 'Add B', priority: 'medium' }],
      injury: [],
      generatedAt: '2026-03-22T00:00:00.000Z',
      leagueId: 'lg-1',
      sport: 'NBA',
    })

    const res = await GET(new Request('http://localhost/api/leagues/lg-1/advisor'), {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })
    expect(res.status).toBe(200)
    expect(getLeagueAdvisorAdviceMock).toHaveBeenCalledWith({
      leagueId: 'lg-1',
      userId: 'u-1',
    })
  })
})
