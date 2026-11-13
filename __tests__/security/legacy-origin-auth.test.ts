/**
 * `requireAuthOrOrigin(req)` (lib/api-auth.ts) returns `{ authenticated: true, user: null }`
 * for ANY anonymous caller whose `Origin` header matches — a header curl sets with one flag.
 * Several legacy route modules used it as their only "auth" and then read or wrote the data of
 * whatever `userId` / `username` the caller named.
 *
 * These tests drive the REAL route handlers and the REAL `requireLegacySleeperIdentity` gate,
 * with only the session lookup, prisma and the data libraries mocked. `NODE_ENV` is stubbed
 * to production so the origin check is genuinely evaluated (outside production
 * `validateRequestOrigin` returns true unconditionally, which would make the "Origin header
 * only" framing meaningless).
 *
 * Every attack-shaped request below sends a VALID production `Origin`. That is the point: the
 * origin is the attacker's free variable, so a passing origin must never be enough.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  appUserFindUnique: vi.fn(),
  legacyUserFindUnique: vi.fn(),
  decisionLogFindMany: vi.fn(),
  decisionLogFindUnique: vi.fn(),
  aIInsightFindUnique: vi.fn(),
  logDecision: vi.fn(),
  resolveDecision: vi.fn(),
  getDecisionLogsForCoach: vi.fn(),
  getDecisionSummary: vi.fn(),
  getUnresolvedDecisions: vi.fn(),
  getUserBadges: vi.fn(),
  getUserTotalXP: vi.fn(),
  markInsightRead: vi.fn(),
  dismissInsight: vi.fn(),
}))

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
// The NextAuth session lookup — the one thing an anonymous curl caller does not have.
vi.mock('@/lib/auth-guard', () => ({ requireAuth: () => m.requireAuth() }))
vi.mock('@/lib/guest-mode/guestSessionToken', () => ({
  GUEST_SESSION_COOKIE_NAME: 'af_guest_session',
  verifyGuestSessionToken: async () => null,
}))
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: () => ({ success: true, remaining: 99, retryAfterSec: 0 }),
  buildRateLimit429: () => ({ error: 'rate limited' }),
  getClientIp: () => '203.0.113.7',
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: { findUnique: (a: unknown) => m.appUserFindUnique(a) },
    legacyUser: { findUnique: (a: unknown) => m.legacyUserFindUnique(a) },
    decisionLog: {
      findMany: (a: unknown) => m.decisionLogFindMany(a),
      findUnique: (a: unknown) => m.decisionLogFindUnique(a),
    },
    aIInsight: { findUnique: (a: unknown) => m.aIInsightFindUnique(a) },
  },
}))
vi.mock('@/lib/decision-log', () => ({
  logDecision: (a: unknown) => m.logDecision(a),
  resolveDecision: (a: unknown) => m.resolveDecision(a),
  getDecisionLogsForCoach: (...a: unknown[]) => m.getDecisionLogsForCoach(...a),
  getDecisionSummary: (...a: unknown[]) => m.getDecisionSummary(...a),
  getUnresolvedDecisions: (...a: unknown[]) => m.getUnresolvedDecisions(...a),
}))
vi.mock('@/lib/badge-engine', () => ({
  getUserBadges: (u: string) => m.getUserBadges(u),
  getUserTotalXP: (u: string) => m.getUserTotalXP(u),
  getBadgeDefinitions: () => ({}),
}))
vi.mock('@/lib/insights-engine', () => ({
  generateUserInsights: vi.fn(),
  getUnreadInsights: vi.fn(async () => []),
  markInsightRead: (id: string) => m.markInsightRead(id),
  dismissInsight: (id: string) => m.dismissInsight(id),
}))

type Handler = (req: NextRequest) => Promise<Response>
const decisionLog = await import('@/server/api-route-modules/legacy/decision-log/route')
const decisionLogResolve = await import('@/server/api-route-modules/legacy/decision-log/resolve/route')
const badges = await import('@/server/api-route-modules/legacy/badges/route')
const insights = await import('@/server/api-route-modules/legacy/insights/route')

const ORIGIN = 'https://allfantasy.ai'
const OWNER = 'realowner'
const OWNER_SLEEPER_ID = '730000000000000001'
const VICTIM = 'victim'
const LOG_ID = '0b9f2a0e-6c55-4b8e-9b1e-5d7d0c1f4a11'

function get(path: string, headers: Record<string, string> = { origin: ORIGIN }) {
  return new NextRequest(`http://localhost${path}`, { method: 'GET', headers })
}
function send(method: string, path: string, body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}
const call = (h: unknown, req: NextRequest) => (h as Handler)(req)

/** Anonymous: no NextAuth session — exactly what a curl caller with a forged Origin has. */
function asAnonymous() {
  m.requireAuth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
}
/** Signed in as the account whose server-side link is `OWNER`. */
function asOwner() {
  m.requireAuth.mockResolvedValue({ ok: true, userId: 'appuser-owner' })
  m.appUserFindUnique.mockResolvedValue({ legacyUser: { sleeperUsername: OWNER } })
  m.legacyUserFindUnique.mockResolvedValue({ sleeperUserId: OWNER_SLEEPER_ID })
}

beforeAll(() => {
  vi.stubEnv('NODE_ENV', 'production')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.clearAllMocks()
  m.getDecisionLogsForCoach.mockResolvedValue([{ decisionType: 'trade', recommendation: 'secret' }])
  m.getDecisionSummary.mockResolvedValue({ total: 1 })
  m.getUnresolvedDecisions.mockResolvedValue([])
  m.decisionLogFindMany.mockResolvedValue([])
  m.logDecision.mockImplementation(async (input: { userId: string }) => ({ id: 'new-log', ...input }))
  m.resolveDecision.mockResolvedValue({ id: LOG_ID, resolvedAt: new Date() })
  m.getUserBadges.mockResolvedValue([])
  m.getUserTotalXP.mockResolvedValue(0)
})

