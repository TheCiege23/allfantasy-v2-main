import { NextResponse } from 'next/server'
import { listEvidenceForManager } from '@/lib/reputation-engine/ManagerTrustQueryService'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/reputation/evidence
 * Query: managerId (required), sport?, limit?.
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
    const managerId = url.searchParams?.get('managerId')
    if (!managerId) return NextResponse.json({ error: 'Missing managerId' }, { status: 400 })

    const sport = url.searchParams?.get('sport') ?? undefined
    const evidenceType = url.searchParams?.get('evidenceType') ?? undefined
    const seasonRaw = url.searchParams?.get('season')
    const seasonParsed = seasonRaw != null ? parseInt(seasonRaw, 10) : NaN
    const season =
      Number.isFinite(seasonParsed) && !Number.isNaN(seasonParsed) ? seasonParsed : undefined
    const limitParam = url.searchParams?.get('limit')
    const limit = limitParam != null ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50

    const evidence = await listEvidenceForManager(leagueId, managerId, {
      sport,
      season,
      evidenceType,
      limit,
    })
    return NextResponse.json({ leagueId, managerId, evidence })
  } catch (e) {
    console.error('[reputation/evidence GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to list evidence' },
      { status: 500 }
    )
  }
}
