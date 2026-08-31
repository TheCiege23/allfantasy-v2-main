// @vitest-environment node
/**
 * Commissioner OS · the first request path through `withTenant`.
 *
 * GET /api/commissioner-os/sync-health, tested at the handler boundary with the
 * database and session mocked. The database assertions here are STRUCTURAL — what
 * the route asks for, and what it never asks for — because the behaviour of RLS
 * itself is proven by the `.spec.ts` suites against a real Postgres. Repeating
 * that here with a mock would prove only that the mock agrees with itself.
 *
 * 🛑 THE TWO TESTS THAT MATTER ARE THE NEGATIVE ONES: that the route never puts
 * a tenant filter in the query, and never takes the tenant from the caller.
 * Both are properties an ordinary "does it return data" test cannot see, and
 * both are how a tenancy boundary is lost — not by deleting a policy, but by
 * quietly adding a second source of truth beside it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const getServerSession = vi.fn()
const resolveTenantsForUser = vi.fn()
const withTenant = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/domain/db', () => ({
  withTenant: (...a: unknown[]) => withTenant(...a),
  resolveTenantsForUser: (...a: unknown[]) => resolveTenantsForUser(...a),
}))

async function callRoute(url = 'http://localhost/api/commissioner-os/sync-health') {
  const { GET } = await import('@/app/api/commissioner-os/sync-health/route')
  return GET(new Request(url))
}

/** Captures the argument the route passes to `leagueBinding.findMany`. */
function captureQuery(rows: unknown[] = []) {
  const findMany = vi.fn(async () => rows)
  withTenant.mockImplementation(async (_tenantId: string, fn: (tx: unknown) => unknown) =>
    fn({ leagueBinding: { findMany } }),
  )
  return findMany
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('GET /api/commissioner-os/sync-health', () => {
  it('401s with no session, and never touches the database', async () => {
    getServerSession.mockResolvedValue(null)
    const res = await callRoute()
    expect(res.status).toBe(401)
    // The half that is easy to omit: an unauthenticated request must not reach
    // the tenant resolver either. Resolving first and checking after would leak
    // membership existence through timing.
    expect(resolveTenantsForUser).not.toHaveBeenCalled()
    expect(withTenant).not.toHaveBeenCalled()
  })

  it('403s when the user belongs to no tenant — not 402', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1', name: 'Dana' } })
    resolveTenantsForUser.mockResolvedValue([])

    const res = await callRoute()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.code).toBe('FORBIDDEN')

    // 🛑 NOT_ENTITLED IS A BILLING ANSWER (402) AND WOULD BE THE WRONG ONE.
    // "No membership" has no plan involved; sending someone to an upgrade page
    // over it is a refusal that does not explain itself.
    expect(res.status).not.toBe(402)
    expect(withTenant).not.toHaveBeenCalled()
  })

  it('scopes to the tenant resolved from the SESSION user', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1', name: 'Dana' } })
    resolveTenantsForUser.mockResolvedValue([{ tenantId: 't-acme', role: 'TENANT_ADMIN' }])
    captureQuery()

    const res = await callRoute()
    expect(res.status).toBe(200)
    expect(resolveTenantsForUser).toHaveBeenCalledWith('u1')
    expect(withTenant).toHaveBeenCalledTimes(1)
    expect(withTenant.mock.calls[0][0]).toBe('t-acme')
  })

  it('🛑 IGNORES a tenant supplied by the caller', async () => {
    // The IDOR this architecture is most exposed to. RLS is faithful: it scopes
    // to whatever `app.tenant_id` is set to, so a tenant id accepted off the
    // wire is not caught by any policy — it is honoured. The only defence is
    // that the route never reads one.
    getServerSession.mockResolvedValue({ user: { id: 'u1', name: 'Dana' } })
    resolveTenantsForUser.mockResolvedValue([{ tenantId: 't-acme', role: 'TENANT_ADMIN' }])
    captureQuery()

    await callRoute('http://localhost/api/commissioner-os/sync-health?tenantId=t-victim')

    expect(withTenant.mock.calls[0][0]).toBe('t-acme')
    expect(withTenant.mock.calls[0][0]).not.toBe('t-victim')
  })

  it('🛑 sends NO tenant filter in the query — RLS is the control', async () => {
    // An app-level `where: { tenantId }` here would be a second copy of the rule.
    // It would look like defence in depth and behave like a single point of
    // failure: the day the two disagree the app-level filter wins silently, and
    // a policy that is never the thing actually filtering is a policy nobody
    // notices breaking. CLAUDE.md §2 — "a convenience layer, not the control".
    getServerSession.mockResolvedValue({ user: { id: 'u1', name: 'Dana' } })
    resolveTenantsForUser.mockResolvedValue([{ tenantId: 't-acme', role: 'TENANT_ADMIN' }])
    const findMany = captureQuery()

    await callRoute()

    expect(findMany).toHaveBeenCalledTimes(1)
    const query = JSON.stringify(findMany.mock.calls[0][0] ?? {})
    expect(query).not.toMatch(/tenantId/i)
    expect(query).not.toMatch(/where/i)
  })

  it('derives status rather than echoing the stored column', async () => {
    // T-204's whole point, visible at the API. The row says OK; it last synced
    // a year ago; the response must say DEGRADED. A route that returned
    // `binding.status` verbatim would pass every other test in this file.
    getServerSession.mockResolvedValue({ user: { id: 'u1', name: 'Dana' } })
    resolveTenantsForUser.mockResolvedValue([{ tenantId: 't-acme', role: 'TENANT_ADMIN' }])
    captureQuery([
      {
        id: 'b1',
        provider: 'sleeper',
        status: 'OK',
        consecutiveFailures: 0,
        lastSyncedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        lastErrorAt: null,
        lastErrorSummary: null,
      },
    ])

    const res = await callRoute()
    const body = await res.json()

    expect(body.bindings).toHaveLength(1)
    expect(body.bindings[0].status).toBe('DEGRADED')
    expect(body.bindings[0].degraded).toBe(true)
    expect(body.degraded).toBe(1)
    expect(body.tenantId).toBe('t-acme')
  })
})
