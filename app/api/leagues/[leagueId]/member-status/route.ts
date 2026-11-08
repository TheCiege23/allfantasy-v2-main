/**
 * What a member needs to know about the league before anything else — any member, their own view only:
 *
 *   draft  the scheduled draft time while the draft has not started (UTC; the client shows it in the
 *          reader's own zone), with a link to add it to a calendar
 *   dues   what THIS member owes and where to pay it, when the league tracks dues (lib/dues/duesTracker.ts)
 *
 * Nothing about other members leaves the server. TRACKING ONLY: the payment links are the league's own.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { formatAmount, isTracking, readDuesConfig, teamPaid } from '@/lib/dues/duesTracker'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) return NextResponse.json({ error: membership.status === 404 ? 'Not found' : 'Forbidden' }, { status: membership.status })

  const [league, draftSession] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { season: true, isDynasty: true, settings: true, leagueSettings: { select: { draftDateUtc: true } }, teams: { select: { id: true, claimedByUserId: true } } },
    }),
    prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } }).catch(() => null),
  ])
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = Date.now()
  const draftAt = league.leagueSettings?.draftDateUtc ?? null
  const draft =
    draftAt && draftAt.getTime() > now && (!draftSession || draftSession.status === 'pre_draft')
      ? { at: draftAt.toISOString(), calendarHref: `/api/leagues/${encodeURIComponent(leagueId)}/draft/calendar` }
      : null

  const config = readDuesConfig(((league.settings as Record<string, unknown>) ?? {}).dues_tracker)
  const myTeamId = league.teams.find((t) => t.claimedByUserId === userId)?.id ?? null
  const dues =
    myTeamId && isTracking(config) && config.amount != null && !teamPaid(config, myTeamId, league.season, Boolean(league.isDynasty))
      ? {
          amount: formatAmount(config),
          dueDate: config.dueDate,
          links: config.paymentLinks,
          reported: Boolean(config.entries.find((e) => e.teamId === myTeamId)?.selfReportedAt),
        }
      : null

  return NextResponse.json({ draft, dues })
}
