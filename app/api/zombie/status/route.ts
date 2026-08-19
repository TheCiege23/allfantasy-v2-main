import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { requireCommissionerOnly } from '@/lib/league/permissions'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leagueId = searchParams?.get('leagueId')
  const filterUserId = searchParams?.get('userId')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const z = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    include: {
      teams: { include: { items: true } },
    },
  })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (filterUserId) {
    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: filterUserId },
    })
    if (!roster) return NextResponse.json({ team: null })
    const team = z.teams.find((t) => t.rosterId === roster.id)
    return NextResponse.json({ team })
  }

  return NextResponse.json({
    teams: z.teams.map((t) => ({
      id: t.id,
      rosterId: t.rosterId,
      status: t.status,
      isWhisperer: t.isWhisperer,
      infectionCount: t.infectionCount,
      itemCount: t.items.length,
    })),
  })
}

export async function PATCH(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null
  const targetUserId = typeof body.userId === 'string' ? body.userId : null
  const newStatus = typeof body.newStatus === 'string' ? body.newStatus : null
  if (!leagueId || !targetUserId || !newStatus)
    return NextResponse.json({ error: 'leagueId, userId, newStatus required' }, { status: 400 })

  await requireCommissionerOnly(leagueId, userId)

  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: targetUserId },
  })
  if (!roster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })

  await prisma.zombieLeagueTeam.update({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
    data: { status: newStatus },
  })

  await prisma.zombieAuditLog.create({
    data: {
      leagueId,
      universeId: z.universeId,
      zombieLeagueId: z.id,
      eventType: 'commissioner_status_override',
      metadata: toPrismaJsonInput({ targetUserId, newStatus, reason: body.reason }),
    },
  })

  return NextResponse.json({ ok: true })
}

