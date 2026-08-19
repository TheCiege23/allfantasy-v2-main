import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
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
  const leagues = (payload?.leagues ?? []) as UserLeague[]
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
