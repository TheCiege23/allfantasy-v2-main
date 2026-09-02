import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { attachRedraftLeague, commitRedraftPlan } from '@/lib/tournament/commitRedraft'

/**
 * Commit the redraft assignment, and attach the leagues once they exist.
 *
 * ⚠ TWO ACTIONS ON ONE ROUTE BECAUSE THEY ARE TWO HALVES OF ONE JOB, days apart:
 * commit records the decision, attach records the league a human then built on
 * the host platform. Neither creates anything on that platform.
 */
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  let body: { action?: string; tournamentLeagueId?: string; leagueId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.action === 'commit') {
    const result = await commitRedraftPlan({ tournamentId, commissionerUserId: userId })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({
      ...result,
      note: 'Recorded. Build these leagues on the host platform, import them, then attach each one here.',
    })
  }

  if (body.action === 'attach') {
    const tournamentLeagueId = String(body.tournamentLeagueId ?? '').trim()
    const leagueId = String(body.leagueId ?? '').trim()
    if (!tournamentLeagueId || !leagueId) {
      return NextResponse.json(
        { error: 'tournamentLeagueId and leagueId are both required.' },
        { status: 400 },
      )
    }
    const result = await attachRedraftLeague({
      tournamentId,
      commissionerUserId: userId,
      tournamentLeagueId,
      leagueId,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  }

  /* ⚠ An unrecognised action is refused, never treated as the harmless one. */
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
