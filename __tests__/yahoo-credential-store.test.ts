/**
 * The two Yahoo credential stores, reconciled.
 *
 * 🛑 WHAT THIS GUARDS, AND WHY SOURCE-TEXT ASSERTIONS COULD NOT. The bug was not
 * a missing line — it was a write landing in the wrong table. Every part looked
 * right in isolation: the callback stored a real token, the row was real, the
 * redirect was real. Only the destination was wrong, and nothing type-checks a
 * destination. So these tests RUN the handlers and read where the write went.
 *
 * The failure they exist to prevent, measured in production before the fix:
 * `YahooConnection` 0 rows, `YahooLeague` 0 rows, `import_runs` provider='yahoo'
 * 0 EVER — while the OAuth round trip completed successfully every time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

const getServerSessionMock = vi.hoisted(() => vi.fn())
const leagueAuthUpsertMock = vi.hoisted(() => vi.fn())
const leagueAuthFindUniqueMock = vi.hoisted(() => vi.fn())
const yahooConnectionUpsertMock = vi.hoisted(() => vi.fn())
const yahooConnectionUpdateManyMock = vi.hoisted(() => vi.fn())
const yahooConnectionFindUniqueMock = vi.hoisted(() => vi.fn())
const yahooLeagueUpsertMock = vi.hoisted(() => vi.fn())
const requireVerifiedUserMock = vi.hoisted(() => vi.fn())

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: requireVerifiedUserMock }))
vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage:
    () =>
    <T extends (...args: any[]) => any>(handler: T) =>
      handler,
}))
vi.mock('@/lib/league-auth-crypto', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => String(v).replace(/^enc:/, ''),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueAuth: { upsert: leagueAuthUpsertMock, findUnique: leagueAuthFindUniqueMock, update: vi.fn() },
    yahooConnection: {
      upsert: yahooConnectionUpsertMock,
      updateMany: yahooConnectionUpdateManyMock,
      findUnique: yahooConnectionFindUniqueMock,
    },
    yahooLeague: { upsert: yahooLeagueUpsertMock, findUnique: vi.fn() },
    yahooTeam: { upsert: vi.fn() },
  },
}))

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env.YAHOO_CLIENT_ID = 'test-client-id'
  process.env.YAHOO_CLIENT_SECRET = 'test-client-secret'
  getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
  requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'u1' })
  leagueAuthUpsertMock.mockResolvedValue({})
  yahooConnectionUpsertMock.mockResolvedValue({})
  yahooConnectionUpdateManyMock.mockResolvedValue({ count: 0 })
})

describe('the OAuth callback stores the credential where every reader looks', () => {
  async function runCallback() {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          fantasy_content: {
            users: [{ user: [{ guid: 'YGUID', profile: { display_name: 'Guap' } }] }],
          },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await import('@/app/api/auth/yahoo/callback/route')
    return GET(
      createMockNextRequest(
        'http://localhost:3000/api/auth/yahoo/callback?code=abc&state=st',
        { headers: { cookie: 'yahoo_oauth_state=st; yahoo_oauth_user_id=u1' } },
      ) as any,
    )
  }

  it('🛑 writes the token to league_auths, keyed on the APP user', async () => {
    await runCallback()

    expect(leagueAuthUpsertMock).toHaveBeenCalledTimes(1)
    const args = leagueAuthUpsertMock.mock.calls[0][0]
    expect(args.where).toEqual({ userId_platform: { userId: 'u1', platform: 'yahoo' } })
    expect(args.create.oauthToken).toBe('enc:AT')
    expect(args.create.oauthSecret).toBe('enc:RT')
    expect(args.update.oauthToken).toBe('enc:AT')
  })

  it('🛑 never puts a token on the identity row', async () => {
    await runCallback()

    expect(yahooConnectionUpsertMock).toHaveBeenCalledTimes(1)
    const args = yahooConnectionUpsertMock.mock.calls[0][0]
    /*
     * This is the assertion that fails against the old code, which set
     * accessToken/refreshToken/tokenExpiresAt here and wrote league_auths never.
     */
    for (const forbidden of ['accessToken', 'refreshToken', 'tokenExpiresAt']) {
      expect(args.create).not.toHaveProperty(forbidden)
      expect(args.update).not.toHaveProperty(forbidden)
    }
    expect(args.where).toEqual({ yahooUserId: 'YGUID' })
    expect(args.create.userId).toBe('u1')
  })

  it('detaches a stale identity row before claiming the new one', async () => {
    // YahooConnection.userId is unique, so reconnecting under a DIFFERENT Yahoo
    // account collides with the user's own previous row.
    await runCallback()

    expect(yahooConnectionUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: 'u1', NOT: { yahooUserId: 'YGUID' } },
      data: { userId: null },
    })
  })

  it('a failed identity link does not cost a completed connect', async () => {
    yahooConnectionUpsertMock.mockRejectedValueOnce(new Error('unique violation'))
    const res = await runCallback()

    expect(leagueAuthUpsertMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(307)
    const dest = new URL(res.headers.get('location') as string)
    expect(dest.searchParams.get('yahoo_connected')).toBe('1')
  })
})

describe('/api/yahoo/leagues reads the same store, and needs no cookie', () => {
  it('serves a connection that has only a league_auths row', async () => {
    // The exact production state: connected via /api/league/yahoo/callback, so
    // the credential exists and the identity row never did. This used to 401.
    leagueAuthFindUniqueMock.mockResolvedValue({ oauthToken: 'enc:AT', oauthSecret: 'enc:RT' })
    yahooConnectionFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'c1', yahooUserId: 'YGUID', displayName: 'Guap' })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          fantasy_content: { users: [{ user: [{ guid: 'YGUID', profile: { display_name: 'Guap' } }] }] },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ fantasy_content: { users: [{ user: [null, { games: {} }] }] } }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await import('@/app/api/yahoo/leagues/route')
    const res = await GET(createMockNextRequest('http://localhost:3000/api/yahoo/leagues') as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.connected).toBe(true)
    expect(body.yahooUserId).toBe('YGUID')
    // Self-healed: the identity row was created from the token we already held.
    expect(yahooConnectionUpsertMock).toHaveBeenCalled()
  })

  it('reports "not connected" from the credential store, not from a cookie', async () => {
    leagueAuthFindUniqueMock.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn())

    const { GET } = await import('@/app/api/yahoo/leagues/route')
    const res = await GET(createMockNextRequest('http://localhost:3000/api/yahoo/leagues') as any)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.connected).toBe(false)
    expect(body.error).toContain('Connect Yahoo')
  })
})
