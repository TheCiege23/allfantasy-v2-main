import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { resolvesToLeagueRecord } from '@/lib/dashboard/league-card-fetch-policy'
import { getCommissionerHubHealthForUser } from '@/lib/commissioner-hub/commissionerHubHealth'
import type { UserLeague } from '@/app/dashboard/types'
import { resolveTenantBrand } from '@/lib/white-label'
import CommissionerHubPageClient from './CommissionerHubPageClient'

const BRAND = resolveTenantBrand()

export const metadata: Metadata = {
  title: `${BRAND.copy.commissionerHubLabel} | ${BRAND.copy.productName}`,
  description:
    'Run better leagues. Draft smarter. Build your fantasy legacy. Every tool a commissioner needs to create, manage, and grow their leagues — in one place.',
}

export const dynamic = 'force-dynamic'

export default async function CommissionerHubPage() {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null
  const userId = typeof session?.user?.id === 'string' ? session.user.id.trim() : ''
  const isAuthenticated = userId.length > 0

  // getDashboardLeagueListForUser returns { leagues, sleeperUserId } — extract the array
  const payload = isAuthenticated ? await getDashboardLeagueListForUser(userId).catch(() => null) : null
  /*
   * ⚠ TOURNAMENT HUBS ARE HARDCODED `isCommissioner: true` AND CARRY A `LegacyTournament` id.
   * `getCommissionerHubHealthForUser` filters on `isCommissioner`, then builds a
   * `dashboard-fallback` health snapshot for every id it was handed — so each tournament rendered
   * a health tile for a league the query behind it can never find. That is the "green tile for a
   * league we know nothing about" failure, not a missing-data one.
   */
  const leagues = ((payload?.leagues ?? []) as UserLeague[]).filter((l) => resolvesToLeagueRecord(l))
  const healthSnapshots =
    isAuthenticated && leagues.length > 0
      ? await getCommissionerHubHealthForUser(userId, leagues).catch(() => [])
      : []

  return (
    <CommissionerHubPageClient
      leagues={leagues}
      healthSnapshots={healthSnapshots}
      demoMode={!isAuthenticated || leagues.length === 0}
      isAuthenticated={isAuthenticated}
    />
  )
}
