/**
 * POST: Attach league to a zombie universe/level (create or update link). PROMPT 356.
 * Body: { universeId: string, levelId: string, name?: string, orderInLevel?: number }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { isZombieLeague } from '@/lib/zombie/ZombieLeagueConfig'
import { attachLeagueToUniverse } from '@/lib/zombie/ZombieUniverseConfig'
import { upsertZombieLeagueConfig } from '@/lib/zombie/ZombieLeagueConfig'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  // 🛑 A commissioner action (attaching the league to a universe). This checked league MEMBERSHIP, so any manager in the league could
  // run it (2026-11-16).
  const refused = await commissionerAccessResponse(leagueId, session.user.id, 'league')
  if (refused) return refused

  const isZombie = await isZombieLeague(leagueId)
  if (!isZombie) return NextResponse.json({ error: 'Not a zombie league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const universeId = typeof body.universeId === 'string' ? body.universeId.trim() : ''
  const levelId = typeof body.levelId === 'string' ? body.levelId.trim() : ''
  if (!universeId || !levelId) {
    return NextResponse.json({ error: 'Missing universeId or levelId' }, { status: 400 })
  }

  const universe = await prisma.zombieUniverse.findUnique({
    where: { id: universeId },
    select: { id: true },
  })
  if (!universe) return NextResponse.json({ error: 'Universe not found' }, { status: 404 })

  const level = await prisma.zombieUniverseLevel.findFirst({
    where: { id: levelId, universeId },
    select: { id: true },
  })
  if (!level) return NextResponse.json({ error: 'Level not found in universe' }, { status: 404 })

  const existing = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    select: { id: true },
  })

  if (existing) {
    await prisma.zombieLeague.update({
      where: { leagueId },
      data: {
        universeId,
        levelId,
        ...(body.name !== undefined && { name: body.name }),
        ...(typeof body.orderInLevel === 'number' && { orderInLevel: body.orderInLevel }),
      },
    })
  } else {
    await attachLeagueToUniverse({
      universeId,
      levelId,
      leagueId,
      name: body.name,
      orderInLevel: typeof body.orderInLevel === 'number' ? body.orderInLevel : 0,
    })
  }

  await upsertZombieLeagueConfig(leagueId, { universeId })

  return NextResponse.json({
    ok: true,
    leagueId,
    universeId,
    levelId,
    attached: true,
  })
}
