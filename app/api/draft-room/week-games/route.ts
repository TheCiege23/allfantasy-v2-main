/**
 * GET /api/draft-room/week-games?sport=NBA — each team's games in the next seven days, for the
 * draft room's "My team" panel (NBA / NHL / MLB; football has bye weeks instead). Reads our stored
 * schedule only. Signed-in users only, like the rest of the draft room.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { scheduleSport } from '@/lib/draft-room/proTeamKey'
import { loadWeekGames } from '@/lib/draft-room/weekGamesServer'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sport = scheduleSport(req.nextUrl.searchParams.get('sport'))
  if (!sport) return NextResponse.json({ sport: null, teams: {} })

  try {
    const teams = await loadWeekGames(sport)
    return NextResponse.json(
      { sport, teams },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    )
  } catch (error) {
    console.warn('[draft-room/week-games] schedule unavailable', { sport, error: String(error) })
    return NextResponse.json({ sport, teams: {} })
  }
}
