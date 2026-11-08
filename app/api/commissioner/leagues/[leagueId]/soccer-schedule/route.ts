/**
 * [NEW] GET/PUT: Commissioner soccer schedule config.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getScheduleConfigForLeague, updateScheduleConfigForLeague } from '@/lib/fantasy-schedule'
import { resolveSoccerFantasyWeek } from '@/lib/soccer-schedule'
import type { LeagueFormatId } from '@/lib/league/format-engine'
import { isOwnerOrLeagueCommissioner } from '@/lib/commissioner/leagueCommissionerAccount'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true, leagueVariant: true, leagueType: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await isOwnerOrLeagueCommissioner(league, leagueId, session.user.id))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  if (league.sport !== 'SOCCER') return NextResponse.json({ error: 'Soccer leagues only' }, { status: 400 })
  const config = await getScheduleConfigForLeague(leagueId)
  let previewPlan = null
  try { previewPlan = await resolveSoccerFantasyWeek({ leagueId, leagueFormatId: (league.leagueType ?? 'redraft') as LeagueFormatId, leagueVariant: league.leagueVariant, season: new Date().getFullYear(), week: 1 }) } catch {}
  return NextResponse.json({ config, previewPlan })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await isOwnerOrLeagueCommissioner(league, leagueId, session.user.id))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  if (league.sport !== 'SOCCER') return NextResponse.json({ error: 'Soccer leagues only' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}
  for (const f of ['useDynamicLowVolumeDays','eliminationDayOverride','ceremonyDayOverride','adminDayOverride','volumeThresholdHeavy','volumeThresholdModerate','adminOnSecondLeastBusy','balancedScoringDayCount','finalWeekCounts','transitionDayCount','separateSubtotalDisplay']) {
    if (body[f] !== undefined) patch[f] = body[f]
  }
  await updateScheduleConfigForLeague(leagueId, patch)
  return NextResponse.json({ ok: true, config: await getScheduleConfigForLeague(leagueId) })
}
