/**
 * Fantasy OS Suite — Phase OS-B1: Commissioner Multi-League Command Center.
 *
 * Session-scoped, like User OS — NOT like Platform OS. This route never accepts a client-supplied
 * league list; it always resolves the caller's OWN commissioner leagues server-side (via the same
 * `getDashboardLeagueListForUser` + `isCommissioner` filter the rest of Commissioner Hub already
 * uses — not a new definition of "commissioner"), so no admin gate is needed. A signed-in user can
 * only ever see aggregate data about leagues they themselves commission.
 *
 * Returns Decision OS's own id-keyed aggregation (`resolveCommissionerCommandCenterSnapshot`)
 * unchanged, plus one small piece of ordinary (non-Decision-OS) AF data this composition
 * deliberately doesn't touch: `draftsApproachingCount`, from the real, existing
 * `LeagueSettings.draftDateUtc` column (AF-native leagues only — Sleeper-imported leagues have no
 * persisted draft date anywhere in this codebase today; see `docs/os/COMMISSIONER_COMMAND_CENTER.md`
 * for why that's an honest gap, not an oversight, in this phase).
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { resolveCommissionerCommandCenterSnapshot } from '@/lib/decision-os/commissionerCommandCenter'

export const dynamic = 'force-dynamic'

const DRAFT_APPROACHING_WINDOW_DAYS = 14

interface DashboardLeagueRow {
  id?: unknown
  isCommissioner?: unknown
}

async function resolveCommissionerLeagueIds(userId: string): Promise<string[]> {
  const payload = await getDashboardLeagueListForUser(userId).catch(() => null)
  const leagues = (payload?.leagues ?? []) as DashboardLeagueRow[]
  return leagues
    .filter((l) => l.isCommissioner === true && typeof l.id === 'string')
    .map((l) => l.id as string)
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
  const leagueIds = await resolveCommissionerLeagueIds(userId)

  const [snapshot, draftsApproachingCount] = await Promise.all([
    resolveCommissionerCommandCenterSnapshot(leagueIds, now),
    countDraftsApproaching(leagueIds, now),
  ])

  return NextResponse.json({ ...snapshot, draftsApproachingCount })
}
