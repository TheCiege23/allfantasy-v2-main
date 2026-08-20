/**
 * GET /api/leagues/[leagueId]/dynasty-war-room
 *
 * Returns the canonical, deterministic Dynasty AF War Room state for the viewer's
 * league: context (scoring/roster/values/ages/availability) plus the deterministic
 * team-direction (contention window) and roster-needs summary for the viewer's own
 * team. Dynasty horizon — long-term value + age, not weekly projections.
 *
 * Auth: league member or commissioner. Personalized team data is scoped to the
 * viewer's own roster (commissioners additionally see league-wide team summaries).
 *
 * POST actions (lineup / waivers / trade-analyze / trade-find / buy-sell-hold /
 * team-direction / ask) live in the sibling dynamic `[action]/route.ts` — two files
 * instead of seven, to keep the Vercel route count low.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { buildDynastyWarRoomContext } from '@/lib/dynasty-war-room/dynastyWarRoomContext'
import { evaluateUserDynastyTeamNeeds } from '@/lib/dynasty-war-room/dynastyRosterNeedsEngine'
import { evaluateUserDynastyDirection } from '@/lib/dynasty-war-room/dynastyTeamDirectionEngine'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params
  const user = await getCurrentUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await buildDynastyWarRoomContext({ leagueId, userId: user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const context = result.context
  const direction = evaluateUserDynastyDirection(context)
  const needs = evaluateUserDynastyTeamNeeds(context)

  // Members only get full per-player rosters/picks for their own team; others are
  // light summaries (no cross-roster leakage). Commissioners see league-wide.
  if (!context.isCommissioner) {
    context.teams = context.teams.map((t) =>
      t.isUserTeam ? t : { ...t, players: [], picks: [] },
    )
  }

  return NextResponse.json({ context, direction, needs })
}
