import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { getTournamentTopPerformers } from '@/lib/tournament/topPerformers'

/**
 * The week's best performances across the tournament.
 *
 * ⚠ A 404 HERE MEANS "NOTHING INGESTED YET" AS WELL AS "NOT YOURS", and the body
 * says which — an empty leaderboard and an uncollected week look identical
 * otherwise, and only one of them is somebody's job to fix.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const url = new URL(request.url)
  const seasonRaw = Number(url.searchParams.get('season') ?? new Date().getFullYear())
  const weekRaw = url.searchParams.has('week') ? Number(url.searchParams.get('week')) : NaN
  const season = Number.isInteger(seasonRaw) && seasonRaw > 1900 ? seasonRaw : new Date().getFullYear()

  const result = await getTournamentTopPerformers({
    tournamentId,
    commissionerUserId: userId,
    season,
    week: Number.isInteger(weekRaw) && weekRaw > 0 ? weekRaw : undefined,
  })

  if (!result) {
    return NextResponse.json(
      {
        error:
          'No weekly scores collected for this tournament yet. Run the weekly ingest, then this fills in.',
      },
      { status: 404 },
    )
  }
  return NextResponse.json(result)
}
