import { NextResponse } from 'next/server'
import { compareManagersReputation } from '@/lib/reputation-engine/ManagerTrustQueryService'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/reputation/compare
 * Query: managerAId, managerBId, sport?, season?
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
    const managerAId = String(url.searchParams?.get('managerAId') ?? '').trim()
    const managerBId = String(url.searchParams?.get('managerBId') ?? '').trim()
    if (!managerAId || !managerBId) {
      return NextResponse.json({ error: 'managerAId and managerBId are required' }, { status: 400 })
    }
    const sport = url.searchParams?.get('sport') ?? undefined
    const seasonRaw = url.searchParams?.get('season')
    const seasonParsed = seasonRaw != null ? parseInt(seasonRaw, 10) : NaN
    const season =
      Number.isFinite(seasonParsed) && !Number.isNaN(seasonParsed) ? seasonParsed : undefined

    const comparison = await compareManagersReputation(leagueId, managerAId, managerBId, {
      sport,
      season,
    })
    return NextResponse.json({
      leagueId,
      managerAId,
      managerBId,
      comparison,
    })
  } catch (e) {
    console.error('[reputation/compare GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to compare manager reputation' },
      { status: 500 }
    )
  }
}
