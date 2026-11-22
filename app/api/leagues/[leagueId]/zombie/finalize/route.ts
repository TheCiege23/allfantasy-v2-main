/**
 * POST: Run weekly result finalization (infection, serum/weapon awards, winnings). PROMPT 353.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { isZombieLeague } from '@/lib/zombie/ZombieLeagueConfig'
import { finalizeWeek } from '@/lib/zombie/ZombieResultFinalizationService'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  // 🛑 A commissioner action (finalizing a week (infections, awards, winnings)). This checked league MEMBERSHIP, so any manager in the league could
  // run it (2026-11-16).
  const refused = await commissionerAccessResponse(leagueId, session.user.id, 'league')
  if (refused) return refused

  const isZombie = await isZombieLeague(leagueId)
  if (!isZombie) return NextResponse.json({ error: 'Not a zombie league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const week = typeof body.week === 'number' ? body.week : parseInt(String(body.week), 10)
  const season = typeof body.season === 'number' ? body.season : new Date().getFullYear()
  if (!Number.isFinite(week) || week < 1) {
    return NextResponse.json({ error: 'Invalid week' }, { status: 400 })
  }

  const zombieLeague = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    select: { id: true, universeId: true },
  })

  const result = await finalizeWeek({
    leagueId,
    week,
    season,
    zombieLeagueId: zombieLeague?.id ?? null,
  })

  return NextResponse.json({
    ok: true,
    leagueId,
    week,
    infectionCount: result.infectionCount,
    serumAwards: result.serumAwards,
    weaponAwards: result.weaponAwards,
  })
}
