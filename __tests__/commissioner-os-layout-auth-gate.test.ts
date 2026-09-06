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

const { getServerSession, redirect, getDecisionOSAdapter } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
  getDecisionOSAdapter: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/commissioner-ui/adapter', () => ({ getDecisionOSAdapter }))

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
})
