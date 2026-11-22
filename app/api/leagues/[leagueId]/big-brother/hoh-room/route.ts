/**
 * app/api/leagues/[leagueId]/big-brother/hoh-room/route.ts
 *
 * HOH room guest management — invite and kick rosters from the private HOH Room
 * chat channel for the current cycle.
 *
 * GET    — list current guests (HOH + invited rosters).
 * POST   — HOH invites a roster: { rosterId: string }
 * DELETE — HOH kicks a roster: { rosterId: string }
 *
 * Only the current HOH (or commissioner) may manage the guest list.
 * Membership resets automatically when a new cycle starts (cascade delete).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { getCurrentCycleForLeague } from '@/lib/big-brother/BigBrotherPhaseStateMachine'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ leagueId: string }> }

/** Resolve the caller's roster id and whether they are HOH / commissioner. */
async function resolveAuthorization(
  leagueId: string,
  userId: string,
  cycleId: string,
): Promise<{ isHoh: boolean; isCommissioner: boolean; myRosterId: string | null }> {
  const [league, roster, cycle] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }),
    prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
    prisma.bigBrotherCycle.findUnique({ where: { id: cycleId }, select: { hohRosterId: true } }),
  ])
  const isCommissioner = league?.userId === userId
  const myRosterId = roster?.id ?? await acceptedCoOwnerRosterId(leagueId, userId)
  const isHoh = myRosterId != null && myRosterId === cycle?.hohRosterId
  return { isHoh, isCommissioner, myRosterId }
}

export async function GET(
  _req: NextRequest,
  ctx: RouteCtx,
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!(await isBigBrotherLeague(leagueId))) {
    return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 400 })
  }

  const current = await getCurrentCycleForLeague(leagueId)
  if (!current) return NextResponse.json({ error: 'No active cycle' }, { status: 404 })

  const [cycle, guests] = await Promise.all([
    prisma.bigBrotherCycle.findUnique({
      where: { id: current.id },
      select: { hohRosterId: true },
    }),
    prisma.bigBrotherHohRoomGuest.findMany({
      where: { cycleId: current.id },
      select: { rosterId: true, invitedAt: true },
      orderBy: { invitedAt: 'asc' },
    }),
  ])

  return NextResponse.json({
    ok: true,
    cycleId: current.id,
    hohRosterId: cycle?.hohRosterId ?? null,
    guests,
  })
}

export async function POST(
  req: NextRequest,
  ctx: RouteCtx,
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!(await isBigBrotherLeague(leagueId))) {
    return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 400 })
  }

  const current = await getCurrentCycleForLeague(leagueId)
  if (!current) return NextResponse.json({ error: 'No active cycle' }, { status: 404 })

  const { isHoh, isCommissioner } = await resolveAuthorization(leagueId, userId, current.id)
  if (!isHoh && !isCommissioner) {
    return NextResponse.json({ error: 'Only the current HOH or commissioner may invite guests' }, { status: 403 })
  }

  const body = (await req.json()) as { rosterId?: string }
  const { rosterId } = body
  if (!rosterId || typeof rosterId !== 'string') {
    return NextResponse.json({ error: 'rosterId is required' }, { status: 400 })
  }

  // Verify the target roster belongs to this league and is still active (not evicted).
  const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId }, select: { id: true } })
  if (!roster) {
    return NextResponse.json({ error: 'Roster not found in this league' }, { status: 404 })
  }

  // Check the roster is not evicted.
  const evicted = await prisma.bigBrotherJuryMember.findFirst({ where: { leagueId, rosterId } })
  if (evicted) {
    return NextResponse.json({ error: 'Cannot invite an evicted houseguest to the HOH Room' }, { status: 409 })
  }

  await prisma.bigBrotherHohRoomGuest.upsert({
    where: { cycleId_rosterId: { cycleId: current.id, rosterId } },
    create: { cycleId: current.id, rosterId },
    update: {},
  })

  return NextResponse.json({ ok: true, cycleId: current.id, rosterId })
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteCtx,
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!(await isBigBrotherLeague(leagueId))) {
    return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 400 })
  }

  const current = await getCurrentCycleForLeague(leagueId)
  if (!current) return NextResponse.json({ error: 'No active cycle' }, { status: 404 })

  const { isHoh, isCommissioner } = await resolveAuthorization(leagueId, userId, current.id)
  if (!isHoh && !isCommissioner) {
    return NextResponse.json({ error: 'Only the current HOH or commissioner may kick guests' }, { status: 403 })
  }

  const body = (await req.json()) as { rosterId?: string }
  const { rosterId } = body
  if (!rosterId || typeof rosterId !== 'string') {
    return NextResponse.json({ error: 'rosterId is required' }, { status: 400 })
  }

  const deleted = await prisma.bigBrotherHohRoomGuest.deleteMany({
    where: { cycleId: current.id, rosterId },
  })

  if (deleted.count === 0) {
    return NextResponse.json({ error: 'Roster is not a current HOH Room guest' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, cycleId: current.id, rosterId })
}
