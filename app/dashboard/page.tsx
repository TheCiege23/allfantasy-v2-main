import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { recordDashboardActivation } from '@/lib/analytics/recordDashboardActivation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import DashboardUnavailableState from '@/components/dashboard/DashboardUnavailableState'
import {
  createDashboardRuntimeIssue,
  getDashboardMissingEnvVars,
  getDashboardRuntimeIssue,
} from '@/lib/dashboard/runtime-issues'
import { isAppRouterRedirectError } from '@/lib/next/is-app-router-redirect-error'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { describeAge } from '@/lib/sports-data/freshnessPolicy'
import { aiAccessResolver } from '@/lib/ai-access/AIAccessResolver'
import DashboardV2 from '@/components/core-app/screens/DashboardV2'
import { getDash34Data, type Dash34LeagueRow } from '@/lib/core-app/dash34'
import { getCareerData } from '@/lib/core-app/career'
import { getPortfolio } from '@/lib/core-app/portfolio'
import { getDraftHqAll } from '@/lib/core-app/draftHqAll'
import { getWeekAll } from '@/lib/core-app/weekAll'
import type { UserLeague } from './types'

export const dynamic = 'force-dynamic'

/**
 * `/dashboard` — the signed-in home, now rendering Dashboard v2.
 *
 * ⚠ THE GATE, THE ERROR BOUNDARIES AND THE ACTIVATION SIGNAL ARE UNCHANGED. Only
 * the presentation swaps. `recordDashboardActivation` still fires with the same
 * arguments and the same not-awaited, never-throws contract — it is a funnel
 * signal, and a cut-over that silently stopped counting activations would be
 * invisible until someone asked why the funnel died.
 *
 * ⚠ WHY THIS IS NOT A REDIRECT TO /core/dashboard-v2. A redirect would make the
 * post-sign-in home a second hop, lose the callbackUrl contract, and leave two
 * URLs claiming to be the dashboard. The screen is a component; this route
 * renders it.
 *
 * ⚠ `playedLeagues`, NOT `leagues`. Rows with `hasUnifiedRecord: false` are AF
 * Legacy board snapshots from the career import — 543 of them on one production
 * account against ~60 real teams. Letting them through is what produced a 604-row
 * home and a 604-tile rail. Same filter the /core route applies, for the same
 * reason.
 */
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

  /*
   * Named alias rather than `as typeof session`: inside the try, `typeof session`
   * resolves against the narrowed `null` from the initialiser, which collapses the
   * cast to `never` and makes every later `session?.user` an error.
   */
  type DashboardSession = { user?: { id?: string } } | null
  let session: DashboardSession = null
  try {
    session = (await getServerSession(authOptions as never)) as DashboardSession
  } catch (error) {
    console.error('[dashboard] getServerSession failed:', error)
    return (
      <DashboardUnavailableState
        title="Dashboard temporarily unavailable"
        message="We couldn't verify your session. Please sign in again or try again in a moment."
      />
    )
  }

  const rawUserId = typeof session?.user?.id === 'string' ? session.user.id.trim() : ''
  if (!rawUserId) {
    redirect('/login?callbackUrl=/dashboard')
  }
  const userId = rawUserId

  try {
    const now = new Date()

    const leagueListPayload = await getDashboardLeagueListForUser(userId).catch(
      (err: unknown) => {
        console.error('[dashboard] league list failed:', err)
        return null
      },
    )
    const leagues = (leagueListPayload?.leagues ?? []) as unknown as UserLeague[]
    const playedLeagues = leagues.filter(
      (l) => (l as { hasUnifiedRecord?: boolean }).hasUnifiedRecord !== false,
    )

    const dash34 = await getDash34Data(
      userId,
      leagues as unknown as Dash34LeagueRow[],
      now,
    ).catch((err: unknown) => {
      console.error('[dashboard] dash34 failed:', err)
      return null
    })

    const [career, portfolio, drafts, week, access] = await Promise.all([
      getCareerData(userId).catch(() => null),
      getPortfolio(userId).catch(() => null),
      getDraftHqAll(
        userId,
        playedLeagues.map((l) => ({
          id: l.id,
          name: l.name,
          platform: String(l.platform ?? ''),
          imageUrl: (l as { avatarUrl?: string | null }).avatarUrl ?? null,
        })),
      ).catch(() => null),
      getWeekAll(
        userId,
        playedLeagues.map((l) => ({
          id: l.id,
          name: l.name,
          platform: String(l.platform ?? ''),
          platformLeagueId:
            (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
        })),
      ).catch(() => null),
      aiAccessResolver.resolveForUser({ userId, now }).catch(() => null),
    ])

    // Newest real sync across the leagues the user actually plays. Null on all 98
    // today, which the bar states outright rather than showing an invented age.
    const lastSynced = playedLeagues.reduce<Date | null>((latest, l) => {
      const raw = (l as { lastSyncedAt?: Date | string | null }).lastSyncedAt
      if (!raw) return latest
      const d = raw instanceof Date ? raw : new Date(raw)
      if (Number.isNaN(d.getTime())) return latest
      return latest == null || d > latest ? d : latest
    }, null)
    const syncAge = describeAge('roster', lastSynced, now)

    const planName = access
      ? access.hasSubscription
        ? (access.subscription.plans[0] ?? 'Premium')
        : access.trial.inTrial
          ? `Trial · ${access.trial.daysRemaining}d left`
          : 'Free'
      : null

    /*
     * Unchanged from the Nocturne cut-over, deliberately. Not awaited, never
     * throws, idempotent per user — analytics must not be able to break the
     * dashboard, and a null league list means "unknown", not "zero".
     */
    void recordDashboardActivation({
      userId,
      leagueCount: leagueListPayload ? leagueListPayload.leagues.length : null,
      getCookie: (name) => cookies().get(name)?.value,
    })

    return (
      <DashboardV2
        data={dash34}
        weekLabel={dash34?.weekLabel ?? null}
        career={career}
        portfolio={portfolio}
        drafts={drafts}
        week={week}
        nowIso={now.toISOString()}
        planName={planName}
        syncedLabel={syncAge.stale ? null : syncAge.label}
        commissionerCount={playedLeagues.filter((l) => Boolean(l.isCommissioner)).length}
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

    console.error('[dashboard] render failed:', error)
    return (
      <DashboardUnavailableState
        title="Dashboard temporarily unavailable"
        message="Something went wrong loading your leagues. Try again in a moment."
      />
    )
  }
}
