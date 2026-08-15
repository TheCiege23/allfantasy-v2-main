import { NextResponse } from 'next/server'
import {
  getUnifiedRelationshipInsights,
  runRelationshipInsightOrchestrator,
} from '@/lib/relationship-insights'
import { normalizeOptionalSportForRelationship } from '@/lib/relationship-insights/SportRelationshipResolver'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    // Membership gate. Reachable both directly and via the [section]
    // dispatcher, and was open to anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response

    const url = new URL(req.url)
    const sport = normalizeOptionalSportForRelationship(url.searchParams?.get('sport'))
    const seasonParam = url.searchParams?.get('season')
    const season = seasonParam != null ? parseInt(seasonParam, 10) : null
    const limitParam = url.searchParams?.get('limit')
    const limit = limitParam != null ? Math.min(parseInt(limitParam, 10) || 25, 60) : 25
    const syncGraphRivalryEdges = url.searchParams?.get('syncGraphRivalryEdges') !== '0'

    const insights = await getUnifiedRelationshipInsights({
      leagueId,
      sport,
      season: Number.isNaN(season ?? NaN) ? null : season,
      limit,
      syncGraphRivalryEdges,
    })

    return NextResponse.json(insights)
  } catch (e) {
    console.error('[relationship-insights GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load relationship insights' },
      { status: 500 }
    )
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    // Membership gate. Reachable both directly and via the [section]
    // dispatcher, and was open to anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response

    const body = await req.json().catch(() => ({}))
    const seasonCandidate =
      typeof body?.season === 'number'
        ? body.season
        : typeof body?.season === 'string'
          ? parseInt(body.season, 10)
          : NaN
    const season = Number.isFinite(seasonCandidate) && !Number.isNaN(seasonCandidate) ? seasonCandidate : null
    const sport = normalizeOptionalSportForRelationship(body?.sport ?? null)

    const orchestration = await runRelationshipInsightOrchestrator({
      leagueId,
      sport,
      season,
      rebuildGraph: body?.rebuildGraph === true,
      runRivalry: body?.runRivalry !== false,
      runDrama: body?.runDrama !== false,
      runProfiles: body?.runProfiles === true,
      syncGraphRivalryEdges: body?.syncGraphRivalryEdges !== false,
    })

    const insights = await getUnifiedRelationshipInsights({
      leagueId,
      sport,
      season: orchestration.season,
      limit: 25,
      syncGraphRivalryEdges: false,
    })

    return NextResponse.json({
      orchestration,
      insights,
    })
  } catch (e) {
    console.error('[relationship-insights POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to refresh relationship insights' },
      { status: 500 }
    )
  }
}
