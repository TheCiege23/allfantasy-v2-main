import { requestedRosterIdFrom, resolveViewingRoster } from '@/lib/league/viewerTeams'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { evaluateLegalityForPersistedRoster } from '@/lib/roster-legality/loadLegalityEvaluationContext'

export const dynamic = 'force-dynamic'

/**
 * GET: full roster legality + lock snapshot for the caller's roster in this league.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  // The named team when the manager holds it, else their first; a co-owned team when they hold none.
  const viewing = await resolveViewingRoster(leagueId, userId, requestedRosterIdFrom(_req))
  const roster = viewing ? await prisma.roster.findFirst({ where: { leagueId, id: viewing.rosterId } }) : null
  if (!roster) {
    return NextResponse.json({ error: 'No roster for this user in this league.' }, { status: 404 })
  }

  const out = await evaluateLegalityForPersistedRoster({
    id: roster.id,
    leagueId,
    playerData: roster.playerData,
  })
  if (!out) {
    return NextResponse.json({ error: 'Could not evaluate roster legality.' }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    rosterId: roster.id,
    week: out.week,
    season: out.season,
    result: out.result,
  })
}
