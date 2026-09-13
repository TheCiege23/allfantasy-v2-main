/**
 * POST: Refresh universe movement projections (promotion/relegation watch). PROMPT 356.
 * Recomputes standings and upserts ZombieMovementProjection per roster.
 *
 * Restored. From 2026-04-09 (7840b87f7) until this change the file held a copy of
 * /api/zombie/whisperer.
 *
 * This writes projections for the whole universe, so only the universe owner may run it. The
 * original allowed any signed-in user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { refreshMovementProjections } from '@/lib/zombie/ZombieUniverseProjectionService'
import { resolveZombieUniverseAccess } from '@/lib/zombie/zombieUniverseAccess'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ universeId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { universeId } = await ctx.params
  if (!universeId) return NextResponse.json({ error: 'Missing universeId' }, { status: 400 })

  const access = await resolveZombieUniverseAccess(universeId, userId)
  if (!access.exists) return NextResponse.json({ error: 'Universe not found' }, { status: 404 })
  if (!access.isOwner) {
    return NextResponse.json({ error: 'Only the universe commissioner can refresh projections' }, { status: 403 })
  }

  const seasonParam = new URL(req.url).searchParams.get('season')
  const parsedSeason = seasonParam ? Number.parseInt(seasonParam, 10) : Number.NaN
  const season = Number.isFinite(parsedSeason) ? parsedSeason : undefined

  try {
    await refreshMovementProjections(universeId, season)
    return NextResponse.json({ ok: true, universeId, season: season ?? new Date().getFullYear() })
  } catch (e) {
    console.error('[zombie-universe/refresh]', e)
    return NextResponse.json(
      { error: 'Refresh failed', message: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
