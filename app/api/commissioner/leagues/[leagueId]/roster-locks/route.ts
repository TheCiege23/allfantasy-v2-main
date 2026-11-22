import { commissionerAccessResponse, type CommissionerNeed } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readCommissionerRosterLocks, withCommissionerRosterLocks } from '@/lib/league/commissioner-roster-lock'
import { toPrismaJsonInput } from '@/lib/prisma-json'

type Context = { params: Promise<{ leagueId: string }> }

async function authorize(context: Context, need: CommissionerNeed) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const { leagueId } = await context.params
  if (!session?.user?.id) return { leagueId, status: 401 as const }
  const refused = await commissionerAccessResponse(leagueId, session.user.id, need)
  return refused ? { leagueId, status: refused.status as 403 | 404, refused } : { leagueId, status: 200 as const, refused: null }
}

export async function GET(_req: Request, context: Context) {
  const access = await authorize(context, 'view')
  if (access.status !== 200) return access.refused ?? NextResponse.json({ error: 'Unauthorized' }, { status: access.status })
  const league = await prisma.league.findUnique({ where: { id: access.leagueId }, select: { settings: true } })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  return NextResponse.json({ lockedRosters: readCommissionerRosterLocks(league.settings) })
}

export async function PUT(req: Request, context: Context) {
  const access = await authorize(context, 'rosters')
  if (access.status !== 200) return access.refused ?? NextResponse.json({ error: 'Unauthorized' }, { status: access.status })
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
