import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * A dead Yahoo refresh token left the user with no way back.
 *
 * `invalid_grant` is terminal — the token is revoked, expired, or already used,
 * and only re-consent recovers it. But the failure threw with the vendor's raw
 * JSON interpolated, and the discover route returns `error.message` straight to
 * the browser, so the user saw:
 *
 *     Yahoo token refresh failed: {"error":"invalid_grant",
 *     "error_description":"Invalid refresh token"}
 *
 * while the dead credential stayed in the database. `getYahooAuthForUser` gates
 * on `oauthToken` being present, so the connection kept reading as live and kept
 * failing identically, with nothing prompting a reconnect.
 *
 * The refresh only runs after an API call 401s, so these tests drive both legs.
 */
const findUnique = vi.fn()
const update = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueAuth: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}))
vi.mock('@/lib/league-auth-crypto', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => String(v).replace(/^enc:/, ''),
}))

const TOKEN_URL = 'api.login.yahoo.com/oauth2/get_token'

function res(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'err',
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response
}

/** 401 on the API call (which is what triggers a refresh), then `tokenBody`. */
function stubYahoo(tokenStatus: number, tokenBody: string) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes(TOKEN_URL)) return res(tokenStatus, tokenBody)
    return res(401, 'expired')
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function listLeagues(userId: string): Promise<unknown> {
  const mod = await import('@/lib/league-import/yahoo/YahooLeagueFetchService')
  return mod.listYahooLeaguesForAccount(userId)
}

describe('Yahoo OAuth reconnect', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    process.env.YAHOO_CLIENT_ID = 'cid'
    process.env.YAHOO_CLIENT_SECRET = 'csecret'
    findUnique.mockReset().mockResolvedValue({
      oauthToken: 'enc:dead-access',
      oauthSecret: 'enc:dead-refresh',
    })
    update.mockReset().mockResolvedValue({})
  })

  it('clears the dead token on invalid_grant, so the Connect button comes back', async () => {
    stubYahoo(400, '{"error":"invalid_grant","error_description":"Invalid refresh token"}')
    await expect(listLeagues('user-1')).rejects.toThrow(/reconnect Yahoo/i)

    expect(update, 'the dead credential was left in place').toHaveBeenCalled()
    const data = (update.mock.calls[0]?.[0] as { data?: Record<string, unknown> })?.data ?? {}
    // getYahooAuthForUser gates on oauthToken — nulling it is what makes the
    // next attempt say "Connect Yahoo" instead of failing the same way forever.
    expect(data.oauthToken).toBeNull()
    expect(data.oauthSecret).toBeNull()
  })

  it('never shows the user the vendor JSON', async () => {
    stubYahoo(400, '{"error":"invalid_grant","error_description":"Invalid refresh token"}')
    // The discover route returns error.message verbatim to the browser.
    await expect(listLeagues('user-1')).rejects.not.toThrow(/invalid_grant|error_description|[{}]/)
  })

  it('does NOT cost the user their connection on a transient failure', async () => {
    // A 500 is Yahoo having a bad day. Clearing here would turn a blip into a
    // forced re-consent — the opposite error, and the worse one.
    stubYahoo(500, 'upstream boom')
    await expect(listLeagues('user-1')).rejects.toThrow(/HTTP 500/)
    expect(update, 'a transient 500 destroyed a working connection').not.toHaveBeenCalled()
  })

  it('does not clear on an HTML error body it cannot parse', async () => {
    stubYahoo(503, '<html>Service Unavailable</html>')
    await expect(listLeagues('user-1')).rejects.toThrow(/HTTP 503/)
    expect(update).not.toHaveBeenCalled()
  })
})
