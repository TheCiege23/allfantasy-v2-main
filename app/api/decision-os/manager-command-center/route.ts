/**
 * Fantasy OS Suite — Phase OS-C1: Manager Operating System Foundation.
 *
 * Session-scoped, exactly like Commissioner OS's own command-center route
 * (`/api/decision-os/commissioner-command-center`) — this route never accepts a client-supplied
 * league list; it always resolves the caller's OWN league membership server-side via the same
 * `getDashboardLeagueListForUser` the rest of the dashboard/commissioner-hub already uses. Unlike
 * that route, this one does NOT filter to `isCommissioner === true` — every league the session user
 * belongs to (commissioner, member, or imported) is in scope, since Manager OS answers "what should
 * I do as a PLAYER in this league," not "what should I do as its commissioner."
 *
 * `draftsApproachingCount` reuses the exact same real `LeagueSettings.draftDateUtc` column and
 * window Commissioner OS's own route counts from — not new intelligence, just counted across a
 * different (broader) league set.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedIntelligenceIntegrationService } from '@/lib/fantasy-os/sports-runtime/intelligenceIntegration'
import { resolveManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'

export const dynamic = 'force-dynamic'

const DRAFT_APPROACHING_WINDOW_DAYS = 14

interface DashboardLeagueRow {
  id?: unknown
}

async function resolveMemberLeagueIds(userId: string): Promise<string[]> {
  const payload = await getDashboardLeagueListForUser(userId).catch(() => null)
  const leagues = (payload?.leagues ?? []) as DashboardLeagueRow[]
  return leagues.filter((l) => typeof l.id === 'string').map((l) => l.id as string)
}

async function countDraftsApproaching(leagueIds: string[], now: Date): Promise<number> {
  if (leagueIds.length === 0) return 0
  try {
    const windowEnd = new Date(now.getTime() + DRAFT_APPROACHING_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    return await prisma.leagueSettings.count({
      where: {
        leagueId: { in: leagueIds },
        draftDateUtc: { gte: now, lte: windowEnd },
      },
    })
  } catch {
    // Honest degradation, matching every other Decision OS composition's own contract — never a 500
    // for a stat that's explicitly optional/best-effort.
    return 0
  }
}

export async function GET() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const leagueIds = await resolveMemberLeagueIds(userId)

  const [snapshot, draftsApproachingCount] = await Promise.all([
    resolveManagerCommandCenterSnapshot(userId, leagueIds, now),
    countDraftsApproaching(leagueIds, now),
  ])

  // Gated, informational certified factual grounding (freshness/game context/evidence availability). It never
  // changes the snapshot, recommendations, or any manager reasoning. Wrapped so it can never fail the route.
  let sportsContext
  if (isSportsDataEnabled('intelligence')) {
    try {
      sportsContext = await new CertifiedIntelligenceIntegrationService().describeManagerSportsContext({ season: String(now.getFullYear()), week: '1' })
    } catch {
      sportsContext = undefined
    }
  }

  return NextResponse.json({ ...snapshot, draftsApproachingCount, ...(sportsContext ? { sportsContext } : {}) })
}
