import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { prisma } from '@/lib/prisma'
import { getScheduleConfigForLeague } from '@/lib/schedule-defaults/ScheduleConfigResolver'

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const type = req.nextUrl.searchParams?.get('type') || 'settings'
  if (type !== 'settings') {
    return NextResponse.json({ error: 'Unsupported type' }, { status: 400 })
  }

  const config = await getScheduleConfigForLeague(params.leagueId)
  if (!config) return NextResponse.json({ error: 'League or schedule config not found' }, { status: 404 })
  return NextResponse.json(config)
}

export async function PUT(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const league = await (prisma as any).league.findUnique({
    where: { id: params.leagueId },
    select: { settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const nextSettings: Record<string, unknown> = { ...settings }

  const map: Array<[string, string]> = [
    ['scheduleUnit', 'schedule_unit'],
    ['regularSeasonLength', 'regular_season_length'],
    ['matchupFrequency', 'matchup_frequency'],
    ['matchupCadence', 'schedule_cadence'],
    ['headToHeadBehavior', 'schedule_head_to_head_behavior'],
    ['lockWindowBehavior', 'schedule_lock_window_behavior'],
    ['scoringPeriodBehavior', 'schedule_scoring_period_behavior'],
    ['rescheduleHandling', 'schedule_reschedule_handling'],
    ['doubleheaderHandling', 'schedule_doubleheader_handling'],
    ['playoffTransitionPoint', 'schedule_playoff_transition_point'],
    ['scheduleGenerationStrategy', 'schedule_generation_strategy'],
    ['lockTimeBehavior', 'lock_time_behavior'],
  ]

  for (const [incoming, target] of map) {
    if (hasOwn(body, incoming)) {
      nextSettings[target] = body[incoming] as unknown
    }
  }

  await (prisma as any).league.update({
    where: { id: params.leagueId },
    data: { settings: nextSettings },
  })

  const config = await getScheduleConfigForLeague(params.leagueId)
  return NextResponse.json(config ?? { ok: true })
}
