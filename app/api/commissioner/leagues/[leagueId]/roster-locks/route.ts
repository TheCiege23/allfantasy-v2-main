import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { readCommissionerRosterLocks, withCommissionerRosterLocks } from '@/lib/league/commissioner-roster-lock'
import { toPrismaJsonInput } from '@/lib/prisma-json'

type Context = { params: Promise<{ leagueId: string }> }

async function authorize(context: Context) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const { leagueId } = await context.params
  if (!session?.user?.id) return { leagueId, status: 401 as const }
  try {
    await assertCommissioner(leagueId, session.user.id)
    return { leagueId, status: 200 as const }
  } catch {
    return { leagueId, status: 403 as const }
  }
}

export async function GET(_req: Request, context: Context) {
  const access = await authorize(context)
  if (access.status !== 200) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const league = await prisma.league.findUnique({ where: { id: access.leagueId }, select: { settings: true } })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  return NextResponse.json({ lockedRosters: readCommissionerRosterLocks(league.settings) })
}

export async function PUT(req: Request, context: Context) {
  const access = await authorize(context)
  if (access.status !== 200) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const body = await req.json().catch(() => null) as { lockedRosters?: unknown } | null
  const raw = body?.lockedRosters
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.values(raw).some((value) => typeof value !== 'boolean')) {
    return NextResponse.json({ error: 'Expected a map of team IDs to lock states.' }, { status: 400 })
  }
  const teamIds = Object.keys(raw)
  const known = await prisma.leagueTeam.count({ where: { leagueId: access.leagueId, id: { in: teamIds } } })
  if (known !== teamIds.length) return NextResponse.json({ error: 'A team does not belong to this league.' }, { status: 400 })
  const league = await prisma.league.findUnique({ where: { id: access.leagueId }, select: { settings: true } })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  const settings = withCommissionerRosterLocks(league.settings, raw as Record<string, boolean>)
  await prisma.league.update({ where: { id: access.leagueId }, data: { settings: toPrismaJsonInput(settings) } })
  return NextResponse.json({ lockedRosters: readCommissionerRosterLocks(settings) })
}
