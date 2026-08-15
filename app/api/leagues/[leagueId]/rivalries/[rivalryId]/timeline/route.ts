import { NextResponse } from 'next/server'
import { buildTimelineForRivalry } from '@/lib/rivalry-engine/RivalryTimelineBuilder'
import { prisma } from '@/lib/prisma'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/rivalries/[rivalryId]/timeline
 * Get timeline events for a rivalry.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string; rivalryId: string }> }
) {
  try {
    const { leagueId, rivalryId } = await ctx.params
    // Membership gate. This route was reachable by anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response
    if (!rivalryId) return NextResponse.json({ error: 'Missing rivalryId' }, { status: 400 })

    const rivalry = await prisma.rivalryRecord.findFirst({
      where: { id: rivalryId, leagueId },
    })
    if (!rivalry) return NextResponse.json({ error: 'Rivalry not found' }, { status: 404 })

    const url = new URL(req.url)
    const seasonParam = url.searchParams?.get('season')
    const season = seasonParam != null ? parseInt(seasonParam, 10) : null
    const limitParam = url.searchParams?.get('limit')
    const limit = limitParam != null ? Math.min(parseInt(limitParam, 10) || 200, 500) : 200

    const timeline = await buildTimelineForRivalry(rivalryId)
    const filtered = timeline
      .filter((e) => (season == null || Number.isNaN(season) ? true : e.season === season))
      .slice(0, limit)
    return NextResponse.json({ rivalryId, leagueId, timeline: filtered })
  } catch (e) {
    console.error('[rivalries/[rivalryId]/timeline GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to get timeline' },
      { status: 500 }
    )
  }
}
