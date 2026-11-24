import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { movePlayer } from '@/lib/c2c/rosterEngine'
import { c2cPlayerWeekPoints } from '@/lib/c2c/playerWeekPoints'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const rosterId = req.nextUrl.searchParams?.get('rosterId')?.trim()
  if (!leagueId || !rosterId) return NextResponse.json({ error: 'leagueId and rosterId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const rows = await prisma.c2CPlayerState.findMany({ where: { leagueId, rosterId } })
  const byBucket = {
    campusStarters: rows.filter((r) => r.bucketState === 'campus_starter'),
    cantonStarters: rows.filter((r) => r.bucketState === 'canton_starter'),
    bench: rows.filter((r) => r.bucketState === 'bench'),
    taxi: rows.filter((r) => r.bucketState === 'taxi'),
    devy: rows.filter((r) => r.bucketState === 'devy'),
    ir: rows.filter((r) => r.bucketState === 'ir'),
  }
  // This week's stored points per player, when the screen names a week (2026-11-23): the same PlayerWeeklyScore rows
  // the C2C score engine sums, so a card's number adds up to the side's total. A player with no stored row is
  // absent from the map (no college stats are ingested yet), never a fabricated 0.
  const week = Number(req.nextUrl.searchParams?.get('week'))
  const season = Number(req.nextUrl.searchParams?.get('season'))
  const points = Number.isInteger(week) && week > 0 && Number.isInteger(season) && season > 0
    ? await c2cPlayerWeekPoints(rows, week, season)
    : undefined
  return NextResponse.json({ roster: byBucket, raw: rows, ...(points ? { points } : {}) })
}

export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId : ''
  const rosterId = typeof body?.rosterId === 'string' ? body.rosterId : ''
  const playerId = typeof body?.playerId === 'string' ? body.playerId : ''
  const targetBucket = typeof body?.targetBucket === 'string' ? body.targetBucket : ''
  if (!leagueId || !rosterId || !playerId || !targetBucket) {
    return NextResponse.json({ error: 'leagueId, rosterId, playerId, targetBucket required' }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  try {
    const updated = await movePlayer(leagueId, rosterId, playerId, targetBucket)
    return NextResponse.json({ player: updated })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

