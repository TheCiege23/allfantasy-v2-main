import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league-access'
import { listDivisionsByLeague } from '@/lib/promotion-relegation'
import { isSupportedSport, normalizeToSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/divisions
 * Query: sport.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    try {
      await assertLeagueMember(leagueId, session.user.id)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(req.url)
    const sportRaw = url.searchParams?.get('sport')
    const sport =
      sportRaw == null
        ? undefined
        : isSupportedSport(sportRaw)
          ? normalizeToSupportedSport(sportRaw)
          : null
    if (sport === null) {
      return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
    }

    const divisions = await listDivisionsByLeague(leagueId, { sport })
    return NextResponse.json({ leagueId, divisions })
  } catch (e) {
    console.error('[divisions GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to list divisions' },
      { status: 500 }
    )
  }
}
