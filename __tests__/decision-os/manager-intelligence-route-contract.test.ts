/**
 * Decision OS — Phase 8.1 / Phase OS-C6.1.
 *
 * Contract test for `/api/decision-os/manager-intelligence` — this route had no dedicated test
 * coverage before Phase OS-C6.1. Mirrors `/api/decision-os/user-os`'s own contract exactly
 * (session-gated 401, `leagueId` required 400, always resolves the SESSION user's own managerId,
 * now gated by `authorizeLeagueRead`). No DB, no network — `resolveManagerIntelligencePayload` is
 * mocked; this file only proves the route's own dispatch contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 THIS SUITE MOCKED A FUNCTION THE ROUTE NO LONGER CALLS, AND OMITTED THE ONE IT DOES.
 * Milestone 32 stopped this route composing a manager dossier. It no longer calls
 * `resolveManagerIntelligencePayload` at all — it hard-codes `managerDna: null` and
 * `recommendations: null` and resolves ONLY `resolveLeagueActivityTrend(leagueId)`.
 *
 * The factory below still returned the old export and not the new one, so every test that reached
 * the handler died on "No `resolveLeagueActivityTrend` export is defined on the mock" — four
 * assertions that looked like route failures and were actually a stale double. The repo has this
 * exact pattern written down: a mock that contradicts its module's contract keeps running and
 * asserts nothing.
 *
 * ⚠ `resolveManagerIntelligencePayload` is deliberately NOT carried over. Keeping a mock for a
 * function the route cannot call would let "never called" assertions pass forever without meaning
 * anything — the green-guard-that-cannot-fail this repo keeps paying for.
 */
const { getServerSessionMock, resolveLeagueActivityTrendMock, authorizeLeagueReadMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  resolveLeagueActivityTrendMock: vi.fn(),
  authorizeLeagueReadMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/decision-os/dashboard-intelligence', () => ({
  resolveLeagueActivityTrend: resolveLeagueActivityTrendMock,
}))
vi.mock('@/lib/decision-os/leagueReadAuthorization', () => ({
  authorizeLeagueRead: authorizeLeagueReadMock,
}))

import { GET } from '@/app/api/decision-os/manager-intelligence/route'

function req(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0]
}

describe('/api/decision-os/manager-intelligence route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'member' })
  })

  it('requires a session (401)', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence?leagueId=L1'))
    expect(res.status).toBe(401)
    expect(resolveLeagueActivityTrendMock).not.toHaveBeenCalled()
  })

  it('requires leagueId (400)', async () => {
    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence'))
    expect(res.status).toBe(400)
    expect(resolveLeagueActivityTrendMock).not.toHaveBeenCalled()
  })

  it('returns league activity, and WITHHOLDS the manager dossier', async () => {
    const trend = { available: false, reason: 'no_snapshots' }
    resolveLeagueActivityTrendMock.mockResolvedValue(trend)

    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence?leagueId=L1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.leagueTrend).toEqual(trend)
    /**
     * The Milestone 32 invariant, and the reason this route still exists at 200 rather than 410:
     * authenticated league ACTIVITY survives, the inferred manager profile does not.
     */
    expect(body.managerDna).toBeNull()
    expect(body.recommendations).toBeNull()
    expect(body.profileVisibility).toBe('private')
    expect(body.intelligence.status).toBe('unsupported_scope')
    expect(body.intelligence.result).toBeNull()
    expect(resolveLeagueActivityTrendMock).toHaveBeenCalledWith('L1')
    expect(authorizeLeagueReadMock).toHaveBeenCalledWith('L1', 'u1')
  })

  it('reports the withheld dossier as unsupported_scope, not as a transient failure', async () => {
    /**
     * ⚠ THE OLD VERSION OF THIS TEST ASSERTED `evidence_unavailable`, WHICH NOW MEANS THE WRONG
     * THING. That status is the degraded-safe path — "we tried and the evidence was not there" —
     * and a client may reasonably retry it. The dossier is not missing, it is REFUSED, and the
     * route says so with `unsupported_scope` plus `decision_specific_evidence_required`. Asserting
     * the transient code would let a genuine regression back to retryable-failure read as correct.
     */
    resolveLeagueActivityTrendMock.mockResolvedValue({ available: false, reason: 'no_snapshots' })

    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence?leagueId=L1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.intelligence.status).toBe('unsupported_scope')
    expect(body.intelligence.reason).toBe('decision_specific_evidence_required')
    expect(body.intelligence.result).toBeNull()
  })

  // Phase OS-C6.1: real per-league membership authorization coverage — closes the `leagueTrend`
  // (league-wide data) leak this route previously had for non-members.
  it('allows a commissioner to read', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'commissioner' })
    resolveLeagueActivityTrendMock.mockResolvedValue({ available: false, reason: 'no_snapshots' })
    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence?leagueId=L1'))
    expect(res.status).toBe(200)
  })

  it('allows a league member to read', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'member' })
    resolveLeagueActivityTrendMock.mockResolvedValue({ available: false, reason: 'no_snapshots' })
    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence?leagueId=L1'))
    expect(res.status).toBe(200)
  })

  it('denies an authenticated user with no relationship to the league (403), and never reads league activity — no cross-league data leakage', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: false, status: 403 })
    const res = await GET(req('http://localhost/api/decision-os/manager-intelligence?leagueId=L1'))
    expect(res.status).toBe(403)
    /**
     * ⚠ THIS IS THE ASSERTION THE STALE MOCK WAS QUIETLY VOIDING. It used to watch
     * `resolveManagerIntelligencePayload`, which the route stopped calling — so it proved the
     * non-member reached nothing by watching a function NOBODY reaches, and would have stayed green
     * with the authorization gate deleted. Pointed at the trend resolver it is load-bearing again:
     * `leagueTrend` is league-wide data, and this is what keeps a non-member from reading it.
     */
    expect(resolveLeagueActivityTrendMock).not.toHaveBeenCalled()
  })
})
