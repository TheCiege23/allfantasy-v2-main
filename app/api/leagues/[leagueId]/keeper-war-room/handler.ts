/**
 * GET /api/leagues/[leagueId]/keeper-war-room
 *
 * Returns the canonical, deterministic Keeper AF War Room state for the viewer's league:
 * context (scoring/roster/keeper rules/values/costs/availability) plus the deterministic
 * keeper RECOMMENDATIONS + roster-needs-after-keepers for the viewer's own team.
 *
 * Auth: league member or commissioner. Personalized team data is scoped to the viewer's
 * own roster (commissioners additionally see league-wide team summaries).
 *
 * POST actions live in the sibling dynamic `[action]/route.ts` — two files, no route bloat.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { buildKeeperWarRoomContext } from '@/lib/keeper-war-room/keeperWarRoomContext'
import { recommendKeepers } from '@/lib/keeper-war-room/keeperRecommendationEngine'
import { evaluateUserKeeperRosterNeeds } from '@/lib/keeper-war-room/keeperRosterNeedsEngine'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params
  const user = await getCurrentUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await buildKeeperWarRoomContext({ leagueId, userId: user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const context = result.context
  const recommendations = context.userRosterId ? recommendKeepers(context, context.userRosterId) : null
  const needs = evaluateUserKeeperRosterNeeds(context)

  // Members only get full per-player rosters for their own team; others are light summaries.
  if (!context.isCommissioner) {
    context.teams = context.teams.map((t) => (t.isUserTeam ? t : { ...t, players: [] }))
  }

  return NextResponse.json({ context, recommendations, needs })
}
