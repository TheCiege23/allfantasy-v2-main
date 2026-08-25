import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { resolvesToLeagueRecord } from '@/lib/dashboard/league-card-fetch-policy'
import type { UserLeague } from '@/app/dashboard/types'
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
  /*
   * The ids handed to the client become Manager OS league-scoped calls, all keyed on `leagues`.
   * `resolvesToLeagueRecord` drops AF Legacy rows and tournament hubs — the latter set
   * `hasUnifiedRecord: true` but carry a `LegacyTournament` id, so filtering on that flag alone
   * would still let them through.
   */
  const leagues = ((payload?.leagues ?? []) as UserLeague[])
    .filter((l) => typeof l?.id === 'string' && typeof l?.name === 'string' && resolvesToLeagueRecord(l))
    .map((l) => ({ id: l.id, name: l.name }))

  return <ManagerHubPageClient leagues={leagues} isAuthenticated={isAuthenticated} />
}
