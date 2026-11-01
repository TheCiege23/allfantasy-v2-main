import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMatchupPulse } from '@/lib/core-app/matchupPulse'

/**
 * Your win probability in each league this week, for the league list's odds bar.
 *
 * ⚠ THE SAME NUMBER THE MATCHUP BOARD PRINTS, BY CONSTRUCTION. It is `getMatchupPulse` — the
 * cross-league board's loader, which applies `forecastMatchup`'s rules (lib/core-app/matchupForecast.ts)
 * — read for its `oddsByLeague`. A second odds model for the list would disagree with the board about
 * the same game, which is the bug matchupForecast.ts was written to end.
 *
 * ⚠ FETCHED BY THE LIST AFTER IT PAINTS, NOT ON THE PAGE. The board is seven batched reads over the
 * whole portfolio; every /core page paying for it to draw a thin bar would be the wrong trade. The
 * client asks once when the list opens and keeps the answer for a few minutes (useRailOdds.ts).
 *
 * Postgres only — no provider call. Scoped to the signed-in user's own claimed teams by the loader.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } })
  try {
    const pulse = await getMatchupPulse(userId)
    return NextResponse.json(
      { odds: pulse.oddsByLeague ?? {}, liveNow: pulse.liveNow ?? false },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    )
  } catch {
    // No odds is a missing bar, never a wrong one.
    return NextResponse.json({ error: 'Odds unavailable' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