describe('decision-log GET — the verified example', () => {
  it("refuses an anonymous caller naming a victim's userId with only an Origin header", async () => {
    asAnonymous()
    const res = await call(decisionLog.GET, get(`/api/legacy/decision-log?userId=${VICTIM}&view=coach`))
    expect(res.status).toBe(401)
    expect(m.getDecisionLogsForCoach).not.toHaveBeenCalled()
  })

  it("refuses a SIGNED-IN caller naming someone else's userId (403, visible — not a silent swap)", async () => {
    asOwner()
    const res = await call(decisionLog.GET, get(`/api/legacy/decision-log?userId=${VICTIM}&view=coach`))
    expect(res.status).toBe(403)
    expect(m.getDecisionLogsForCoach).not.toHaveBeenCalled()
    expect(m.decisionLogFindMany).not.toHaveBeenCalled()
  })

  it("serves the session user's own log, by username or by their own Sleeper user id", async () => {
    asOwner()
    const byName = await call(decisionLog.GET, get(`/api/legacy/decision-log?userId=${OWNER}&view=coach&limit=5`))
    expect(byName.status).toBe(200)
    expect(await byName.json()).toMatchObject({ ok: true, decisions: [{ recommendation: 'secret' }] })
    expect(m.getDecisionLogsForCoach).toHaveBeenCalledWith(OWNER, 5)

    // waiver/analyze keys its writes on the Sleeper user id; that is also the caller's own.
    const byId = await call(decisionLog.GET, get(`/api/legacy/decision-log?userId=${OWNER_SLEEPER_ID}&view=summary`))
    expect(byId.status).toBe(200)
    expect(m.getDecisionSummary).toHaveBeenCalledWith(OWNER_SLEEPER_ID, undefined)

    // Identity came from the session, which the origin-only code never consulted at all.
    expect(m.requireAuth).toHaveBeenCalled()
  })
})

describe('write routes refuse an anonymous Origin-only caller', () => {
  it('decision-log POST does not write into a named user’s log', async () => {
    asAnonymous()
    const res = await call(
      decisionLog.POST,
      send('POST', '/api/legacy/decision-log', {
        userId: VICTIM,
        leagueId: 'league-1',
        decisionType: 'trade',
        aiRecommendation: { summary: 'planted' },
        confidenceScore: 0.9,
        riskProfile: 'low',
      }),
    )
    expect(res.status).toBe(401)
    expect(m.logDecision).not.toHaveBeenCalled()
  })

  it('decision-log POST still refuses a signed-in caller writing under another userId', async () => {
    asOwner()
    const res = await call(
      decisionLog.POST,
      send('POST', '/api/legacy/decision-log', {
        userId: VICTIM,
        leagueId: 'league-1',
        decisionType: 'trade',
        aiRecommendation: { summary: 'planted' },
        confidenceScore: 0.9,
        riskProfile: 'low',
      }),
    )
    expect(res.status).toBe(403)
    expect(m.logDecision).not.toHaveBeenCalled()
  })

  it('decision-log POST keeps the CSRF origin check: a signed-in request with no allowed Origin is 403', async () => {
    asOwner()
    const res = await call(
      decisionLog.POST,
      send(
        'POST',
        '/api/legacy/decision-log',
        { userId: OWNER, leagueId: 'l', decisionType: 'trade', aiRecommendation: {}, confidenceScore: 0.5, riskProfile: 'low' },
        { origin: 'https://evil.example' },
      ),
    )
    expect(res.status).toBe(403)
    expect(m.logDecision).not.toHaveBeenCalled()
  })

  it("decision-log/resolve will not resolve someone else's log by id", async () => {
    asOwner()
    m.decisionLogFindUnique.mockResolvedValue({ userId: VICTIM })
    const res = await call(
      decisionLogResolve.POST,
      send('POST', '/api/legacy/decision-log/resolve', { decisionLogId: LOG_ID, userFollowed: true }),
    )
    expect(res.status).toBe(404)
    expect(m.resolveDecision).not.toHaveBeenCalled()
  })

  it('insights PATCH refuses an anonymous caller dismissing an insight by id', async () => {
    asAnonymous()
    m.aIInsightFindUnique.mockResolvedValue({ userId: VICTIM })
    const res = await call(
      insights.PATCH,
      send('PATCH', '/api/legacy/insights', { insightId: 'insight-1', action: 'dismiss' }),
    )
    expect(res.status).toBe(401)
    expect(m.dismissInsight).not.toHaveBeenCalled()
  })
})

describe('per-user reads keyed on a caller-named username', () => {
  it("badges GET refuses an anonymous caller naming a victim, and a signed-in one naming someone else", async () => {
    asAnonymous()
    const anon = await call(badges.GET, get(`/api/legacy/badges?username=${VICTIM}`))
    expect(anon.status).toBe(401)

    asOwner()
    const other = await call(badges.GET, get(`/api/legacy/badges?username=${VICTIM}`))
    expect(other.status).toBe(403)
    expect(m.getUserBadges).not.toHaveBeenCalled()

    const own = await call(badges.GET, get(`/api/legacy/badges?username=${OWNER}`))
    expect(own.status).toBe(200)
    expect(m.getUserBadges).toHaveBeenCalledWith(OWNER)
  })
})
