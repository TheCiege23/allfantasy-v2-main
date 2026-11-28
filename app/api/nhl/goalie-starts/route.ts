import { NextResponse } from 'next/server'
import { loadGoalieStarts } from '@/lib/nhl/goalieStartsLoad'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nhl/goalie-starts[?days=3]
 *
 * Projected starting goalies for the next `days` days of NHL games (lib/nhl/goalieStarts.ts) —
 * "projected" from our own box scores, "in net" once a game is under way. Never "confirmed": no
 * source we hold publishes confirmed starters before puck drop. Public schedule-level data, read from
 * Postgres only, shared-cached for a few minutes.
 */
export async function GET(req: Request) {
  const days = Number(new URL(req.url).searchParams.get('days'))
  try {
    const body = await loadGoalieStarts({ days: Number.isInteger(days) && days > 0 ? days : 3 })
    return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' } })
  } catch (e) {
    console.warn('[nhl/goalie-starts] read failed:', e instanceof Error ? e.name : 'unknown')
    return NextResponse.json({ error: 'Goalie projections are unavailable right now.' }, { status: 503 })
  }
}
