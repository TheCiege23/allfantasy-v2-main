import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { CommissionerOSProviders } from '@/components/commissioner-os/providers/CommissionerOSProviders'
import { CommissionerAccessNotice } from '@/components/commissioner-os/shell/CommissionerAccessNotice'
import { CommissionerSidebar } from '@/components/commissioner-os/shell/CommissionerSidebar'
import { CommissionerHeader } from '@/components/commissioner-os/shell/CommissionerHeader'
import { CommissionerBreadcrumbs } from '@/components/commissioner-os/shell/CommissionerBreadcrumbs'
import { CommissionerSearchPalette } from '@/components/commissioner-os/search/CommissionerSearchPalette'
import { NotificationPanel } from '@/components/commissioner-os/notifications/NotificationPanel'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'
import { listActiveLeaguesForUser, resolveActiveLeagueId } from '@/lib/commissioner-ui/resolveActiveLeagueId'

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
   * ⚠ THIS SHELL WAS SIGNED-IN-ONLY, WHICH IS NOT THE SAME AS GATED. The session check below
   * arrived first and closed the anonymous hole; the follow-up it named — narrowing to
   * "commissioner of at least one league" — is done here.
   *
   * That follow-up was deferred because the app computes "isCommissioner" four-plus disagreeing
   * ways and picking one needed a decision. The decision: reuse `League.userId`, the definition
   * `lib/commissioner/permissions.ts` exports and the 64 `/api/commissioner/*` routes already use
   * at 69 call sites. Reusing the majority authority beats introducing a fifth, even if a
   * different definition might be nicer in isolation.
   *
   * The check is a SIDE EFFECT OF RESOLUTION, not a second rule: `listActiveLeaguesForUser` now
   * returns the leagues this user commissions, so "no leagues" IS "not a commissioner" and the two
   * can never disagree. A separate boolean gate beside a separate resolver is exactly how those
   * four definitions accumulated.
   */
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    redirect('/login')
  }

  /*
   * Resolved BEFORE the adapter is built, so a non-commissioner triggers no intelligence fetch at
   * all — not a search index, not a notification list. Gating the render while still running the
   * queries would close the display and leave the data access open.
   */
  const leagues = await listActiveLeaguesForUser()
  if (leagues.length === 0) {
    return <CommissionerAccessNotice />
  }

  const adapter = await getDecisionOSAdapter()
  const [indexResponse, notificationsResponse, notificationsSummaryResponse, activeLeagueId] =
    await Promise.all([
      adapter.search.getIndex(),
      adapter.notifications.getNotifications(),
      adapter.notifications.getSummary(),
      resolveActiveLeagueId(),
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
          <CommissionerHeader
            unreadNotificationCount={notificationsSummaryResponse.data?.unreadCount ?? 0}
            leagues={leagues}
            activeLeagueId={activeLeagueId}
          />
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
