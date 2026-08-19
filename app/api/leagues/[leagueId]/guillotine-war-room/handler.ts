/**
 * GET /api/leagues/[leagueId]/guillotine-war-room
 *
 * Returns the canonical, deterministic Guillotine AF War Room state for the viewer's league:
 * context (survival standings / elimination line / settings / availability) plus the
 * deterministic survival-risk + weekly survival plan for the viewer's own team.
 *
 * Auth: league member or commissioner. Personalized team data is scoped to the viewer's own
 * roster (commissioners additionally see league-wide team summaries).
 *
 * POST actions live in the sibling dynamic `[action]/route.ts` — two files, no route bloat.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { buildGuillotineWarRoomContext } from '@/lib/guillotine-war-room/guillotineWarRoomContext'
import { evaluateUserSurvivalRisk } from '@/lib/guillotine-war-room/guillotineSurvivalRiskEngine'
import { buildWeeklyPlan } from '@/lib/guillotine-war-room/guillotineWeeklyPlanEngine'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params
  const user = await getCurrentUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await buildGuillotineWarRoomContext({ leagueId, userId: user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const context = result.context
  const survival = evaluateUserSurvivalRisk(context)
  const weeklyPlan = context.userRosterId ? buildWeeklyPlan(context, context.userRosterId) : null

  // Members only get full per-player rosters for their own team; others are light summaries.
  // Survival standings (names + tiers) remain visible league-wide (public to the league).
  if (!context.isCommissioner) {
    context.teams = context.teams.map((t) => (t.isUserTeam ? t : { ...t, players: [] }))
  }

  return NextResponse.json({ context, survival, weeklyPlan })
}
