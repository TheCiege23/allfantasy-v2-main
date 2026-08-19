import { redirect } from 'next/navigation'
import nextDynamic from 'next/dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveDashboardAvatarUrl } from '@/lib/dashboard/resolve-dashboard-avatar'
import { resolveDisplayName } from '@/lib/dashboard/resolve-display-name'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { fetchUserRankJsonForDashboardSSR } from '@/lib/dashboard/fetch-user-rank-ssr'
import { getCommissionerHubHealthForUser } from '@/lib/commissioner-hub/commissionerHubHealth'
import type { UserLeague } from '@/app/dashboard/types'

export const dynamic = 'force-dynamic'

/**
 * Nocturne dashboard — Phase 1 preview route. Reuses the exact SSR loaders the
 * live `/dashboard` uses (session, league list, user rank), then renders the
 * reskinned client shell. Client-only import: SSR-bundling next/image on
 * Windows Next 14.2 can corrupt `.next-dev-local` manifests (same guard as the
 * landing page). The live `/dashboard` is untouched.
 */
const NocturneDashboard = nextDynamic(
  () => import('@/components/dashboard/nocturne/NocturneDashboard'),
  {
    ssr: false,
    loading: () => (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#161826', color: '#9397ab', fontSize: 14 }}>
        Loading dashboard…
      </div>
    ),
  },
)

export default async function NocturneDashboardPage() {
  const session = (await getServerSession(authOptions as never)) as
    | { user?: { id?: string; name?: string | null; email?: string | null; image?: string | null } }
    | null

  const userId = typeof session?.user?.id === 'string' ? session.user.id.trim() : ''
  if (!userId) {
    redirect('/login?callbackUrl=/dashboard/nocturne')
  }

  const [dbUser, userProfile, leagueList, rankPayload] = await Promise.all([
    prisma.appUser.findUnique({ where: { id: userId }, select: { avatarUrl: true, username: true, emailVerified: true } }).catch(() => null),
    prisma.userProfile.findUnique({ where: { userId }, select: { displayName: true, discordUserId: true } }).catch(() => null),
    getDashboardLeagueListForUser(userId).catch(() => null),
    fetchUserRankJsonForDashboardSSR().catch(() => null),
  ])

  // Commissioner health reuses the same engine as the real /commissioner-hub —
  // a snapshot per commissioned league (needs the league list first).
  const commissionerHealth = leagueList
    ? await getCommissionerHubHealthForUser(userId, leagueList.leagues as unknown as UserLeague[]).catch(() => null)
    : null

  const userImage = resolveDashboardAvatarUrl(session?.user?.image, dbUser?.avatarUrl ?? undefined)
  const userName = resolveDisplayName({
    displayName: userProfile?.displayName,
    username: dbUser?.username,
    sessionName: session?.user?.name,
    email: session?.user?.email,
  })

  return (
    <NocturneDashboard
      userId={userId}
      userName={userName}
      userImage={userImage}
      initialLeagueList={leagueList ?? undefined}
      initialUserRankPayload={rankPayload ?? undefined}
      initialCommissionerHealthSnapshots={commissionerHealth ?? undefined}
      emailVerified={Boolean(dbUser?.emailVerified)}
      discordConnected={Boolean(userProfile?.discordUserId)}
    />
  )
}
