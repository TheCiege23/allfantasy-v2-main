/**
 * GET /api/leagues/[leagueId]/best-ball-war-room
 *
 * Returns the canonical, deterministic Best Ball AF War Room state for the viewer's league:
 * context (scoring/auto-lineup slots/settings/availability) plus the deterministic roster
 * construction + depth for the viewer's own team. Best ball is draft-only with an AUTOMATIC
 * lineup — there is NO start/sit data here by design.
 *
 * Auth: league member or commissioner. Personalized team data is scoped to the viewer's own
 * roster (commissioners additionally see league-wide team summaries).
 *
 * POST actions live in the sibling dynamic `[action]/route.ts` — two files, no route bloat.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { buildBestBallWarRoomContext } from '@/lib/best-ball-war-room/bestBallWarRoomContext'
import { evaluateUserRosterConstruction } from '@/lib/best-ball-war-room/bestBallRosterConstructionEngine'
import { evaluateDepth } from '@/lib/best-ball-war-room/bestBallDepthEngine'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params
  const user = await getCurrentUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await buildBestBallWarRoomContext({ leagueId, userId: user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const context = result.context
  /*
   * Roster construction is AF Legacy's `roster_construction_planning` (owner decision 2026-11-11). It
   * used to ride along with this state for everyone; without the plan it is left out and
   * `constructionLocked` tells the panel to show the lock. Depth and the rest of the state are unchanged.
   */
  const plan = await requireFeatureEntitlement({
    userId: user.id,
    userEmail: user.email,
    featureId: 'roster_construction_planning',
  })
  const constructionLocked = !plan.ok
  const construction = constructionLocked ? null : evaluateUserRosterConstruction(context)
  const depth = context.userRosterId ? evaluateDepth(context, context.userRosterId) : null

  // Members only get full per-player rosters for their own team; others are light summaries.
  if (!context.isCommissioner) {
    context.teams = context.teams.map((t) => (t.isUserTeam ? t : { ...t, players: [] }))
  }

  return NextResponse.json({ context, construction, depth, constructionLocked })
}
