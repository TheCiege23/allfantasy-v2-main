import { NextResponse } from 'next/server'
import { listRivalries } from '@/lib/rivalry-engine/RivalryQueryService'
import { runRivalryEngine } from '@/lib/rivalry-engine/RivalryEngine'
import { buildRivalryEngineSignals } from '@/lib/rivalry-engine/rivalryEngineInputs'
import { normalizeSportForRivalry } from '@/lib/rivalry-engine/SportRivalryResolver'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/rivalries
 * List rivalries for the league.
 * Query: sport, season, managerId, managerAId, managerBId, limit.
 */
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
    const sportRaw = url.searchParams?.get('sport')
    const sport = sportRaw ? (normalizeSportForRivalry(sportRaw) ?? undefined) : undefined
    const seasonParam = url.searchParams?.get('season')
    const season = seasonParam != null ? parseInt(seasonParam, 10) : undefined
    const managerId = url.searchParams?.get('managerId') ?? undefined
    const managerAId = url.searchParams?.get('managerAId') ?? undefined
    const managerBId = url.searchParams?.get('managerBId') ?? undefined
    const limitParam = url.searchParams?.get('limit')
    const limit = limitParam != null ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50

    const rivalries = await listRivalries(leagueId, {
      sport,
      season: Number.isNaN(season ?? NaN) ? undefined : season,
      managerId,
      managerAId,
      managerBId,
      limit,
    })
    return NextResponse.json({ leagueId, rivalries })
  } catch (e) {
    console.error('[rivalries GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to list rivalries' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/leagues/[leagueId]/rivalries
 * Run the rivalry engine for the league (detect, score, persist).
 * Body: { sport?, seasons? }.
 */
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

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { sport: true, season: true, settings: true, teams: { select: { externalId: true } } },
    })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    let body: { sport?: string; seasons?: number[] } = {}
    try {
      body = await req.json()
    } catch {
      // optional body
    }
    const sport = normalizeToSupportedSport(body.sport ?? league.sport ?? null)
    const seasons = Array.isArray(body.seasons) && body.seasons.length > 0
      ? body.seasons
      : [league.season ?? new Date().getFullYear()].filter(Boolean)

    const teamExternalIds = new Set(league.teams.map((t) => String(t.externalId)))
    const signals = await buildRivalryEngineSignals({
      leagueId,
      sport,
      seasons,
      teamExternalIds,
      leagueSettings: league.settings,
    })

    const result = await runRivalryEngine({ leagueId, sport, seasons, ...signals })

    return NextResponse.json({ leagueId, ...result })
  } catch (e) {
    console.error('[rivalries POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to run rivalry engine' },
      { status: 500 }
    )
  }
}
