/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 15 API route tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAuthMock, assembleCommissionerOsRecommendationsMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  assembleCommissionerOsRecommendationsMock: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireAuth: requireAuthMock }))
vi.mock('@/lib/shared-services/league-hub/commissionerOsRecommendations', () => ({
  assembleCommissionerOsRecommendations: assembleCommissionerOsRecommendationsMock,
}))

function makeRequest(url: string) {
  return new Request(url)
}

describe('GET /api/league-hub/context/[leagueId]/commissioner-recommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    requireAuthMock.mockResolvedValue({ ok: false, response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) })
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/commissioner-recommendations/route')
    const res = await GET(makeRequest('http://localhost/api/league-hub/context/league-1/commissioner-recommendations') as any, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })
    expect(res.status).toBe(401)
    expect(assembleCommissionerOsRecommendationsMock).not.toHaveBeenCalled()
  })

  it('returns 404 (not a distinguishable 403) when the coordinator reports accessDenied — never leaks whether a protected league exists', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'normal-manager' })
    assembleCommissionerOsRecommendationsMock.mockResolvedValue({ bundle: null, domainStatus: {}, generatedAt: '', accessDenied: true })
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/commissioner-recommendations/route')
    const res = await GET(makeRequest('http://localhost/api/league-hub/context/league-1/commissioner-recommendations') as any, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })
    expect(res.status).toBe(404)
  })

  it('a normal manager and a request for a nonexistent league both resolve to the same 404 shape', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'normal-manager' })
    assembleCommissionerOsRecommendationsMock.mockResolvedValue({ bundle: null, domainStatus: {}, generatedAt: '', accessDenied: true })
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/commissioner-recommendations/route')

    const forRealLeague = await GET(makeRequest('http://localhost/api/league-hub/context/real-league/commissioner-recommendations') as any, {
      params: Promise.resolve({ leagueId: 'real-league' }),
    })
    const forFakeLeague = await GET(makeRequest('http://localhost/api/league-hub/context/nonexistent-xyz/commissioner-recommendations') as any, {
      params: Promise.resolve({ leagueId: 'nonexistent-xyz' }),
    })
    expect(forRealLeague.status).toBe(forFakeLeague.status)
    expect((await forRealLeague.json()).error).toBe((await forFakeLeague.json()).error)
  })

  it('never lets client-supplied query params grant access — appUserId is resolved entirely server-side from the session', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-commissioner' })
    assembleCommissionerOsRecommendationsMock.mockResolvedValue({
      bundle: { commissioner: [], totalCount: 0 },
      domainStatus: {},
      generatedAt: '2026-07-13T00:00:00.000Z',
      accessDenied: false,
    })
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/commissioner-recommendations/route')
    await GET(
      makeRequest('http://localhost/api/league-hub/context/league-1/commissioner-recommendations?domains=health') as any,
      { params: Promise.resolve({ leagueId: 'league-1' }) }
    )
    expect(assembleCommissionerOsRecommendationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ appUserId: 'real-commissioner', canonicalLeagueId: 'league-1' })
    )
  })

  it('parses domain filtering from the query string, ignoring invalid domain names', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-commissioner' })
    assembleCommissionerOsRecommendationsMock.mockResolvedValue({
      bundle: { commissioner: [], totalCount: 0 },
      domainStatus: {},
      generatedAt: '',
      accessDenied: false,
    })
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/commissioner-recommendations/route')
    await GET(
      makeRequest('http://localhost/api/league-hub/context/league-1/commissioner-recommendations?domains=health,rivalries,not_a_real_domain') as any,
      { params: Promise.resolve({ leagueId: 'league-1' }) }
    )
    expect(assembleCommissionerOsRecommendationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestedDomains: ['health', 'rivalries'] })
    )
  })

  it('surfaces truthful domainStatus (unsupported/engine_error) in the response body rather than hiding it', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-commissioner' })
    assembleCommissionerOsRecommendationsMock.mockResolvedValue({
      bundle: { commissioner: [], totalCount: 0 },
      domainStatus: { rivalries: 'unsupported', draft: 'engine_error' },
      generatedAt: '',
      accessDenied: false,
    })
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/commissioner-recommendations/route')
    const res = await GET(makeRequest('http://localhost/api/league-hub/context/league-1/commissioner-recommendations') as any, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })
    const body = await res.json()
    expect(body.domainStatus.rivalries).toBe('unsupported')
    expect(body.domainStatus.draft).toBe('engine_error')
  })

  it('returns 400 without a leagueId', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-commissioner' })
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/commissioner-recommendations/route')
    const res = await GET(makeRequest('http://localhost/api/league-hub/context//commissioner-recommendations') as any, {
      params: Promise.resolve({ leagueId: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 500 on an unexpected coordinator error, without leaking internals', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-commissioner' })
    assembleCommissionerOsRecommendationsMock.mockRejectedValue(new Error('db exploded'))
    const { GET } = await import('@/app/api/league-hub/context/[leagueId]/commissioner-recommendations/route')
    const res = await GET(makeRequest('http://localhost/api/league-hub/context/league-1/commissioner-recommendations') as any, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).not.toContain('db exploded')
  })
})
