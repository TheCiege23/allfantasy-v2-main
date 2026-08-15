import { NextResponse } from 'next/server'
import { getRivalryById } from '@/lib/rivalry-engine/RivalryQueryService'
import { listDramaEvents } from '@/lib/drama-engine/DramaQueryService'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/rivalries/[rivalryId]
 * Get a single rivalry by id.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string; rivalryId: string }> }
) {
  try {
    const { leagueId, rivalryId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    // Membership gate. This route was reachable by anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response
    if (!rivalryId) return NextResponse.json({ error: 'Missing rivalryId' }, { status: 400 })

    const rivalry = await getRivalryById(rivalryId)
    if (!rivalry || rivalry.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Rivalry not found' }, { status: 404 })
    }

    const linkedDrama = await listDramaEvents(leagueId, {
      sport: rivalry.sport,
      limit: 30,
    }).then((rows) =>
      rows.filter((row) => {
        const managerHit =
          row.relatedManagerIds.includes(rivalry.managerAId) &&
          row.relatedManagerIds.includes(rivalry.managerBId)
        const teamHit =
          row.relatedTeamIds.includes(rivalry.managerAId) &&
          row.relatedTeamIds.includes(rivalry.managerBId)
        return managerHit || teamHit
      })
    )

    return NextResponse.json({
      ...rivalry,
      linkedDramaCount: linkedDrama.length,
      linkedDramaEventIds: linkedDrama.slice(0, 6).map((row) => row.id),
    })
  } catch (e) {
    console.error('[rivalries/[rivalryId] GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to get rivalry' },
      { status: 500 }
    )
  }
}
