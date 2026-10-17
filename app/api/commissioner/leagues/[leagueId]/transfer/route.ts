import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { logAction } from '@/server/services/auditService'

/**
 * Hand the head-commish role to another manager. Head commish only.
 *
 * GET:  `{ candidates: [{ userId, name }] }` — managers with a roster in this league, minus the caller.
 * POST: `{ newCommissionerUserId, confirm: true }`. The new commish must have a roster here.
 *
 * ⚠ The head commish is `League.userId`, but `getLeagueRole` ALSO grants the role to any claimed
 * team flagged `isCommissioner`. Moving only `League.userId` left the old owner's team flag set, so
 * the "former" commish kept every commish power. The flag moves with the role, in one transaction.
 */
async function authorize(props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return { error: NextResponse.json({ error: 'Only the head commish can transfer the league.' }, { status: 403 }) }
  }
  return { leagueId: params.leagueId, userId }
}

export async function GET(_req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const auth = await authorize(props)
  if ('error' in auth) return auth.error

  const rosters = await prisma.roster.findMany({
    where: { leagueId: auth.leagueId, NOT: { platformUserId: auth.userId } },
    select: { platformUserId: true },
  })
  // Only real app accounts can hold the role; never select email (names are shown to the commish).
  const users = await prisma.appUser.findMany({
    where: { id: { in: rosters.map((r) => r.platformUserId) } },
    select: { id: true, displayName: true, username: true },
  })
  const candidates = users
    .map((u) => ({ userId: u.id, name: u.displayName?.trim() || `@${u.username}` }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ candidates })
}

export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const auth = await authorize(props)
  if ('error' in auth) return auth.error
  const { leagueId, userId } = auth

  const body = await req.json().catch(() => ({}))
  const newCommissionerUserId = body?.newCommissionerUserId ?? body?.newCommissionerId
  const confirm = body?.confirm === true

  if (!newCommissionerUserId || typeof newCommissionerUserId !== 'string') {
    return NextResponse.json({ error: 'newCommissionerUserId is required' }, { status: 400 })
  }
  if (!confirm) {
    return NextResponse.json(
      { error: 'Confirmation required. Send { confirm: true } to transfer the commish role.' },
      { status: 400 },
    )
  }
  if (newCommissionerUserId === userId) {
    return NextResponse.json({ error: 'The new commish must be a different manager' }, { status: 400 })
  }

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, userId: true } })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const newUserRoster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: newCommissionerUserId },
    select: { id: true },
  })
  if (!newUserRoster) {
    return NextResponse.json({ error: 'The new commish must have a roster in this league' }, { status: 400 })
  }

  const previousOwner = league.userId
  await prisma.$transaction([
    prisma.league.update({ where: { id: leagueId }, data: { userId: newCommissionerUserId } }),
    // The outgoing head becomes a manager (not a co-commish — the new head can re-add them).
    prisma.leagueTeam.updateMany({
      where: { leagueId, claimedByUserId: { in: [previousOwner, userId].filter(Boolean) as string[] } },
      data: { isCommissioner: false },
    }),
    prisma.leagueTeam.updateMany({
      where: { leagueId, claimedByUserId: newCommissionerUserId },
      data: { isCommissioner: true, isCoCommissioner: false },
    }),
  ])

  await logAction({
    leagueId,
    userId,
    actionType: 'commish_transfer',
    entityType: 'league',
    entityId: leagueId,
    beforeState: { headCommishUserId: previousOwner },
    afterState: { headCommishUserId: newCommissionerUserId },
  }).catch(() => undefined)

  return NextResponse.json({
    status: 'ok',
    message: 'Commish role transferred.',
    newCommissionerUserId,
  })
}
