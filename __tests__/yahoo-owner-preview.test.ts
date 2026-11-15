/**
 * Owner preview — YAHOO_PREVIEW_USER_IDS lets named app users through the Yahoo CONNECT flow and
 * the league list while Yahoo is still "coming soon" for everyone else.
 *
 * The three things that must hold, and each has a test that fails if it stops holding:
 *   1. an allowlisted, signed-in user reaches Yahoo's consent screen;
 *   2. everyone else — signed out, or signed in but not listed — still gets "coming soon";
 *   3. the list does not leak into the import config: Yahoo stays coming_soon for the product.
 *
 * The no-list path (env unset) is covered by yahoo-coming-soon-gate.test.ts, which asserts the
 * session is never read; that file runs against this same code and must stay green.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'
import { getImportPlatformStatus } from '@/lib/league-import/provider-ui-config'

const getServerSessionMock = vi.hoisted(() => vi.fn())
const requireVerifiedUserMock = vi.hoisted(() => vi.fn())

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: requireVerifiedUserMock, requireAgeConfirmedUser: requireVerifiedUserMock }))
vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage:
    () =>
    <T>(handler: T) =>
      handler,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const OWNER = 'aaaaaaaa-0000-4000-8000-00000000beef'
const OTHER = '00000000-0000-0000-0000-000000000001'

const ENV_KEYS = ['YAHOO_PREVIEW_USER_IDS', 'YAHOO_CLIENT_ID', 'YAHOO_CLIENT_SECRET', 'YAHOO_REDIRECT_URI'] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.YAHOO_PREVIEW_USER_IDS = ` ${OWNER} , ,another-id `
  process.env.YAHOO_CLIENT_ID = 'test-client-id'
  process.env.YAHOO_REDIRECT_URI = 'http://localhost:3000/api/league/yahoo/callback'
  delete process.env.YAHOO_CLIENT_SECRET
  vi.resetModules()
  getServerSessionMock.mockReset()
  requireVerifiedUserMock.mockReset()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.restoreAllMocks()
})

function comingSoon(location: string): boolean {
  return location.includes('yahoo_error=coming_soon')
}

describe('the allowlist itself', () => {
  it('parses a comma list, trimming whitespace and dropping blanks', async () => {
    const { yahooPreviewUserIds, isYahooPreviewConfigured } = await import('@/lib/yahoo/yahooAvailability')
    expect([...yahooPreviewUserIds()].sort()).toEqual([OWNER, 'another-id'].sort())
    expect(isYahooPreviewConfigured()).toBe(true)
  })

  it('opens only for listed ids, never for a missing one', async () => {
    const { isYahooOpenForUser } = await import('@/lib/yahoo/yahooAvailability')
    expect(isYahooOpenForUser(OWNER)).toBe(true)
    expect(isYahooOpenForUser(OTHER)).toBe(false)
    expect(isYahooOpenForUser(null)).toBe(false)
    expect(isYahooOpenForUser('')).toBe(false)
  })

  it('an empty or whitespace-only value configures nothing', async () => {
    process.env.YAHOO_PREVIEW_USER_IDS = ' , '
    const { isYahooPreviewConfigured, isYahooOpenForUser } = await import('@/lib/yahoo/yahooAvailability')
    expect(isYahooPreviewConfigured()).toBe(false)
    expect(isYahooOpenForUser(OWNER)).toBe(false)
  })

  it('does not open Yahoo for the product — the import config still says coming soon', () => {
    expect(getImportPlatformStatus('yahoo')).toBe('coming_soon')
  })
})

describe.each([
  ['/api/auth/yahoo', '@/app/api/auth/yahoo/route'],
  ['/api/league/yahoo-auth', '@/app/api/league/yahoo-auth/route'],
])('%s', (path, modulePath) => {
  async function hit(): Promise<string> {
    const { GET } = (await import(modulePath)) as { GET: (r: unknown) => Promise<Response> }
    const res = await GET(createMockNextRequest(`http://localhost:3000${path}?returnTo=%2Fimport`) as never)
    return res.headers.get('location') ?? ''
  }

  it('sends an allowlisted, signed-in user to Yahoo consent with state and fspt-r', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: OWNER } })
    const location = await hit()
    expect(comingSoon(location)).toBe(false)
    const url = new URL(location)
    expect(`${url.origin}${url.pathname}`).toBe('https://api.login.yahoo.com/oauth2/request_auth')
    expect(url.searchParams.get('scope')).toBe('fspt-r')
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/)
    // Read once, not twice: the gate's session is the one the rest of the handler uses.
    expect(getServerSessionMock).toHaveBeenCalledTimes(1)
  })

  it('still says coming soon to a signed-in user who is not on the list', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: OTHER } })
    const location = await hit()
    expect(comingSoon(location)).toBe(true)
    expect(location).not.toMatch(/login\.yahoo\.com/)
  })

  it('still says coming soon to a signed-out visitor, rather than asking them to sign in', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const location = await hit()
    expect(comingSoon(location)).toBe(true)
    expect(location).not.toMatch(/\/login\?/)
  })
})

describe('/api/yahoo/leagues', () => {
  it('lets an allowlisted user past the gate (here, to the missing-secret 500 behind it)', async () => {
    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: OWNER, profile: {} })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { GET } = await import('@/app/api/yahoo/leagues/route')
    const res = await GET(createMockNextRequest('http://localhost:3000/api/yahoo/leagues') as never)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Yahoo integration is not configured')
  })

  it('answers 409 coming_soon to a verified user who is not on the list', async () => {
    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: OTHER, profile: {} })
    const { GET, POST } = await import('@/app/api/yahoo/leagues/route')
    const get = await GET(createMockNextRequest('http://localhost:3000/api/yahoo/leagues') as never)
    expect(get.status).toBe(409)
    const post = await POST(
      createMockNextRequest('http://localhost:3000/api/yahoo/leagues', {
        method: 'POST',
        body: JSON.stringify({ leagueKey: '449.l.1' }),
      }) as never,
    )
    expect(post.status).toBe(409)
  })

  it('answers 409 coming_soon, not 401, to a signed-out caller', async () => {
    requireVerifiedUserMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
    const { GET } = await import('@/app/api/yahoo/leagues/route')
    const res = await GET(createMockNextRequest('http://localhost:3000/api/yahoo/leagues') as never)
    expect(res.status).toBe(409)
  })
})
