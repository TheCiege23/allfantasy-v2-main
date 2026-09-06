import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { CommissionerOSProviders } from '@/components/commissioner-os/providers/CommissionerOSProviders'
import { CommissionerSidebar } from '@/components/commissioner-os/shell/CommissionerSidebar'
import { CommissionerHeader } from '@/components/commissioner-os/shell/CommissionerHeader'
import { CommissionerBreadcrumbs } from '@/components/commissioner-os/shell/CommissionerBreadcrumbs'
import { CommissionerSearchPalette } from '@/components/commissioner-os/search/CommissionerSearchPalette'
import { NotificationPanel } from '@/components/commissioner-os/notifications/NotificationPanel'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

export const metadata: Metadata = {
  title: 'Commissioner OS | AllFantasy',
}

/**
 * The shared Commissioner OS application shell. Nests inside the existing
 * root layout (app/layout.tsx) — inherits AppProviders (Theme/Language/
 * Session), SafeGlobalChrome (toaster, mode toggle, service worker), Meta
 * Pixel/GA, and session preload for free. Nothing here duplicates any of
 * that; this layout only adds Commissioner-OS-specific shell chrome
 * (sidebar, header, breadcrumb slot) around whichever module route is active.
 *
 * Global Search's index and Notification Center's list/summary are all
 * fetched once here (through the adapter, same as every module page)
 * rather than per-page, because both are platform services available
 * from anywhere in Commissioner OS, not a single route's data — Next.js
 * keeps this layout mounted across navigations between sibling module
 * pages, so the fetch genuinely happens once per session, not once per
 * page.
 *
 * `errorMessage` is passed to both overlays (added in the Phase 2
 * production-hardening audit) — before this, an empty index/notification
 * list from a real fetch failure (e.g. live mode) and a genuinely empty
 * result were indistinguishable, both silently degrading to the same
 * empty state. Every other module already shows the honest `ErrorState`
 * in that situation; these two platform services now match.
 */
export default async function CommissionerOSLayout({ children }: { children: React.ReactNode }) {
  /*
   * ⚠ THIS WHOLE SHELL WAS UNGATED. No auth check, no session check, no
   * commissioner check anywhere in this route tree — anyone with the URL
   * could load it. `demo` mode (the current default everywhere in
   * production, per the adapter) shows fabricated data, so nothing real
   * has leaked through this yet, but an unauthenticated visitor should
   * never reach an internal-looking commissioner tool at all, demo mode or
   * not. Narrowing further to "commissioner of at least one league" is a
   * deliberate follow-up, not done here: this app already computes
   * "isCommissioner" four+ different, disagreeing ways across the
   * codebase, and picking one for this gate needs its own decision rather
   * than adding a fifth inconsistent definition.
   */
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    redirect('/login')
  }

  const adapter = await getDecisionOSAdapter()
  const [indexResponse, notificationsResponse, notificationsSummaryResponse] = await Promise.all([
    adapter.search.getIndex(),
    adapter.notifications.getNotifications(),
    adapter.notifications.getSummary(),
  ])

  return (
    <CommissionerOSProviders>
      <CommissionerSearchPalette
        index={indexResponse.data ?? []}
        errorMessage={indexResponse.data ? null : indexResponse.error?.message}
      />
      <NotificationPanel
        notifications={notificationsResponse.data ?? []}
        errorMessage={notificationsResponse.data ? null : notificationsResponse.error?.message}
      />
      <div className="flex min-h-screen" style={{ background: 'var(--bg)' }}>
        <CommissionerSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <CommissionerHeader unreadNotificationCount={notificationsSummaryResponse.data?.unreadCount ?? 0} />
          <main className="flex-1">
            <div className="px-4 pt-2 sm:px-6 lg:px-8">
              <CommissionerBreadcrumbs />
            </div>
            {children}
          </main>
        </div>
      </div>
    </CommissionerOSProviders>
  )
}
