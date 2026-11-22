import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const pending = await prisma.c2CTransitionRecord.findMany({
    where: {
      leagueId,
      OR: [{ destinationBucket: 'commissioner_review' }, { approvedAt: null, commissionerApproved: false }],
    },
    orderBy: { transitionedAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({ transitions: pending })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId : ''
  const transitionId = typeof body?.transitionId === 'string' ? body.transitionId : ''
  const action = body?.action === 'approve' || body?.action === 'reject' ? body.action : null
  if (!leagueId || !transitionId || !action) {
    return NextResponse.json({ error: 'leagueId, transitionId, action approve|reject required' }, { status: 400 })
  }

  const gate = await assertLeagueCommissioner(leagueId, userId, 'league')
  if (!gate.ok) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const existing = await prisma.c2CTransitionRecord.findFirst({
    where: { id: transitionId, leagueId },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await prisma.c2CTransitionRecord.update({
    where: { id: transitionId },
    data: {
      commissionerApproved: action === 'approve',
      approvedAt: new Date(),
      notes: action === 'reject' ? 'rejected' : 'approved',
    },
  })
  return NextResponse.json({ transition: updated })
}

