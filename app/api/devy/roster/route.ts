import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { canMoveRosterPlayers } from '@/lib/league/rosterMoveAccess'
import { getScoringEligibility, getWeeklyPointsBreakdownForRoster } from '@/lib/devy/scoringEligibilityEngine'
import { moveToTaxi, promoteToActive } from '@/lib/devy/rosterEngine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const rosterId = req.nextUrl.searchParams?.get('rosterId')?.trim()
  if (!leagueId || !rosterId) {
    return NextResponse.json({ error: 'leagueId and rosterId required' }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const [playerStates, taxi, devy] = await Promise.all([
    prisma.devyPlayerState.findMany({ where: { leagueId, rosterId } }),
    prisma.devyTaxiSlot.findMany({ where: { leagueId, rosterId } }),
    prisma.devyDevySlot.findMany({ where: { leagueId, rosterId } }),
  ])

  const weekParam = req.nextUrl.searchParams?.get('week')
  const seasonParam = req.nextUrl.searchParams?.get('season')
  let weeklyScores: Awaited<ReturnType<typeof getWeeklyPointsBreakdownForRoster>> | null = null
  if (weekParam != null && seasonParam != null) {
    const week = Number(weekParam)
    const season = Number(seasonParam)
    if (Number.isFinite(week) && Number.isFinite(season) && week > 0) {
      weeklyScores = await getWeeklyPointsBreakdownForRoster(leagueId, rosterId, week, season)
    }
  }

  return NextResponse.json({ playerStates, taxiSlots: taxi, devySlots: devy, weeklyScores })
}

export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as {
    leagueId?: string
    rosterId?: string
    playerId?: string
    action?: string
    targetSlot?: 'active_starter' | 'active_bench'
  }
  const leagueId = body.leagueId?.trim()
  const rosterId = body.rosterId?.trim()
  const playerId = body.playerId?.trim()
  const action = body.action?.trim()
  if (!leagueId || !rosterId || !playerId || !action) {
    return NextResponse.json({ error: 'leagueId, rosterId, playerId, action required' }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  if (!(await canMoveRosterPlayers(leagueId, userId, rosterId))) {
    return NextResponse.json({ error: 'That team is not yours.', code: 'NOT_YOUR_TEAM' }, { status: 403 })
  }

  try {
    if (action === 'promote_to_active') {
      const slot = body.targetSlot ?? 'active_bench'
      if (slot !== 'active_starter' && slot !== 'active_bench') {
        return NextResponse.json({ error: 'Invalid targetSlot' }, { status: 400 })
      }
      const updated = await promoteToActive(leagueId, rosterId, playerId, slot)
      return NextResponse.json({ ok: true, playerState: updated })
    }
    if (action === 'move_to_taxi') {
      const taxi = await moveToTaxi(leagueId, rosterId, playerId)
      return NextResponse.json({ ok: true, taxiSlot: taxi })
    }
    if (action === 'move_to_bench') {
      const cur = await prisma.devyPlayerState.findUnique({
        where: { leagueId_rosterId_playerId: { leagueId, rosterId, playerId } },
      })
      if (!cur) return NextResponse.json({ error: 'Player state not found' }, { status: 404 })
      const st = await prisma.devyPlayerState.update({
        where: { leagueId_rosterId_playerId: { leagueId, rosterId, playerId } },
        data: {
          bucketState: 'active_bench',
          scoringEligibility: getScoringEligibility('active_bench', cur.playerType),
        },
      })
      return NextResponse.json({ ok: true, playerState: st })
    }
    if (action === 'move_to_ir') {
      const cur = await prisma.devyPlayerState.findUnique({
        where: { leagueId_rosterId_playerId: { leagueId, rosterId, playerId } },
      })
      if (!cur) return NextResponse.json({ error: 'Player state not found' }, { status: 404 })
      const st = await prisma.devyPlayerState.update({
        where: { leagueId_rosterId_playerId: { leagueId, rosterId, playerId } },
        data: {
          bucketState: 'ir',
          scoringEligibility: getScoringEligibility('ir', cur.playerType),
        },
      })
      return NextResponse.json({ ok: true, playerState: st })
    }
    if (action === 'move_to_devy') {
      const st = await prisma.devyPlayerState.update({
        where: { leagueId_rosterId_playerId: { leagueId, rosterId, playerId } },
        data: {
          bucketState: 'devy',
          playerType: 'devy',
          scoringEligibility: getScoringEligibility('devy', 'devy'),
        },
      })
      return NextResponse.json({ ok: true, playerState: st })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

