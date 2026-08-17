import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import nextDynamic from 'next/dynamic'
import { recordDashboardActivation } from '@/lib/analytics/recordDashboardActivation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveDashboardAvatarUrl } from '@/lib/dashboard/resolve-dashboard-avatar'
import { resolveDisplayName } from '@/lib/dashboard/resolve-display-name'
import DashboardUnavailableState from '@/components/dashboard/DashboardUnavailableState'
import {
  createDashboardRuntimeIssue,
  getDashboardMissingEnvVars,
  getDashboardRuntimeIssue,
} from '@/lib/dashboard/runtime-issues'
import { isAppRouterRedirectError } from '@/lib/next/is-app-router-redirect-error'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { fetchUserRankJsonForDashboardSSR } from '@/lib/dashboard/fetch-user-rank-ssr'
import { getCommissionerHubHealthForUser } from '@/lib/commissioner-hub/commissionerHubHealth'
import type { UserLeague } from './types'

export const dynamic = 'force-dynamic'

/**
 * Production cut-over — `/dashboard` now renders the Nocturne dashboard (previously
 * `DashboardShell`). Every SSR loader below is unchanged, so the data contract, auth
 * gate, and DashboardUnavailableState error boundaries stay exactly as they were;
 * only the presentation layer swaps.
 *
 * Client-only (`ssr: false`) mirrors the preview route: SSR-bundling next/image on
 * Windows Next 14.2 can corrupt the dev manifests.
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

export default async function DashboardPage() {
  const missingEnvVars = getDashboardMissingEnvVars()
  if (missingEnvVars.length > 0) {
    const issue = createDashboardRuntimeIssue(missingEnvVars)
    return (
      <DashboardUnavailableState
        title={issue.title}
        message={issue.message}
        missing={issue.missing}
      />
    )
  }

  let session: {
    user?: {
      id?: string
      name?: string | null
      email?: string | null
      image?: string | null
      role?: string | null
    }
  } | null
  try {
    session = (await getServerSession(authOptions as never)) as typeof session
  } catch (error) {
    console.error('[dashboard] getServerSession failed:', error)
    return (
      <DashboardUnavailableState
        title="Dashboard temporarily unavailable"
        message="We couldn't verify your session. Please sign in again or try again in a moment."
      />
    )
  }

  const sessionUser = session?.user
  const rawUserId = typeof sessionUser?.id === 'string' ? sessionUser.id.trim() : ''
  if (!sessionUser || !rawUserId) {
    redirect('/login?callbackUrl=/dashboard')
  }
  const userId = rawUserId

  try {
    const [dbUser, userProfile, initialLeagueList, initialUserRankPayload] = await Promise.all([
      prisma.appUser
        .findUnique({
          where: { id: userId },
          select: { avatarUrl: true, emailVerified: true, username: true },
        })
        .catch((err: unknown) => {
          console.error('[dashboard] appUser lookup failed:', err)
          return null
        }),
      prisma.userProfile
        .findUnique({
          where: { userId },
          select: { discordUserId: true, displayName: true },
        })
        .catch((err: unknown) => {
          console.error('[dashboard] userProfile lookup failed:', err)
          return null
        }),
      getDashboardLeagueListForUser(userId).catch((err: unknown) => {
        console.error('[dashboard] league list prefetch failed:', err)
        return null
      }),
      fetchUserRankJsonForDashboardSSR().catch((err: unknown) => {
        console.error('[dashboard] user rank prefetch failed:', err)
        return null
      }),
    ])

    const userImage = resolveDashboardAvatarUrl(sessionUser.image, dbUser?.avatarUrl ?? undefined)
    const userName = resolveDisplayName({
      displayName: userProfile?.displayName,
      username: dbUser?.username,
      sessionName: sessionUser.name,
      email: sessionUser.email,
    })

    // Dashboard V2 Phase 2.3 — Commissioner HQ reuses the same health/recommendations/actions
    // engine as the real /commissioner-hub page (getCommissionerHubHealthForUser), rather than
    // a new query, so this is a snapshot-per-commissioned-league sourced identically to the
    // deep-dive destination it links out to.
    const initialCommissionerHealthSnapshots = initialLeagueList
      ? await getCommissionerHubHealthForUser(
          userId,
          initialLeagueList.leagues as unknown as UserLeague[],
        ).catch((err: unknown) => {
          console.error('[dashboard] commissioner health prefetch failed:', err)
          return null
        })
      : null

    // First meaningful activation. Emitted HERE — on the success path, after the server has
    // resolved real league context — so a loading, permission, error, or
    // DashboardUnavailableState render can never count. `initialLeagueList` is null when the
    // prefetch failed, which is "unknown", not "zero leagues"; both are declined inside.
    // Idempotent per user, so /dashboard, /dashboard/v2, and repeat visits cannot
    // double-count. Not awaited and never throws — analytics must not break the dashboard.
    void recordDashboardActivation({
      userId,
      leagueCount: initialLeagueList ? initialLeagueList.leagues.length : null,
      getCookie: (name) => cookies().get(name)?.value,
    })

    return (
      <NocturneDashboard
        userId={userId}
        userName={userName}
        userImage={userImage}
        emailVerified={Boolean(dbUser?.emailVerified)}
        discordConnected={Boolean(userProfile?.discordUserId)}
        initialLeagueList={initialLeagueList ?? undefined}
        initialUserRankPayload={initialUserRankPayload ?? undefined}
        initialCommissionerHealthSnapshots={initialCommissionerHealthSnapshots ?? undefined}
      />
    )
  } catch (error) {
    if (isAppRouterRedirectError(error)) {
      throw error
    }

    const issue = getDashboardRuntimeIssue(error)
    if (issue) {
      return (
        <DashboardUnavailableState
          title={issue.title}
          message={issue.message}
          missing={issue.missing}
        />
      )
    }

    console.error('[dashboard] data load failed:', error)

    return (
      <DashboardUnavailableState
        title="Dashboard temporarily unavailable"
        message="We couldn't load your dashboard. Please try again in a moment."
      />
    )
  }
}
