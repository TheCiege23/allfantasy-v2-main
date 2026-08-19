/**
 * Page-level route-guard tests for app/fantasy-os/page.tsx.
 *
 * These verify the PAGE BOUNDARY (not just the resolver in isolation): the real
 * `canAccessFantasyOS` runs inside the page against mocked auth/entitlement deps, and we assert
 * whether the page renders the gateway or calls `redirect('/dashboard')`. Access flows only from the
 * server session — the page takes no searchParams, so query strings / direct navigation cannot bypass.
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
  getDashboardLeagueListForUser: vi.fn().mockResolvedValue({ leagues: [] }),
}))
vi.mock('@/lib/white-label', () => ({
  resolveTenantBrand: () => ({ copy: { productName: 'AllFantasy' } }),
}))
vi.mock('@/app/fantasy-os/FantasyOsGateway', () => ({ default: FantasyOsGatewayStub }))

// Imported AFTER mocks are registered (vi.mock is hoisted, so this is safe).
import FantasyOsPage from '@/app/fantasy-os/page'

const session = (over: Record<string, unknown>) => ({ user: { id: 'u1', email: 'u@x.com', role: null, ...over } })

async function expectRedirect() {
  await expect(FantasyOsPage()).rejects.toThrow('REDIRECT:/dashboard')
  expect(redirectMock).toHaveBeenCalledWith('/dashboard')
}

async function expectGateway() {
  const el = (await FantasyOsPage()) as { type: unknown }
  expect(redirectMock).not.toHaveBeenCalled()
  expect(el?.type).toBe(FantasyOsGatewayStub)
}

beforeEach(() => {
  vi.clearAllMocks()
  isAdminRoleMock.mockReturnValue(false)
  isAdminEmailMock.mockReturnValue(false)
  isDevAdminMock.mockReturnValue(false)
})

describe('/fantasy-os route guard (page boundary)', () => {
  it('unauthenticated user is redirected to /dashboard', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expectRedirect()
    expect(resolveSnapshotMock).not.toHaveBeenCalled()
  })

  it('owner (allowed admin email) reaches the gateway without a DB read', async () => {
    getServerSessionMock.mockResolvedValue(session({ email: 'owner@allfantasy.ai' }))
    isAdminEmailMock.mockReturnValue(true)
    await expectGateway()
    expect(resolveSnapshotMock).not.toHaveBeenCalled()
  })

  it('platform admin (session role) reaches the gateway without a DB read', async () => {
    getServerSessionMock.mockResolvedValue(session({ role: 'admin' }))
    isAdminRoleMock.mockReturnValue(true)
    await expectGateway()
    expect(resolveSnapshotMock).not.toHaveBeenCalled()
  })

  it('dev-admin user id reaches the gateway without a DB read', async () => {
    getServerSessionMock.mockResolvedValue(session({}))
    isDevAdminMock.mockReturnValue(true)
    await expectGateway()
    expect(resolveSnapshotMock).not.toHaveBeenCalled()
  })

  it('active enterprise entitlement reaches the gateway', async () => {
    getServerSessionMock.mockResolvedValue(session({}))
    resolveSnapshotMock.mockResolvedValue({ status: 'active', plans: ['enterprise'] })
    await expectGateway()
  })

  it('grace-period enterprise entitlement reaches the gateway', async () => {
    getServerSessionMock.mockResolvedValue(session({}))
    resolveSnapshotMock.mockResolvedValue({ status: 'grace', plans: ['enterprise'] })
    await expectGateway()
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
