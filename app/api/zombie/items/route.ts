import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leagueId = searchParams?.get('leagueId')
  const userId = searchParams?.get('userId')
  if (!leagueId || !userId) return NextResponse.json({ error: 'leagueId and userId required' }, { status: 400 })

  // Any signed-in user could read any league's team items; members only.
  const membership = await assertLeagueMember(leagueId, session.user.id)
  if (!membership.ok) return NextResponse.json({ error: 'Forbidden' }, { status: membership.status })

  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
  })
  if (!roster) return NextResponse.json({ items: [] })

  const team = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
    include: { items: true },
  })

  return NextResponse.json({ items: team?.items ?? [] })
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const sessionUserId = session?.user?.id
  if (!sessionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null
  const week = typeof body.week === 'number' ? body.week : parseInt(String(body.week ?? ''), 10)
  if (!leagueId || !Number.isFinite(week))
    return NextResponse.json({ error: 'leagueId and week required' }, { status: 400 })

  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: sessionUserId },
  })
  if (!roster) return NextResponse.json({ error: 'Not in league' }, { status: 403 })

  const teamRow = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
  })
  if (!teamRow) return NextResponse.json({ error: 'Zombie team row missing' }, { status: 400 })

  const item = await prisma.zombieTeamItem.findFirst({
    where: {
      teamStatusId: teamRow.id,
      itemType: typeof body.itemType === 'string' ? body.itemType : '',
      isUsed: false,
    },
  })
  if (!item) return NextResponse.json({ error: 'Item not found or already used' }, { status: 400 })

  await prisma.zombieTeamItem.update({
    where: { id: item.id },
    data: {
      isUsed: true,
      usedAtWeek: week,
      usedOnUserId: typeof body.targetUserId === 'string' ? body.targetUserId : null,
      usedEffect: 'used',
    },
  })

  return NextResponse.json({ ok: true })
}

