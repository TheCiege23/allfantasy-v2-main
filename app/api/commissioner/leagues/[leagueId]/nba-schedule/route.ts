/**
 * [NEW] app/api/commissioner/leagues/[leagueId]/nba-schedule/route.ts
 * GET: Returns NBA schedule config + current week plan for commissioner review.
 * PUT: Updates NBA schedule config.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getNbaScheduleConfig, updateNbaScheduleConfig, resolveNbaFantasyWeek } from '@/lib/nba-schedule'
import type { NbaScheduleConfig } from '@/lib/nba-schedule'
import type { LeagueFormatId } from '@/lib/league/format-engine'
import { isOwnerOrLeagueCommissioner } from '@/lib/commissioner/leagueCommissionerAccount'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, sport: true, leagueVariant: true, leagueType: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await isOwnerOrLeagueCommissioner(league, leagueId, session.user.id))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  if (league.sport !== 'NBA') return NextResponse.json({ error: 'NBA leagues only' }, { status: 400 })

  const config = await getNbaScheduleConfig(leagueId)

  // Get current week's plan as preview
  const season = new Date().getFullYear()
  const currentWeek = 1 // TODO: resolve from league settings or current date
  let previewPlan = null
  try {
    previewPlan = await resolveNbaFantasyWeek({
      leagueId,
      leagueFormatId: (league.leagueType ?? 'redraft') as LeagueFormatId,
      leagueVariant: league.leagueVariant,
      season,
      week: currentWeek,
    })
  } catch { /* non-fatal */ }

  return NextResponse.json({ config, previewPlan })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, sport: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await isOwnerOrLeagueCommissioner(league, leagueId, session.user.id))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  if (league.sport !== 'NBA') return NextResponse.json({ error: 'NBA leagues only' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const patch: Partial<NbaScheduleConfig> = {}

  if (typeof body.useDynamicLowVolumeDays === 'boolean') patch.useDynamicLowVolumeDays = body.useDynamicLowVolumeDays
  if (body.eliminationDayOverride !== undefined) patch.eliminationDayOverride = body.eliminationDayOverride
  if (body.ceremonyDayOverride !== undefined) patch.ceremonyDayOverride = body.ceremonyDayOverride
  if (body.adminDayOverride !== undefined) patch.adminDayOverride = body.adminDayOverride
  if (typeof body.volumeThresholdHeavy === 'number') patch.volumeThresholdHeavy = body.volumeThresholdHeavy
  if (typeof body.volumeThresholdModerate === 'number') patch.volumeThresholdModerate = body.volumeThresholdModerate
  if (typeof body.adminOnSecondLeastBusy === 'boolean') patch.adminOnSecondLeastBusy = body.adminOnSecondLeastBusy
  if (typeof body.balancedScoringDayCount === 'number') patch.balancedScoringDayCount = body.balancedScoringDayCount
  if (typeof body.finalWeekCounts === 'boolean') patch.finalWeekCounts = body.finalWeekCounts
  if (typeof body.transitionDayCount === 'number') patch.transitionDayCount = body.transitionDayCount
  if (typeof body.separateSubtotalDisplay === 'boolean') patch.separateSubtotalDisplay = body.separateSubtotalDisplay

  await updateNbaScheduleConfig(leagueId, patch)
  const updated = await getNbaScheduleConfig(leagueId)

  return NextResponse.json({ ok: true, config: updated })
}
