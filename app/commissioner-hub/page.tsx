import type { Metadata } from 'next'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { getCommissionerHubHealthForUser } from '@/lib/commissioner-hub/commissionerHubHealth'
import type { UserLeague } from '@/app/dashboard/types'
import { resolveTenantBrand } from '@/lib/white-label'
import { prisma } from '@/lib/prisma'
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

  /*
   * 🛑 THE TOURNAMENT HUB HAD NO FRONT DOOR. Its screens live at
   * `/tournament-hub/[id]`, which needs an id nobody has memorised, so a
   * commissioner could only reach them by typing a URL — and a built feature
   * nobody can find is not a shipped one. This is the one place a commissioner
   * of several leagues already lands.
   *
   * ⚠ SHOWN ONLY TO SOMEONE IT COULD HELP: a commissioner who runs a tournament,
   * or one with enough leagues that grouping them is a real option. Offering it
   * to a two-league commissioner is noise on the screen they came here for.
   */
  const tournamentCount =
    isAuthenticated
      ? await prisma.tournamentShell
          .count({ where: { commissionerId: userId } })
          .catch(() => 0)
      : 0
  const showTournamentEntry = tournamentCount > 0 || leagues.filter((l) => l.isCommissioner).length >= 3

  return (
    <>
      {showTournamentEntry ? (
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <p className="text-[13px] text-muted">
            {tournamentCount > 0
              ? `You run ${tournamentCount} ${tournamentCount === 1 ? 'tournament' : 'tournaments'} across several leagues.`
              : 'Run one big tournament across several of these leagues?'}
          </p>
          <Link
            href="/tournament-hub"
            className="rounded-xl border border-subtle px-3 py-2 text-[13px] font-semibold transition hover:brightness-95"
          >
            {tournamentCount > 0 ? 'Open tournament hub →' : 'Group leagues into a tournament →'}
          </Link>
        </div>
      ) : null}
      <CommissionerHubPageClient
        leagues={leagues}
        healthSnapshots={healthSnapshots}
        demoMode={!isAuthenticated || leagues.length === 0}
        isAuthenticated={isAuthenticated}
      />
    </>
  )
}
