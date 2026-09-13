/**
 * GET: Zombie universe standings (all leagues, status, points, winnings, movement). PROMPT 353.
 *
 * Restored. From 2026-04-09 (7840b87f7) until this change the file held a copy of
 * /api/zombie/whisperer, so the universe standings page received Whisperer-route responses.
 *
 * Readable by the universe owner and by members of any league in the universe. Each league's
 * Whisperer is disguised for a viewer who may not know it.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUniverseStandings } from '@/lib/zombie/ZombieUniverseStandingsService'
import { getMovementProjections } from '@/lib/zombie/ZombieMovementEngine'
import { resolveZombieUniverseAccess } from '@/lib/zombie/zombieUniverseAccess'
import { redactUniverseRowsForViewer } from '@/lib/zombie/zombieUniverseWhisperer'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  ctx: { params: Promise<{ universeId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { universeId } = await ctx.params
  if (!universeId) return NextResponse.json({ error: 'Missing universeId' }, { status: 400 })

  const access = await resolveZombieUniverseAccess(universeId, userId)
  if (!access.exists) return NextResponse.json({ error: 'Universe not found' }, { status: 404 })
  if (!access.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const seasonParam = new URL(req.url).searchParams.get('season')
  const parsedSeason = seasonParam ? Number.parseInt(seasonParam, 10) : Number.NaN
  const season = Number.isFinite(parsedSeason) ? parsedSeason : undefined

  const [standings, movement] = await Promise.all([
    getUniverseStandings(universeId, season),
    getMovementProjections(universeId, season),
  ])

  return NextResponse.json({
    universeId,
    season: season ?? new Date().getFullYear(),
    standings: await redactUniverseRowsForViewer(standings, { userId, isOwner: access.isOwner }),
    movementProjections: movement,
  })
}
