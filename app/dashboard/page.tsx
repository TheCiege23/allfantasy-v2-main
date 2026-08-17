import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { recordDashboardActivation } from '@/lib/analytics/recordDashboardActivation'

/**
 * /dashboard — cut over to /core.
 *
 * ⚠ THE OLD DASHBOARD IS NOT DELETED. NocturneDashboard.tsx and every component
 * it uses stay on disk, and this file is a redirect rather than a rewrite, so
 * reverting the cutover is restoring one file rather than reconstructing a screen.
 * That mattered enough to be worth the dead code: this is the surface every
 * signed-in user lands on.
 *
 * ⚠ THE ACTIVATION METRIC IS PRESERVED, WHICH IS WHY THIS IS NOT A ONE-LINE
 * REDIRECT. `recordDashboardActivation` fired here on every dashboard render and
 * is a funnel signal, not decoration. A redirect that simply dropped it would
 * have made the metric go quiet on cutover day — indistinguishable from users
 * stopping, and discovered weeks later when someone asked why activation fell off
 * a cliff. It still fires, with a real league count from a cheap aggregate rather
 * than the full league payload the old page happened to have already loaded.
 *
 * ⚠ EVERY BLOCKER FROM THE CUTOVER LEDGER IS CLOSED BEFORE THIS LANDS: the league
 * list (Portfolio), the commercial surfaces (18a/20a), the geo compliance gate,
 * league invites, rankings, and the three "not built yet" rail slots. Redirecting
 * before those existed would have silently deleted working features.
 */

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  type Session = { user?: { id?: string } } | null
  let session: Session = null
  let sessionFailed = false
  try {
    session = (await getServerSession(authOptions as never)) as Session
  } catch (error) {
    console.error('[dashboard] getServerSession failed:', error)
    sessionFailed = true
  }

  /*
   * ⚠ THE REDIRECT IS OUTSIDE THE CATCH, DELIBERATELY, AND NOT ONLY FOR TYPING.
   * next/navigation's redirect() works by THROWING a control-flow error. Called
   * inside a try it would be caught by that same block, or by any wrapping one,
   * and swallowed — the redirect would silently not happen. Every redirect in
   * this file sits outside every try.
   *
   * (It also fixes a real narrowing bug: with redirect() in the catch, TS infers
   * `session` as `never` afterwards and rejects reading `.user` from it.)
   */
  if (sessionFailed) redirect('/login?callbackUrl=/core')

  const rawUserId = typeof session?.user?.id === 'string' ? session.user.id.trim() : ''
  if (!rawUserId) {
    // callbackUrl points at /core, not /dashboard — signing in should not bounce
    // the user back through a redirect they have already been through once.
    redirect('/login?callbackUrl=/core')
  }

  try {
    const leagueCount = await prisma.leagueTeam.count({
      where: { claimedByUserId: rawUserId },
    })
    void recordDashboardActivation({
      userId: rawUserId,
      leagueCount,
      getCookie: (name) => cookies().get(name)?.value,
    })
  } catch (error) {
    /*
     * Analytics must never block the redirect. Losing one activation row is a
     * reporting gap; failing to route someone to their dashboard is an outage.
     */
    console.error('[dashboard] activation record failed:', error)
  }

  redirect('/core')
}
