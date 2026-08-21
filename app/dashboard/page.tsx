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
import Dashboard3A from '@/components/core-app/screens/Dashboard3A'
import { getCrossLeagueExposure, getRivalRecords } from '@/lib/core-app/dash3aPanels'
import { getMatchupData } from '@/lib/core-app/matchup'
import LeagueHome from '@/components/core-app/screens/LeagueHome'
import { getLeagueHomeData } from '@/lib/core-app/leagueHome'
import { deriveOutstandingIssues, lastSyncByLeagueFrom } from '@/lib/core-app/outstandingIssues'
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
/**
 * ⚠ `?league=` IS THE LEAGUE-SCOPED STATE OF THIS SCREEN, NOT A SECOND ROUTE.
 * The 3b handoff offers `/dashboard?league=:id` or `/league/:id`; the query
 * parameter is the one that costs nothing, and this repo is at Vercel's 2048
 * route ceiling.
 *
 * ⚠ THIS RECONNECTS A SCREEN THE CUTOVER ORPHANED. LeagueHome and its loader
 * already existed and were reached through DashboardShell — the Nocturne shell
 * that /dashboard stopped rendering when it moved to DashboardV2. So selecting a
 * league left the dashboard entirely while a working implementation sat
 * unreferenced. It is now the same route in a different state.
 */
type DashboardSearchParams = { [key: string]: string | string[] | undefined }

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: DashboardSearchParams
}) {
  const rawLeague = searchParams?.league
  const selectedLeagueId = typeof rawLeague === 'string' && rawLeague.trim() ? rawLeague.trim() : null
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

    /*
     * The league view replaces the all-leagues body, deliberately. Season
     * timeline, Draft HQ and Commissioner Hub exist ONLY in this state — there
     * is no single season calendar across 60 leagues, which is the rule the 3b
     * handoff opens with and the reason the timeline was pulled off 3a.
     *
     * A league id that does not resolve (deleted, or not yours) falls through to
     * the all-leagues dashboard rather than erroring: the loader returns null
     * for both cases, and a dead link should land somewhere useful.
     */
    /*
     * Derived ONCE, for both branches. 3a's whole top section is this list, and
     * 3b needs the same derivation to split its own league's issues from the
     * count of everything outside it. Running it twice would let the two screens
     * disagree about how many issues exist.
     */
    /*
     * ⚠ `lastSyncByLeague` IS NOT OPTIONAL IN PRACTICE. Omitting it defaults every
     * league to a null timestamp, and `describeAge` reads null as "never synced,
     * stale" — so the detector fired on all 63 played leagues and the queue's only
     * row read "63 leagues have never been read" while the topbar chip three
     * inches above it, built from `lastSynced` below and the same rows, read
     * "34m ago". 54 of the 63 had been read. Same rows, same request, two answers.
     */
    const { issues: issuesAll } = deriveOutstandingIssues({
      leagues: playedLeagues,
      lastSyncByLeague: lastSyncByLeagueFrom(
        playedLeagues as unknown as Array<{ id: string; lastSyncedAt?: Date | string | null }>,
      ),
      now,
    })

    if (selectedLeagueId) {
      const leagueHome = await getLeagueHomeData(selectedLeagueId, userId).catch(() => null)
      if (leagueHome) {
        /*
         * ⚠ THIS COUNTED LEAGUES, NOT ISSUES, UNDER A PROP CALLED
         * `otherLeagueIssueCount` — so a user with 60 imported leagues and
         * nothing wrong anywhere read "59 more issues live outside this league".
         * `deriveOutstandingIssues` is the same derivation /core already runs,
         * and it also supplies this league's own issues so 3b can render its one
         * urgent action instead of leaving the row empty.
         */
        const allIssues = issuesAll
        const thisLeagueIssues = allIssues.filter((i) => i.leagueId === leagueHome.league.id)
        const otherIssues = allIssues.filter((i) => i.leagueId !== leagueHome.league.id).length
        return (
          <div className="af-core af-lh-shell">
            <LeagueHome
              data={leagueHome}
              otherLeagueIssueCount={otherIssues}
              issues={thisLeagueIssues}
            />
          </div>
        )
      }
    }

    /*
     * The three panels 3a first shipped as "no engine exists". Each is real; see
     * lib/core-app/dash3aPanels.ts for why that claim was wrong.
     *
     * Bounded deliberately. Exposure and rivals read every played league, but the
     * win probability is resolved ONLY for the leagues whose cards are actually
     * rendered — getMatchupData runs several queries per league, and pricing 60
     * of them to display four would be work nobody sees.
     */
    const matchupLeagueIds = playedLeagues.slice(0, 4).map((l) => l.id)
    const [exposure, rivals, matchups] = await Promise.all([
      getCrossLeagueExposure(userId, playedLeagues.map((l) => l.id)).catch(() => null),
      getRivalRecords(userId, playedLeagues.map((l) => l.id)).catch(() => null),
      Promise.all(
        matchupLeagueIds.map((id) =>
          getMatchupData(id, userId)
            .then((m) => ({ id, m }))
            .catch(() => ({ id, m: null })),
        ),
      ),
    ])

    /*
     * Only leagues whose BOTH lineups priced land here. An absent entry renders no
     * percentage at all rather than a hedged one — a greyed-out probability still
     * reads as a probability.
     */
    const winProb: Record<string, number> = {}
    for (const { id, m } of matchups) {
      if (m?.winProbability.available) winProb[id] = m.winProbability.data.pWin
    }

    return (
      <Dashboard3A
        issues={issuesAll}
        exposure={exposure}
        rivals={rivals}
        winProb={winProb}
        data={dash34}
        career={career}
        week={week}
        weekLabel={dash34?.weekLabel ?? null}
        planName={planName}
        commissionerCount={playedLeagues.filter((l) => Boolean(l.isCommissioner)).length}
        nowLabel={syncAge.stale ? null : syncAge.label}
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
