import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import { parseOptionalRedraftPositiveInteger } from '@/lib/redraft/betaRouteInput'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import {
  advanceNflRedraftScheduleWeek,
  buildScheduleRuntimeEvent,
  generateNflRedraftScheduleForSeason,
  resolveNflRedraftScheduleRuntime,
} from '@/lib/schedule-runtime'

export const dynamic = 'force-dynamic'

type ScheduleAction =
  | 'generate'
  | 'regenerate'
  | 'open_week'
  | 'complete_week'
  | 'advance_week'
  | 'lock_schedule'
  | 'recalculate_standings'

async function resolveSeasonGate(input: {
  seasonId?: string | null
  leagueId?: string | null
  userId: string
}) {
  const season = await prisma.redraftSeason.findFirst({
    where: input.seasonId ? { id: input.seasonId } : { leagueId: input.leagueId ?? undefined },
    orderBy: input.seasonId ? undefined : { createdAt: 'desc' },
    select: { id: true, leagueId: true, currentWeek: true },
  })
  if (!season) return { ok: false as const, response: NextResponse.json({ error: 'Season not found' }, { status: 404 }) }

  const gate = await assertLeagueMember(season.leagueId, input.userId)
  if (!gate.ok) return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: gate.status }) }

  return { ok: true as const, season }
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!seasonId && !leagueId) {
    return NextResponse.json({ error: 'seasonId or leagueId required' }, { status: 400 })
  }

  const gate = await resolveSeasonGate({ seasonId, leagueId, userId })
  if (!gate.ok) return gate.response

  const resolved = await resolveNflRedraftScheduleRuntime({ seasonId: gate.season.id })
  if (!resolved.ok) return NextResponse.json({ error: resolved.reason }, { status: 409 })

  return NextResponse.json({
    seasonId: gate.season.id,
    schedule: resolved.state,
    coverage: resolved.coverage,
  })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    seasonId?: string
    leagueId?: string
    action?: ScheduleAction
    week?: number | string
    regenerate?: boolean
    commissionerOverride?: boolean
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action ?? 'generate'
  if (!body.seasonId?.trim() && !body.leagueId?.trim()) {
    return NextResponse.json({ error: 'seasonId or leagueId required' }, { status: 400 })
  }
  const gate = await resolveSeasonGate({
    seasonId: body.seasonId?.trim(),
    leagueId: body.leagueId?.trim(),
    userId,
  })
  if (!gate.ok) return gate.response

  const commissionerGate = await assertLeagueCommissioner(gate.season.leagueId, userId)
  if (!commissionerGate.ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: commissionerGate.status })
  }

  if (action === 'generate' || action === 'regenerate') {
    const generated = await generateNflRedraftScheduleForSeason({
      seasonId: gate.season.id,
      regenerate: action === 'regenerate' || body.regenerate === true,
      commissionerOverride: body.commissionerOverride === true,
      actorUserId: userId,
    })
    if (!generated.ok) return NextResponse.json({ error: generated.message, code: generated.code }, { status: 409 })
    return NextResponse.json(generated)
  }

  if (action === 'recalculate_standings') {
    const parsedWeek = parseOptionalRedraftPositiveInteger(body.week ?? gate.season.currentWeek, 'week')
    if (!parsedWeek.ok) return NextResponse.json({ error: parsedWeek.error }, { status: 400 })
    const week = parsedWeek.value ?? gate.season.currentWeek
    await updateStandings(gate.season.id, week)
    const resolved = await resolveNflRedraftScheduleRuntime({ seasonId: gate.season.id })
    return NextResponse.json({
      ok: true,
      seasonId: gate.season.id,
      schedule: resolved.ok ? resolved.state : null,
      events: [
        buildScheduleRuntimeEvent({
          leagueId: gate.season.leagueId,
          type: 'standings.recalculated',
          actorUserId: userId,
          payload: { seasonId: gate.season.id, throughWeek: week },
        }),
      ],
    })
  }

  const parsedWeek = parseOptionalRedraftPositiveInteger(body.week, 'week')
  if (!parsedWeek.ok) return NextResponse.json({ error: parsedWeek.error }, { status: 400 })
  const advanced = await advanceNflRedraftScheduleWeek({
    seasonId: gate.season.id,
    action,
    week: parsedWeek.value ?? undefined,
    actorUserId: userId,
    commissionerOverride: body.commissionerOverride === true,
  })
  if (!advanced.ok) return NextResponse.json({ error: advanced.message, code: advanced.code }, { status: 409 })
  return NextResponse.json(advanced)
}
