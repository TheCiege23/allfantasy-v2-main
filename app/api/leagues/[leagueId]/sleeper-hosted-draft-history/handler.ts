import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMemberWithCode } from '@/lib/league/league-access'
import { fetchSleeperLeagueDraftChain } from '@/lib/sleeper/sync/sleeperHostedDraftHistory'

export const dynamic = 'force-dynamic'

/**
 * GET — Per-season Sleeper draft rows for the league's platform chain (settings → Draft results).
 * Authenticated league members only; Sleeper fetch happens server-side.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId?.trim()) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const access = await assertLeagueMemberWithCode(leagueId.trim(), userId)
  if (!access.ok) {
    return NextResponse.json({ error: 'Forbidden', code: access.code }, { status: access.httpStatus })
  }

  const league = access.league
  if (String(league.platform).toLowerCase() !== 'sleeper') {
    return NextResponse.json({ error: 'Not a Sleeper-hosted league' }, { status: 400 })
  }
  const platformLeagueId = league.platformLeagueId?.trim()
  if (!platformLeagueId) {
    return NextResponse.json({ error: 'Missing platform league id' }, { status: 400 })
  }

  try {
    const rows = await fetchSleeperLeagueDraftChain(platformLeagueId)
    return NextResponse.json({ rows })
  } catch (e) {
    console.error('[sleeper-hosted-draft-history]', e)
    return NextResponse.json({ error: 'Failed to load Sleeper draft history' }, { status: 502 })
  }
}
