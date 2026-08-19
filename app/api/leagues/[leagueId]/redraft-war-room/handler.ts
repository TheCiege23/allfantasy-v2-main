/**
 * GET /api/leagues/[leagueId]/redraft-war-room
 *
 * Returns the canonical, deterministic Redraft AF War Room state for the viewer's
 * league: context (scoring/roster/standings/matchup/availability) plus the
 * deterministic team-needs summary for the viewer's own team.
 *
 * Auth: league member or commissioner. Personalized team data is scoped to the
 * viewer's own roster (commissioners additionally see league-wide team summaries).
 *
 * POST actions (waivers / trade-analyze / trade-find / lineup / ask) live in the
 * sibling dynamic `[action]/route.ts` — two files instead of six, to keep the
 * Vercel route count low.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { buildRedraftWarRoomContext } from '@/lib/redraft-war-room/redraftWarRoomContext'
import { evaluateUserTeamNeeds } from '@/lib/redraft-war-room/redraftTeamNeedsEngine'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params
  const user = await getCurrentUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await buildRedraftWarRoomContext({ leagueId, userId: user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const needs = evaluateUserTeamNeeds(result.context)

  // Members only get full per-player rosters for their own team + light summaries for others.
  const context = result.context
  if (!context.isCommissioner) {
    context.teams = context.teams.map((t) =>
      t.isUserTeam ? t : { ...t, players: [] },
    )
  }

  return NextResponse.json({ context, needs })
}
