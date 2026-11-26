/**
 * GET: a college basketball player's stored seasons and game log, for his player card
 * (lib/players/ncaabPlayerSeasons.ts). Postgres only. Query: playerId (the Rolling Insights id the
 * draft pool carries). Public player facts; signed-in users only, like the rest of the draft room.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isRollingInsightsPlayerId, loadNcaabPlayerSeasons } from '@/lib/players/ncaabPlayerSeasons'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const playerId = (req.nextUrl.searchParams.get('playerId') ?? '').trim()
  if (!isRollingInsightsPlayerId(playerId)) return NextResponse.json({ error: 'A player id is required' }, { status: 400 })

  try {
    const seasons = await loadNcaabPlayerSeasons(playerId)
    return NextResponse.json(seasons, { headers: { 'Cache-Control': 'private, max-age=300' } })
  } catch {
    return NextResponse.json({ error: 'Could not read this player' }, { status: 500 })
  }
}
