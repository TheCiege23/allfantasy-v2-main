import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'

/**
 * POST: Transfer commissioner role to another user.
 * Body: { newCommissionerUserId: string, confirm: true }.
 * New user must have a roster in the league.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const newCommissionerUserId = body?.newCommissionerUserId ?? body?.newCommissionerId
  const confirm = body?.confirm === true

  if (!newCommissionerUserId || typeof newCommissionerUserId !== 'string') {
    return NextResponse.json({ error: 'newCommissionerUserId is required' }, { status: 400 })
  }

  if (!confirm) {
    return NextResponse.json({
      error: 'Confirmation required. Send { confirm: true } to transfer commissioner role.',
    }, { status: 400 })
  }

  if (newCommissionerUserId === userId) {
    return NextResponse.json({ error: 'New commissioner must be a different user' }, { status: 400 })
  }

  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { id: true, userId: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const newUserRoster = await (prisma as any).roster.findFirst({
    where: { leagueId: params.leagueId, platformUserId: newCommissionerUserId },
    select: { id: true },
  })
  if (!newUserRoster) {
    return NextResponse.json({
      error: 'New commissioner must have a roster in this league',
    }, { status: 400 })
  }

  await prisma.league.update({
    where: { id: params.leagueId },
    data: { userId: newCommissionerUserId },
  })

  return NextResponse.json({
    status: 'ok',
    message: 'Commissioner role transferred.',
    newCommissionerUserId,
  })
}
