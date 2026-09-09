import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 `/commissioner-os` HAD NO AUTH CHECK AT ALL.
 *
 * `app/commissioner-os/layout.tsx` fetched the search index and notifications
 * and rendered the full shell for anyone who hit the URL — no session check,
 * no commissioner check, nothing. `demo` mode (the production default
 * everywhere per the adapter) shows fabricated data, so nothing real leaked
 * through this specific gap, but an unauthenticated visitor should never
 * reach an internal-looking commissioner tool regardless of what data mode
 * is active behind it.
 *
 * This pins the minimum fix: no session → redirected to `/login` before the
 * adapter is ever called. Narrowing further to "commissioner of at least one
 * league" is a deliberate, separate follow-up (this app already computes
 * "isCommissioner" several different, disagreeing ways — picking one for
 * this gate is its own decision, not bundled into this fix).
 */

const { getServerSession, redirect, getDecisionOSAdapter, listActiveLeaguesForUser, resolveActiveLeagueId, isAdminEmailAllowed } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
  getDecisionOSAdapter: vi.fn(),
  listActiveLeaguesForUser: vi.fn(),
  resolveActiveLeagueId: vi.fn(),
  isAdminEmailAllowed: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/commissioner-ui/adapter', () => ({ getDecisionOSAdapter }))
/*
 * ⚠ MOCKED BECAUSE THE LAYOUT CHANGED DEPENDENCY, NOT BECAUSE THESE TESTS CARE ABOUT LEAGUES.
 * The gate was narrowed from "signed in" to "commissions at least one league", so the layout now
 * resolves leagues BEFORE building the adapter and returns an access notice when there are none.
 * Unmocked, that call reaches Prisma, returns nothing, and the authenticated test's early return
 * means the adapter is never built — the exact assertion below, failing for a reason that has
 * nothing to do with auth.
 */
vi.mock('@/lib/commissioner-ui/resolveActiveLeagueId', () => ({ listActiveLeaguesForUser, resolveActiveLeagueId }))
vi.mock('@/lib/adminAuth', () => ({ isAdminEmailAllowed }))

// The shell components aren't under test here — stub them so the
// authenticated path can render without pulling in the real component tree.
vi.mock('@/components/commissioner-os/providers/CommissionerOSProviders', () => ({
  CommissionerOSProviders: ({ children }: { children: unknown }) => children,
}))
vi.mock('@/components/commissioner-os/shell/CommissionerSidebar', () => ({ CommissionerSidebar: () => null }))
vi.mock('@/components/commissioner-os/shell/CommissionerHeader', () => ({ CommissionerHeader: () => null }))
vi.mock('@/components/commissioner-os/shell/CommissionerBreadcrumbs', () => ({ CommissionerBreadcrumbs: () => null }))
vi.mock('@/components/commissioner-os/search/CommissionerSearchPalette', () => ({ CommissionerSearchPalette: () => null }))
vi.mock('@/components/commissioner-os/notifications/NotificationPanel', () => ({ NotificationPanel: () => null }))

import CommissionerOSLayout from '@/app/commissioner-os/layout'

beforeEach(() => {
  vi.clearAllMocks()
  listActiveLeaguesForUser.mockResolvedValue([{ id: 'lg-1', name: 'A League' }])
  resolveActiveLeagueId.mockResolvedValue('lg-1')
  isAdminEmailAllowed.mockReturnValue(false)
  getDecisionOSAdapter.mockResolvedValue({
    search: { getIndex: vi.fn().mockResolvedValue({ data: [] }) },
    notifications: {
      getNotifications: vi.fn().mockResolvedValue({ data: [] }),
      getSummary: vi.fn().mockResolvedValue({ data: { unreadCount: 0 } }),
    },
  })
})

describe('CommissionerOSLayout — auth gate', () => {
  it('redirects to /login when there is no session, before the adapter is ever touched', async () => {
    getServerSession.mockResolvedValueOnce(null)

    await expect(CommissionerOSLayout({ children: null })).rejects.toThrow('REDIRECT:/login')
    expect(getDecisionOSAdapter).not.toHaveBeenCalled()
  })

  it('redirects when the session has no user id', async () => {
    getServerSession.mockResolvedValueOnce({ user: {} })

    await expect(CommissionerOSLayout({ children: null })).rejects.toThrow('REDIRECT:/login')
    expect(getDecisionOSAdapter).not.toHaveBeenCalled()
  })

  it('renders through to the adapter for an authenticated session', async () => {
    getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })

    await expect(CommissionerOSLayout({ children: null })).resolves.toBeTruthy()
    expect(getDecisionOSAdapter).toHaveBeenCalledTimes(1)
  })

  it('shows the access notice, and fetches no intelligence, for a signed-in non-commissioner', async () => {
    getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })
    listActiveLeaguesForUser.mockResolvedValueOnce([])

    await expect(CommissionerOSLayout({ children: null })).resolves.toBeTruthy()
    // Gating the display while still running the queries would close the window and leave the
    // door open — the resolution happens first precisely so neither runs.
    expect(getDecisionOSAdapter).not.toHaveBeenCalled()
  })
})

/*
 * Who may switch data source. The mode selector was dev-only and returned null in production,
 * which is why nothing could ever reach live data there; it is now gated by audience instead of
 * by build, and this is where that audience is decided.
 */
describe('CommissionerOSLayout — data mode selection', () => {
  async function renderAndReadModes() {
    getServerSession.mockResolvedValueOnce({ user: { id: 'user-1', email: 'someone@example.com' } })
    const tree = (await CommissionerOSLayout({ children: null })) as unknown as {
      props: { children: { props: { children: unknown[] } }[] }
    }
    // The header is the only consumer; find it by the prop rather than by position, so a layout
    // reshuffle fails loudly here instead of silently reading undefined.
    const found: unknown[] = []
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      const el = node as { props?: Record<string, unknown> }
      if (el.props && 'availableDataModes' in el.props) found.push(el.props.availableDataModes)
      if (el.props) Object.values(el.props).forEach((v) => (Array.isArray(v) ? v.forEach(walk) : walk(v)))
    }
    walk(tree)
    return found[0] as string[] | undefined
  }

  it('offers an ordinary commissioner no choice at all', async () => {
    isAdminEmailAllowed.mockReturnValue(false)
    expect(await renderAndReadModes()).toEqual([])
  })

  it('offers an admin the modes, and never stub in production', async () => {
    isAdminEmailAllowed.mockReturnValue(true)
    const modes = await renderAndReadModes()
    expect(modes).toContain('demo')
    expect(modes).toContain('live')
    // At least two, or the picker renders nothing and the admin has no choice either.
    expect(modes?.length ?? 0).toBeGreaterThanOrEqual(2)
    // NODE_ENV is 'test' here, so stub is offered; the production refusal is enforced in
    // normalizeDataMode and asserted in commissioner-os-demo-mode.test.ts.
  })
})
