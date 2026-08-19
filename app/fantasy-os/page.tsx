import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import type { UserLeague } from '@/app/dashboard/types'
import { resolveTenantBrand } from '@/lib/white-label'
import FantasyOsGateway from './FantasyOsGateway'

const BRAND = resolveTenantBrand()

export const metadata: Metadata = {
  title: `${BRAND.copy.productName} — Fantasy OS`,
  description:
    'One entry point into your executive Operating Systems: what needs attention, which system owns it, why it matters, and what to do.',
}

export const dynamic = 'force-dynamic'

/**
 * Fantasy OS Suite — Phase V7.3: the single customer-facing GATEWAY into the seven Operating Systems.
 *
 * Deliberately a gateway, not another dashboard — it never renders the workspaces themselves. It answers
 * "where do I click to see Fantasy OS?" by resolving the authenticated user's real portfolio and routing
 * them into Platform OS by default (with commissioner access when eligible). Auth/authorization and the
 * active white-label tenant are preserved; no provider branding appears on this executive surface.
 */
export default async function FantasyOsPage() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = typeof session?.user?.id === 'string' ? session.user.id.trim() : ''
  const isAuthenticated = userId.length > 0

  const payload = isAuthenticated ? await getDashboardLeagueListForUser(userId).catch(() => null) : null
  const leaguesRaw = (payload?.leagues ?? []) as UserLeague[]
  const leagues = leaguesRaw
    .filter((l) => typeof l?.id === 'string' && typeof l?.name === 'string')
    .map((l) => ({
      id: l.id,
      name: l.name,
      isCommissioner: Boolean(l.isCommissioner),
      role: l.userRole ?? (l.isCommissioner ? 'commissioner' : 'member'),
    }))

  return <FantasyOsGateway leagues={leagues} isAuthenticated={isAuthenticated} />
}
