/**
 * GET /api/leagues/[leagueId]/player-csv — "Download player CSV" (lib/league-export/playerPoolCsv.ts).
 * Any league member: it holds only what the league's own roster and waiver screens already show.
 *
 * A handler under the [section] dispatcher, not a route.ts (see that dispatcher's note).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { loadLeaguePlayerPoolCsv } from '@/lib/league-export/playerPoolCsvLoad'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  try {
    const out = await loadLeaguePlayerPoolCsv(leagueId)
    if (!out) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    return new NextResponse(out.csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${out.filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('[player-csv]', { leagueId, error: e instanceof Error ? e.message : 'unknown' })
    return NextResponse.json({ error: 'Could not build the player list. Try again in a minute.' }, { status: 500 })
  }
}
