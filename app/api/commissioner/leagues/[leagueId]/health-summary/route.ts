import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { UserLeague } from '@/app/dashboard/types'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { getCommissionerHubHealthForUser } from '@/lib/commissioner-hub/commissionerHubHealth'
import { getLeagueManagerHealth } from '@/lib/commissioner-hub/managerHealth'
import { resolveHubHealthScore } from '@/lib/core-app/commissioner/healthScore'
import { managersToCheck, type CommishHealthSummary } from '@/lib/league-media/redraftDeck'

export const dynamic = 'force-dynamic'

/**
 * GET — the redraft Commissioner tab's health panel (components/decide/RedraftCommishHealth.tsx):
 * the league-health score with its sub-scores, and the managers worth checking on.
 *
 * ⚠ READ-ONLY, AND NO NEW SCORE. It composes the reads /core's Commissioner hub already makes for
 * one league (lib/core-app/commissionerHub.ts), so the tab and the hub cannot disagree:
 *   score     getCommissionerHubHealthForUser → resolveHubHealthScore (withheld with its own reason
 *             when the snapshot is low-confidence or not from the database)
 *   managers  getLeagueManagerHealth — the per-manager read the hub's member activity uses for a
 *             native league — minus empty seats and the viewer's own team (as quietManagerNames)
 *
 * Native leagues only: the stale-import rule the hub applies to imported leagues lives in its loader,
 * and an imported league's tab does not render this panel. Commissioners and co-commissioners.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params

  const role = await getLeagueRole(leagueId, userId)
  if (!isCommissionerRole(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, platform: true, sport: true, season: true, status: true, lastSyncedAt: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') {
    const body: CommishHealthSummary = { score: { available: false, reason: 'Shown for leagues AllFantasy runs.' }, managers: [], managersRead: false }
    return NextResponse.json(body)
  }

  const [snapshots, managerHealth, teams] = await Promise.all([
    getCommissionerHubHealthForUser(userId, [
      {
        id: league.id,
        name: league.name,
        isCommissioner: true,
        platform: league.platform,
        sport: league.sport,
        season: league.season,
        status: league.status,
        lastSyncedAt: league.lastSyncedAt,
      } as unknown as UserLeague,
    ]).catch(() => []),
    getLeagueManagerHealth(leagueId).catch(() => null),
    prisma.leagueTeam
      .findMany({ where: { leagueId }, select: { teamName: true, ownerName: true, claimedByUserId: true } })
      .catch(() => [] as Array<{ teamName: string | null; ownerName: string | null; claimedByUserId: string | null }>),
  ])

  const snapshot = snapshots.find((s) => s.leagueId === leagueId) ?? null
  const resolved = resolveHubHealthScore({ snapshot, unread: false, activityStale: false, staleDays: 0 })

  // An unclaimed team is an empty seat, not a quiet manager; the viewer is never told to message themselves.
  const excludeNames = teams
    .filter((t) => !t.claimedByUserId || t.claimedByUserId === userId)
    .flatMap((t) => [t.teamName ?? '', t.ownerName ?? ''])

  const body: CommishHealthSummary = {
    score:
      resolved.available && snapshot
        ? {
            available: true,
            score: resolved.data.score,
            status: resolved.data.status,
            summary: resolved.data.summary,
            confidencePct: resolved.data.confidencePct,
            activeManagers: snapshot.participation?.activeManagers ?? null,
            totalManagers: snapshot.participation?.totalManagers ?? null,
            sub: {
              activity: snapshot.engagementScore,
              participation: snapshot.participation?.score ?? null,
              fairness: snapshot.fairnessScore,
              sustainability: snapshot.sustainabilityScore,
            },
            // Nothing stores past scores yet; the panel draws no trend line without at least two.
            history: [],
          }
        : { available: false, reason: resolved.available ? 'Not enough data to score this league yet.' : resolved.reason },
    managers: managerHealth ? managersToCheck(managerHealth.rows, excludeNames, new Date()) : [],
    managersRead: Boolean(managerHealth && managerHealth.rows.length > 0),
  }
  return NextResponse.json(body)
}
