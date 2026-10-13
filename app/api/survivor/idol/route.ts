import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { transferIdol } from '@/lib/survivor/idolEngine'

import { survivorHostGuard } from '@/lib/survivor/survivorHostGuard'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const qUser = req.nextUrl.searchParams?.get('userId')?.trim()
  if (!leagueId || !qUser) return NextResponse.json({ error: 'leagueId and userId required' }, { status: 400 })
  if (qUser !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const idols = await prisma.survivorIdol.findMany({
    where: { leagueId, currentOwnerUserId: userId },
  })
  return NextResponse.json({ idols })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { intent?: string; idolId?: string; toUserId?: string; leagueId?: string; targetUserId?: string; powerType?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.intent === 'transfer' && body.idolId && body.toUserId) {
    try {
      await transferIdol(body.idolId, userId, body.toUserId, 'user_transfer')
      return NextResponse.json({ ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
  }

  if (body.intent === 'assign' && body.leagueId && body.targetUserId && body.powerType) {
    const gate = await assertLeagueCommissioner(body.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const denied = await survivorHostGuard(body.leagueId, userId)
    if (denied) return denied
    const league = await prisma.league.findUnique({ where: { id: body.leagueId }, select: { sport: true, settings: true } })
    const leagueSettings = league?.settings as Record<string, unknown> | null
    if (String(league?.sport ?? '').toUpperCase() === 'NBA' && leagueSettings?.survivorFoundationSettingsVersion === 1) {
      return NextResponse.json({ error: 'NBA Survivor idols must be seeded onto drafted players by the system.' }, { status: 409 })
    }
    const cfg = await prisma.survivorLeagueConfig.findUnique({ where: { leagueId: body.leagueId } })
    if (!cfg) return NextResponse.json({ error: 'No survivor config' }, { status: 400 })
    const roster = await prisma.roster.findFirst({
      where: { leagueId: body.leagueId, platformUserId: body.targetUserId },
    })
    if (!roster) return NextResponse.json({ error: 'Roster not found for user' }, { status: 400 })
    await prisma.survivorIdol.create({
      data: {
        leagueId: body.leagueId,
        configId: cfg.id,
        rosterId: roster.id,
        playerId: 'commissioner_grant',
        powerType: body.powerType,
        powerLabel: body.powerType,
        currentOwnerUserId: body.targetUserId,
        originalOwnerUserId: body.targetUserId,
      },
    })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
}

