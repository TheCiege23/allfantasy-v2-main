import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { prisma } from '@/lib/prisma'
import { getExileLeagueId } from '@/lib/survivor/SurvivorExileEngine'
import { canReturnToIsland, executeReturn } from '@/lib/survivor/SurvivorReturnEngine'
import { resolveSurvivorCurrentWeek } from '@/lib/survivor/SurvivorTimelineResolver'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await ctx.params
  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  if (league && isNativePlatform(league.platform)) return NextResponse.json({ error: 'The system selects Exile returns after the configured return week is finalized. Return spots cannot be claimed manually.' }, { status: 409 })

  const [exileLeagueId, mainRosterId, currentWeek] = await Promise.all([
    getExileLeagueId(leagueId),
    getCurrentUserRosterIdForLeague(leagueId, userId),
    resolveSurvivorCurrentWeek(leagueId),
  ])

  if (!exileLeagueId) {
    return NextResponse.json({ error: 'Exile Island is not configured for this league' }, { status: 400 })
  }
  if (!mainRosterId) {
    return NextResponse.json({ error: 'No Survivor roster found for this user' }, { status: 404 })
  }

  const mainRoster = await prisma.roster.findFirst({
    where: { id: mainRosterId, leagueId },
    select: { platformUserId: true },
  })
  if (!mainRoster?.platformUserId) {
    return NextResponse.json({ error: 'Roster is missing a linked manager identity' }, { status: 400 })
  }

  const exileRoster = await prisma.roster.findFirst({
    where: {
      leagueId: exileLeagueId,
      platformUserId: mainRoster.platformUserId,
    },
    select: { id: true },
  })
  if (!exileRoster) {
    return NextResponse.json({ error: 'No exile roster found for this user' }, { status: 404 })
  }

  const eligibility = await canReturnToIsland(leagueId, exileLeagueId, exileRoster.id, currentWeek)
  if (!eligibility.eligible) {
    return NextResponse.json({ error: eligibility.reason ?? 'Not eligible to return yet' }, { status: 400 })
  }

  const result = await executeReturn(leagueId, exileLeagueId, exileRoster.id, {
    platformUserId: mainRoster.platformUserId,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Unable to execute Survivor return' }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    mainRosterId: result.mainRosterId ?? mainRosterId,
    exileRosterId: exileRoster.id,
    week: currentWeek,
  })
}
