import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { resolveTenantBrand } from '@/lib/white-label'
import ManagerHubPageClient from './ManagerHubPageClient'

const BRAND = resolveTenantBrand()

export const metadata: Metadata = {
  title: `${BRAND.copy.managerHubLabel} | ${BRAND.copy.productName}`,
  description:
    'What needs your attention today, across every team you play in — before you drill into any one league.',
}

export const dynamic = 'force-dynamic'

/**
 * Fantasy OS Suite — Phase OS-C1: Manager Operating System Foundation.
 *
 * The manager-facing mirror of `/commissioner-hub`. Deliberately a NEW, standalone route rather than
 * an addition to the existing `/dashboard` page — `/dashboard`'s own `DashboardShell` is a large,
 * already-live surface this phase did not audit, and Commissioner OS itself got its own dedicated
 * route (`/commissioner-hub`) rather than being folded into an existing page. Every league the user
 * belongs to (commissioner, member, or imported) is in scope — unlike `/commissioner-hub`, there is
 * no `isCommissioner` filter here.
 */
export default async function ManagerHubPage() {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null
  const userId = typeof session?.user?.id === 'string' ? session.user.id.trim() : ''
  const isAuthenticated = userId.length > 0

  const payload = isAuthenticated ? await getDashboardLeagueListForUser(userId).catch(() => null) : null
  const leagues = ((payload?.leagues ?? []) as { id: string; name: string }[]).filter(
    (l) => typeof l?.id === 'string' && typeof l?.name === 'string',
  )

  return <ManagerHubPageClient leagues={leagues} isAuthenticated={isAuthenticated} />
}
