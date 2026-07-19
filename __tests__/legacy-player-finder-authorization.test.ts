import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireAuthMock = vi.fn()
const appUserFindUniqueMock = vi.fn()
const legacyUserFindUniqueMock = vi.fn()

vi.mock('@/lib/auth-guard', () => ({ requireAuth: requireAuthMock }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: { findUnique: appUserFindUniqueMock },
    legacyUser: { findUnique: legacyUserFindUniqueMock },
    leagueTradeHistory: { findMany: vi.fn().mockResolvedValue([]) },
    leagueTrade: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

// Keep the wrapper transparent so the test exercises the handler itself.
vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: () => (handler: any) => handler,
}))

vi.mock('@/lib/ai/openai-route-client', () => ({
  getOpenAIRouteClient: () => ({ chat: { completions: { create: vi.fn() } } }),
}))

vi.mock('@/lib/sleeper-client', () => ({
  getPlayersBySport: vi.fn().mockResolvedValue({
    '1': { player_id: '1', full_name: 'Josh Allen', position: 'QB', team: 'BUF' },
  }),
  getLeagueRosters: vi.fn().mockResolvedValue([]),
  getLeagueUsers: vi.fn().mockResolvedValue([]),
}))

function finderReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/legacy/player-finder', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.0.1' },
    body: JSON.stringify(body),
  })
}

/** Authenticated as `victim`-adjacent account "alice", who owns the legacy link. */
function authAs(userId: string, linkedUsername: string | null) {
  requireAuthMock.mockResolvedValue({ ok: true, userId, session: {} })
  appUserFindUniqueMock.mockResolvedValue(
    linkedUsername ? { legacyUser: { sleeperUsername: linkedUsername } } : { legacyUser: null }
  )
}

describe('POST /api/legacy/player-finder — authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    legacyUserFindUniqueMock.mockResolvedValue({ id: 'legacy-1', leagues: [] })
  })

  it('rejects unauthenticated callers without touching legacy user data', async () => {
    requireAuthMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })

    const { POST } = await import('@/server/api-route-modules/legacy/player-finder/route')
    const res = await POST(finderReq({ sleeper_username: 'victim', query: 'Allen' }), {} as never)

    expect(res.status).toBe(401)
    expect(legacyUserFindUniqueMock).not.toHaveBeenCalled()
  })

  // The IDOR guard. Authenticated as alice, asking for victim's data: the route must
  // never issue a lookup keyed on 'victim'. Asserting only the status code would pass
  // even if the query ran and the result were discarded.
  it('never queries another user\'s data when the body names someone else', async () => {
    authAs('user-alice', 'alice')

    const { POST } = await import('@/server/api-route-modules/legacy/player-finder/route')
    const res = await POST(finderReq({ sleeper_username: 'victim', query: 'Allen' }), {} as never)

    expect(res.status).toBe(403)
    expect(legacyUserFindUniqueMock).not.toHaveBeenCalled()
  })

  it('derives the username from the session, ignoring an absent body field', async () => {
    authAs('user-alice', 'alice')

    const { POST } = await import('@/server/api-route-modules/legacy/player-finder/route')
    const res = await POST(finderReq({ query: 'Allen' }), {} as never)

    expect(res.status).toBe(404) // no leagues on the stubbed legacy user
    expect(legacyUserFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sleeperUsername: 'alice' } })
    )
  })

  it('409s when the account has no linked Sleeper profile', async () => {
    authAs('user-nolink', null)

    const { POST } = await import('@/server/api-route-modules/legacy/player-finder/route')
    const res = await POST(finderReq({ query: 'Allen' }), {} as never)

    expect(res.status).toBe(409)
    expect(legacyUserFindUniqueMock).not.toHaveBeenCalled()
  })
})
