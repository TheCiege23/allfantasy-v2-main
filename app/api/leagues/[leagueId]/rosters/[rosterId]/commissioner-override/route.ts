import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { commissionerForceRosterLineup } from '@/lib/roster-lineup-engine/commissionerRosterOverride'

function weekFromLeagueSettings(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 1
  const o = settings as Record<string, unknown>
  const w = o.currentWeek ?? o.current_week ?? o.week
  if (typeof w === 'number' && Number.isFinite(w)) return Math.max(1, w)
  if (typeof w === 'string') {
    const n = parseInt(w, 10)
    return Number.isFinite(n) ? Math.max(1, n) : 1
  }
  return 1
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; rosterId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId, rosterId } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const nextPlayerData =
    body?.playerData && typeof body.playerData === 'object' && !Array.isArray(body.playerData)
      ? (body.playerData as Record<string, unknown>)
      : null

  if (!nextPlayerData) {
    return NextResponse.json({ error: 'Missing playerData' }, { status: 400 })
  }

  try {
    await requireCommissionerRole(leagueId, session.user.id, 'rosters')
  } catch (res) {
    if (res instanceof Response) {
      const data = await res.json().catch(() => ({ error: 'Forbidden' }))
      return NextResponse.json(data, { status: res.status })
    }
    throw res
  }

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true, settings: true } })
  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId } })
  if (!roster) {
    return NextResponse.json({ error: 'Roster not found' }, { status: 404 })
  }

  const weekRaw = body?.week
  const week =
    typeof weekRaw === 'number' && Number.isFinite(weekRaw)
      ? Math.max(1, Math.floor(weekRaw))
      : weekFromLeagueSettings(league.settings)
  const season =
    typeof body?.season === 'number' && Number.isFinite(body.season) ? body.season : league.season

  const reason = typeof body?.reason === 'string' ? body.reason : undefined

  const result = await commissionerForceRosterLineup({
    leagueId,
    rosterId,
    commissionerUserId: session.user.id,
    nextPlayerData,
    season,
    week,
    reason,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  }

  return NextResponse.json({ ok: true })
}