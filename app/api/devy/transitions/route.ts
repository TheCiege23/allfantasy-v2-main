import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import { checkRookieTransitionQueue } from '@/lib/devy/rosterEngine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const pending = await checkRookieTransitionQueue(leagueId)
  return NextResponse.json({ pending })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as {
    leagueId?: string
    transitionId?: string
    action?: 'approve' | 'reject'
    note?: string
  }
  const leagueId = body.leagueId?.trim()
  const transitionId = body.transitionId?.trim()
  const action = body.action
  if (!leagueId || !transitionId || !action) {
    return NextResponse.json({ error: 'leagueId, transitionId, action required' }, { status: 400 })
  }

  const gate = await assertLeagueCommissioner(leagueId, userId, 'league')
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const tr = await prisma.devyRookieTransition.findFirst({
    where: { id: transitionId, leagueId },
  })
  if (!tr) return NextResponse.json({ error: 'Transition not found' }, { status: 404 })

  if (action === 'approve') {
    const updated = await prisma.devyRookieTransition.update({
      where: { id: transitionId },
      data: {
        transitionedAt: new Date(),
        commissionerApprovedAt: new Date(),
        notes: body.note ?? tr.notes,
      },
    })
    await prisma.devyDevySlot.updateMany({
      where: { leagueId, playerId: tr.playerId },
      data: { transitionQueue: false, transitionedAt: new Date() },
    })
    return NextResponse.json({ ok: true, transition: updated })
  }

  const updated = await prisma.devyRookieTransition.update({
    where: { id: transitionId },
    data: {
      transitionedAt: new Date(),
      notes: body.note ?? 'rejected',
    },
  })
  await prisma.devyDevySlot.updateMany({
    where: { leagueId, playerId: tr.playerId },
    data: { transitionQueue: false },
  })
  return NextResponse.json({ ok: true, transition: updated })
}

