/**
 * Cross-League Player Intelligence phase — Part 10 API route tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAuthMock, assembleMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn(), assembleMock: vi.fn() }))

vi.mock('@/lib/auth-guard', () => ({ requireAuth: requireAuthMock }))
vi.mock('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio', () => ({ assembleCrossLeaguePlayerPortfolio: assembleMock }))

function item(overrides: Record<string, unknown> = {}) {
  return {
    canonicalPlayerId: 'p1',
    displayName: 'Player One',
    sport: 'NFL',
    position: 'RB',
    professionalTeam: 'BUF',
    identityConfidence: 'verified',
    injury: null,
    schedule: null,
    exposure: { leagueCount: 1, rosterCount: 1, starterCount: 1, benchCount: 0, injuredReserveCount: 0, taxiCount: 0, percentageOfUserLeagues: 1 },
    leagueAppearances: [],
    actionSummary: { criticalCount: 0, highCount: 0, topAction: null },
    ...overrides,
  }
}

describe('GET /api/player-portfolio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    requireAuthMock.mockResolvedValue({ ok: false, response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) })
    const { GET } = await import('@/app/api/player-portfolio/route')
    const res = await GET(new Request('http://localhost/api/player-portfolio'))
    expect(res.status).toBe(401)
    expect(assembleMock).not.toHaveBeenCalled()
  })

  it('never lets a client-supplied query param grant access to another user — appUserId always comes from the session', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    assembleMock.mockResolvedValue({ items: [], connectedLeagueCount: 0, unsupportedSports: [] })
    const { GET } = await import('@/app/api/player-portfolio/route')
    await GET(new Request('http://localhost/api/player-portfolio?appUserId=someone-else'))
    expect(assembleMock).toHaveBeenCalledWith(expect.objectContaining({ appUserId: 'real-user' }))
  })

  it('filters by injury status', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    assembleMock.mockResolvedValue({
      items: [item({ canonicalPlayerId: 'p1', injury: { status: 'out' } }), item({ canonicalPlayerId: 'p2', injury: { status: 'healthy' } })],
      connectedLeagueCount: 1,
      unsupportedSports: [],
    })
    const { GET } = await import('@/app/api/player-portfolio/route')
    const res = await GET(new Request('http://localhost/api/player-portfolio?injuryStatus=out'))
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].canonicalPlayerId).toBe('p1')
  })

  it('filters to action-needed only', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    assembleMock.mockResolvedValue({
      items: [
        item({ canonicalPlayerId: 'p1', actionSummary: { criticalCount: 1, highCount: 0, topAction: null } }),
        item({ canonicalPlayerId: 'p2', actionSummary: { criticalCount: 0, highCount: 0, topAction: null } }),
      ],
      connectedLeagueCount: 1,
      unsupportedSports: [],
    })
    const { GET } = await import('@/app/api/player-portfolio/route')
    const res = await GET(new Request('http://localhost/api/player-portfolio?actionNeeded=true'))
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].canonicalPlayerId).toBe('p1')
  })

  it('sorts by exposure', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    assembleMock.mockResolvedValue({
      items: [
        item({ canonicalPlayerId: 'low', exposure: { ...item().exposure, percentageOfUserLeagues: 0.2 } }),
        item({ canonicalPlayerId: 'high', exposure: { ...item().exposure, percentageOfUserLeagues: 0.9 } }),
      ],
      connectedLeagueCount: 2,
      unsupportedSports: [],
    })
    const { GET } = await import('@/app/api/player-portfolio/route')
    const res = await GET(new Request('http://localhost/api/player-portfolio?sort=exposure'))
    const body = await res.json()
    expect(body.items[0].canonicalPlayerId).toBe('high')
  })

  it('surfaces unsupportedSports truthfully rather than hiding them', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    assembleMock.mockResolvedValue({ items: [], connectedLeagueCount: 1, unsupportedSports: ['NBA', 'MLB'] })
    const { GET } = await import('@/app/api/player-portfolio/route')
    const res = await GET(new Request('http://localhost/api/player-portfolio'))
    const body = await res.json()
    expect(body.unsupportedSports).toEqual(['NBA', 'MLB'])
  })

  it('returns 500 without leaking internals on an unexpected error', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    assembleMock.mockRejectedValue(new Error('db exploded'))
    const { GET } = await import('@/app/api/player-portfolio/route')
    const res = await GET(new Request('http://localhost/api/player-portfolio'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).not.toContain('db exploded')
  })
})
