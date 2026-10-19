/**
 * Page-level route-guard tests for app/fantasy-os/page.tsx.
 *
 * These verify the PAGE BOUNDARY (not just the resolver in isolation): the real
 * `canAccessFantasyOS` runs inside the page against mocked auth/entitlement deps, and we assert
 * whether the page renders the gateway or calls `redirect('/core')`. Access flows only from the
 * server session — the page takes no searchParams, so query strings / direct navigation cannot bypass.
 *
 * History, because this suite was red from the day it was written until 2026-10-19 and sat in
 * scripts/vitest-failure-baseline.json the whole time, so CI excused it:
 *   - e65403c74 (2026-07-11) wrote it against a page that had NO guard — every redirect case failed
 *     and every "reaches the gateway" case passed vacuously.
 *   - 8ea199e10 (2026-09-05) added the guard, deliberately only for AUTHENTICATED viewers: a signed-out
 *     visitor gets the gateway's own signed-out branch (`/login?callbackUrl=/fantasy-os`).
 *   - c1cb860e9 (2026-09-18) moved the denial target from the retired /dashboard to /core.
 * The positive cases now also assert the guard was CONSULTED, so they fail if the guard is removed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  getServerSessionMock,
  redirectMock,
  resolveSnapshotMock,
  isAdminRoleMock,
  isAdminEmailMock,
  isDevAdminMock,
  FantasyOsGatewayStub,
  getDashboardLeagueListMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    // Next's redirect() throws to halt rendering — mirror that so denied paths short-circuit.
    throw new Error(`REDIRECT:${url}`)
  }),
  resolveSnapshotMock: vi.fn(),
  isAdminRoleMock: vi.fn(() => false),
  isAdminEmailMock: vi.fn(() => false),
  isDevAdminMock: vi.fn(() => false),
  FantasyOsGatewayStub: (props: unknown) => ({ __gateway: true, props }),
  getDashboardLeagueListMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('@/lib/adminAuth', () => ({
  isAdminRole: isAdminRoleMock,
  isAdminEmailAllowed: isAdminEmailMock,
}))
vi.mock('@/lib/dev-admin/access', () => ({ isDevAdminUserId: isDevAdminMock }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveSnapshot = resolveSnapshotMock
  },
}))
// Keep bundle expansion deterministic (identity) so plan checks are exact.
vi.mock('@/lib/subscription/feature-access', () => ({
  expandPlansWithBundle: (plans: string[]) => plans,
}))
vi.mock('@/lib/dashboard/get-dashboard-league-list', () => ({
  getDashboardLeagueListForUser: getDashboardLeagueListMock,
  // `/api/shared/activity` reads this one; the module gained it and the mock did not,
  // so the suite died on a missing export rather than on anything it means to assert.
  getActivityLeaguesForUser: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/white-label', () => ({
  resolveTenantBrand: () => ({ copy: { productName: 'AllFantasy' } }),
}))
vi.mock('@/app/fantasy-os/FantasyOsGateway', () => ({ default: FantasyOsGatewayStub }))

// Imported AFTER mocks are registered (vi.mock is hoisted, so this is safe).
import FantasyOsPage from '@/app/fantasy-os/page'

const session = (over: Record<string, unknown>) => ({ user: { id: 'u1', email: 'u@x.com', role: null, ...over } })

async function expectRedirect() {
  await expect(FantasyOsPage()).rejects.toThrow('REDIRECT:/core')
  expect(redirectMock).toHaveBeenCalledWith('/core')
  expect(getDashboardLeagueListMock).not.toHaveBeenCalled()
}

async function expectGateway() {
  const el = (await FantasyOsPage()) as { type: unknown; props: { isAuthenticated: boolean } }
  expect(redirectMock).not.toHaveBeenCalled()
  expect(el?.type).toBe(FantasyOsGatewayStub)
  return el
}

beforeEach(() => {
  vi.clearAllMocks()
  isAdminRoleMock.mockReturnValue(false)
  isAdminEmailMock.mockReturnValue(false)
  isDevAdminMock.mockReturnValue(false)
  getDashboardLeagueListMock.mockResolvedValue({ leagues: [] })
})

describe('/fantasy-os route guard (page boundary)', () => {
  it('unauthenticated visitor gets the signed-out gateway (sign-in funnel), not a redirect', async () => {
    // Intended since 8ea199e10: bouncing a signed-out visitor would drop /login?callbackUrl=/fantasy-os.
    // The signed-out gateway carries no entitlement-gated data and no league data.
    getServerSessionMock.mockResolvedValue(null)
    const el = await expectGateway()
    expect(el.props.isAuthenticated).toBe(false)
    expect(resolveSnapshotMock).not.toHaveBeenCalled()
    expect(getDashboardLeagueListMock).not.toHaveBeenCalled()
  })

  it('owner (allowed admin email) reaches the gateway without a DB read', async () => {
    getServerSessionMock.mockResolvedValue(session({ email: 'owner@allfantasy.ai' }))
    isAdminEmailMock.mockReturnValue(true)
    await expectGateway()
    expect(isAdminEmailMock).toHaveBeenCalledWith('owner@allfantasy.ai')
    expect(resolveSnapshotMock).not.toHaveBeenCalled()
  })

  it('platform admin (session role) reaches the gateway without a DB read', async () => {
    getServerSessionMock.mockResolvedValue(session({ role: 'admin' }))
    isAdminRoleMock.mockReturnValue(true)
    await expectGateway()
    expect(isAdminRoleMock).toHaveBeenCalledWith('admin')
    expect(resolveSnapshotMock).not.toHaveBeenCalled()
  })

  it('dev-admin user id reaches the gateway without a DB read', async () => {
    getServerSessionMock.mockResolvedValue(session({}))
    isDevAdminMock.mockReturnValue(true)
    await expectGateway()
    expect(isDevAdminMock).toHaveBeenCalledWith('u1')
    expect(resolveSnapshotMock).not.toHaveBeenCalled()
  })

  it('active enterprise entitlement reaches the gateway', async () => {
    getServerSessionMock.mockResolvedValue(session({}))
    resolveSnapshotMock.mockResolvedValue({ status: 'active', plans: ['enterprise'] })
    await expectGateway()
    expect(resolveSnapshotMock).toHaveBeenCalledWith('u1', 'u@x.com')
  })

  it('grace-period enterprise entitlement reaches the gateway', async () => {
    getServerSessionMock.mockResolvedValue(session({}))
    resolveSnapshotMock.mockResolvedValue({ status: 'grace', plans: ['enterprise'] })
    await expectGateway()
    expect(resolveSnapshotMock).toHaveBeenCalledWith('u1', 'u@x.com')
  })

  it('ordinary authenticated user (no enterprise plan) is redirected', async () => {
    getServerSessionMock.mockResolvedValue(session({}))
    resolveSnapshotMock.mockResolvedValue({ status: 'active', plans: ['supreme'] })
    await expectRedirect()
  })

  it('expired/canceled enterprise subscription is redirected', async () => {
    getServerSessionMock.mockResolvedValue(session({}))
    resolveSnapshotMock.mockResolvedValue({ status: 'canceled', plans: ['enterprise'] })
    await expectRedirect()
  })

  it('resolver failure fails closed (redirect)', async () => {
    getServerSessionMock.mockResolvedValue(session({}))
    resolveSnapshotMock.mockRejectedValue(new Error('db down'))
    await expectRedirect()
  })

  it('query strings / direct navigation cannot bypass — the guard reads only the session', async () => {
    // The page takes no searchParams; an ordinary user stays denied no matter what the URL carries.
    getServerSessionMock.mockResolvedValue(session({}))
    resolveSnapshotMock.mockResolvedValue({ status: 'active', plans: ['pro'] })
    await expectRedirect()
  })
})
