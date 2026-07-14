/**
 * User OS League-Specific Intelligence Wiring phase — Part 12 API route tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAuthMock, assembleUserOsRecommendationsMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  assembleUserOsRecommendationsMock: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireAuth: requireAuthMock }))
vi.mock('@/lib/shared-services/league-hub/userOsRecommendations', () => ({
  assembleUserOsRecommendations: assembleUserOsRecommendationsMock,
}))

function makeRequest(url: string) {
  return new Request(url)
}

describe('GET /api/league-hub/context/[leagueId]/recommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    requireAuthMock.mockResolvedValue({ ok: false, response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) })
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/recommendations/route')
    const res = await GET(makeRequest('http://localhost/api/league-hub/context/league-1/recommendations') as any, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })
    expect(res.status).toBe(401)
    expect(assembleUserOsRecommendationsMock).not.toHaveBeenCalled()
  })

  it('returns 404 (not membership-derived from client input) when the coordinator reports accessDenied — a non-member gets no data', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'stranger' })
    assembleUserOsRecommendationsMock.mockResolvedValue({ bundle: null, domainStatus: {}, generatedAt: '', accessDenied: true })
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/recommendations/route')
    const res = await GET(makeRequest('http://localhost/api/league-hub/context/league-1/recommendations') as any, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })
    expect(res.status).toBe(404)
  })

  it('never lets client-supplied query params grant access — leagueId access is resolved entirely server-side from the session', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    assembleUserOsRecommendationsMock.mockResolvedValue({
      bundle: { lineup: [], waiver: [], trade: [], roster: [], playoff: [], strategy: [], commissioner: [], totalCount: 0 },
      domainStatus: {},
      generatedAt: '2026-07-13T00:00:00.000Z',
      accessDenied: false,
    })
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/recommendations/route')
    await GET(
      makeRequest('http://localhost/api/league-hub/context/league-1/recommendations?domains=lineup') as any,
      { params: Promise.resolve({ leagueId: 'league-1' }) }
    )
    // appUserId always comes from the resolved session, never from the request.
    expect(assembleUserOsRecommendationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ appUserId: 'real-user', canonicalLeagueId: 'league-1' })
    )
  })

  it('parses domain filtering from the query string, ignoring invalid domain names', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    assembleUserOsRecommendationsMock.mockResolvedValue({
      bundle: { lineup: [], waiver: [], trade: [], roster: [], playoff: [], strategy: [], commissioner: [], totalCount: 0 },
      domainStatus: {},
      generatedAt: '',
      accessDenied: false,
    })
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/recommendations/route')
    await GET(
      makeRequest('http://localhost/api/league-hub/context/league-1/recommendations?domains=lineup,waiver,not_a_real_domain') as any,
      { params: Promise.resolve({ leagueId: 'league-1' }) }
    )
    expect(assembleUserOsRecommendationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestedDomains: ['lineup', 'waiver'] })
    )
  })

  it('surfaces truthful domainStatus (partial-domain failure) in the response body rather than hiding it', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    assembleUserOsRecommendationsMock.mockResolvedValue({
      bundle: { lineup: [], waiver: [], trade: [], roster: [], playoff: [], strategy: [], commissioner: [], totalCount: 0 },
      domainStatus: { lineup: 'unsupported', waiver: 'engine_error' },
      generatedAt: '',
      accessDenied: false,
    })
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/recommendations/route')
    const res = await GET(makeRequest('http://localhost/api/league-hub/context/league-1/recommendations') as any, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })
    const body = await res.json()
    expect(body.domainStatus.lineup).toBe('unsupported')
    expect(body.domainStatus.waiver).toBe('engine_error')
  })

  it('returns 400 without a leagueId', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/recommendations/route')
    const res = await GET(makeRequest('http://localhost/api/league-hub/context//recommendations') as any, {
      params: Promise.resolve({ leagueId: '' }),
    })
    expect(res.status).toBe(400)
  })
})
