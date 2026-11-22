import { draftQueueKeyForUser } from '@/lib/league/teamScopedKey'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeague } from '@/lib/draft/access'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const draftId = req.nextUrl.searchParams?.get('draftId')?.trim() ?? ''
  const uid = req.nextUrl.searchParams?.get('userId')?.trim() ?? userId
  if (!draftId) {
    return NextResponse.json({ error: 'draftId required' }, { status: 400 })
  }

  const ds = await prisma.draftSession.findFirst({
    where: { id: draftId },
    select: { leagueId: true },
  })
  if (!ds) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!(await canAccessLeague(ds.leagueId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // A queue is a manager's private draft plan. League access alone let any member
  // read a rival's with ?userId=; only the commissioner may look at someone else's.
  if (uid !== userId && !(await canCommissionerAct(ds.leagueId, userId, 'view'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // A manager's own queue is the queue of the team they are on; a commissioner reading another manager's uses that id.
  const rows = await prisma.draftQueueEntry.findMany({
    where: { draftSessionId: draftId, userId: uid === userId ? await draftQueueKeyForUser(ds.leagueId, userId) : uid },
    orderBy: { priority: 'asc' },
  })

  return NextResponse.json({ entries: rows })
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const draftId = typeof body?.draftId === 'string' ? body.draftId.trim() : ''
  const action = typeof body?.action === 'string' ? body.action : 'add'
  const playerId = typeof body?.playerId === 'string' ? body.playerId.trim() : ''
  const playerName = typeof body?.playerName === 'string' ? body.playerName : null
  const priority = typeof body?.priority === 'number' ? body.priority : 0

  if (!draftId || !playerId) {
    return NextResponse.json({ error: 'draftId and playerId required' }, { status: 400 })
  }

  const ds = await prisma.draftSession.findFirst({
    where: { id: draftId },
    select: { leagueId: true },
  })
  if (!ds) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!(await canAccessLeague(ds.leagueId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const queueKey = await draftQueueKeyForUser(ds.leagueId, userId)
  if (action === 'remove') {
    await prisma.draftQueueEntry.deleteMany({
      where: { draftSessionId: draftId, userId: queueKey, playerId },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'reorder') {
    await prisma.draftQueueEntry.updateMany({
      where: { draftSessionId: draftId, userId: queueKey, playerId },
      data: { priority },
    })
    return NextResponse.json({ ok: true })
  }

  await prisma.draftQueueEntry.create({
    data: {
      draftSessionId: draftId,
      userId: queueKey,
      playerId,
      playerName: playerName ?? undefined,
      priority,
    },
  })

  return NextResponse.json({ ok: true })
}

