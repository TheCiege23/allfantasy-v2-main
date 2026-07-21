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
 * Adaptive dashboard — PREVIEW route. The live `/dashboard` is untouched.
 *
 * Reuses the exact SSR loaders `/dashboard` uses (session, league list, user rank,
 * commissioner health), so the data contract and auth gate are identical and only the
 * presentation layer differs. That's what makes a later cut-over a one-file change, the
 * same way the Nocturne cut-over (#259) was.
 *
 * Client-only (`ssr: false`) mirrors both existing dashboard routes: SSR-bundling
 * next/image on Windows Next 14.2 can corrupt the dev manifests.
 *
 * ⚠ `import nextDynamic` is aliased on purpose — `next/dynamic`'s default name collides
 * with the `export const dynamic` route segment config above.
 */
const AdaptiveDashboard = nextDynamic(
  () => import('@/components/dashboard/adaptive/AdaptiveDashboard'),
  {
    ssr: false,
    loading: () => (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#110b1e', color: 'rgba(255,255,255,.5)', fontSize: 14,
      }}>
        Loading dashboard…
      </div>
    ),
  },
)

export default async function AdaptiveDashboardPage() {
  const session = (await getServerSession(authOptions as never)) as
    | { user?: { id?: string; name?: string | null; email?: string | null; image?: string | null } }
    | null

  const userId = typeof session?.user?.id === 'string' ? session.user.id.trim() : ''
  if (!userId) {
    redirect('/login?callbackUrl=/dashboard/v2')
  }

  const [dbUser, userProfile, leagueList, rankPayload] = await Promise.all([
    prisma.appUser.findUnique({
      where: { id: userId },
      select: { avatarUrl: true, username: true, emailVerified: true },
    }).catch(() => null),
    prisma.userProfile.findUnique({
      where: { userId },
      select: { displayName: true, discordUserId: true },
    }).catch(() => null),
    getDashboardLeagueListForUser(userId).catch(() => null),
    fetchUserRankJsonForDashboardSSR().catch(() => null),
  ])

  // Commissioner health reuses the same engine as /commissioner-hub — one snapshot per
  // commissioned league, so it needs the league list first. Returns [] for non-commissioners.
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
    <AdaptiveDashboard
      userId={userId}
      userName={userName}
      userImage={userImage}
      initialLeagueList={leagueList ?? undefined}
      initialUserRankPayload={rankPayload ?? undefined}
      initialCommissionerHealthSnapshots={commissionerHealth ?? undefined}
      discordConnected={Boolean(userProfile?.discordUserId)}
    />
  )
}
