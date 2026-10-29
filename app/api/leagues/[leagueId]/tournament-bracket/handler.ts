import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueAccess } from '@/lib/league-access'
import { loadLeagueBracketWeek } from '@/lib/tournament/divisions/divisionsStore'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/tournament-bracket?week=N — for a divisions conference league, the
 * tournament bracket round played in week N and each of this league's entrants' bracket opponents.
 * `{ bracket: null }` when the league is not a conference league or N is not a bracket week.
 * League members only (the canonical membership predicate). Reads Postgres only.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const week = Number(req.nextUrl.searchParams.get('week'))
  if (!Number.isInteger(week) || week < 1 || week > 52) return NextResponse.json({ error: 'week required' }, { status: 400 })
  if (!(await resolveLeagueAccess(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    return NextResponse.json({ bracket: await loadLeagueBracketWeek(leagueId, userId, week) })
  } catch (e) {
    console.warn('[tournament-bracket] could not load', e instanceof Error ? e.message : 'unknown error')
    return NextResponse.json({ error: 'The tournament bracket could not be loaded.' }, { status: 500 })
  }
}
