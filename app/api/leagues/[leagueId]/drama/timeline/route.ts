import { NextResponse } from 'next/server'
import { buildTimelineForLeague } from '@/lib/drama-engine/DramaTimelineBuilder'
import { normalizeSportForDrama } from '@/lib/drama-engine/SportDramaResolver'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/drama/timeline
 * Get ordered timeline of drama events.
 * Query: sport, season, dramaType, relatedManagerId, relatedTeamId, relatedMatchupId, minScore, limit, offset.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    // Membership gate. This route was reachable by anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response

    const url = new URL(req.url)
    const sportRaw = url.searchParams?.get('sport')
    const sport = sportRaw ? (normalizeSportForDrama(sportRaw) ?? undefined) : undefined
    const seasonParam = url.searchParams?.get('season')
    const season = seasonParam != null ? parseInt(seasonParam, 10) : undefined
    const dramaType = url.searchParams?.get('dramaType') ?? undefined
    const relatedManagerId = url.searchParams?.get('relatedManagerId') ?? undefined
    const relatedTeamId = url.searchParams?.get('relatedTeamId') ?? undefined
    const relatedMatchupId = url.searchParams?.get('relatedMatchupId') ?? undefined
    const minScoreParam = url.searchParams?.get('minScore')
    const minScore = minScoreParam != null ? Number(minScoreParam) : undefined
    const limitParam = url.searchParams?.get('limit')
    const limit = limitParam != null ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50
    const offsetParam = url.searchParams?.get('offset')
    const offset = offsetParam != null ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0

    const timeline = await buildTimelineForLeague(leagueId, {
      sport,
      season: Number.isNaN(season ?? NaN) ? undefined : season,
      dramaType,
      relatedManagerId,
      relatedTeamId,
      relatedMatchupId,
      minScore: Number.isFinite(minScore ?? NaN) ? minScore : undefined,
      limit,
      offset,
    })
    return NextResponse.json({
      leagueId,
      sport: sport ?? null,
      season: season ?? null,
      dramaType: dramaType ?? null,
      offset,
      timeline,
    })
  } catch (e) {
    console.error('[drama/timeline GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to get timeline' },
      { status: 500 }
    )
  }
}
