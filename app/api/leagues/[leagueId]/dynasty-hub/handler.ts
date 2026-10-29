/**
 * GET /api/leagues/[leagueId]/dynasty-hub
 *
 * The viewer's own taxi squad and future picks for the league's Dynasty tab (`DynastyHome`).
 *
 * 🛑 THAT TAB FETCHED `/dynasty/taxi` AND `/dynasty/picks`, WHICH NEVER EXISTED. Both 404'd, the
 * component fell back to `{ taxi: [] }` / `{ picks: [] }`, and every dynasty league in every sport
 * showed "No players on taxi squad" and "No future draft picks" regardless of its real roster.
 *
 * Reads through the same deterministic context the War Room uses, so taxi slots and pick capital
 * (native `future_draft_picks` or the imported-pick inventory) agree with what the War Room shows.
 * No AI call. Scoped to the viewer's own team only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { buildDynastyWarRoomContext } from '@/lib/dynasty-war-room/dynastyWarRoomContext'

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
  const myTeam = context.teams.find((t) => t.isUserTeam) ?? null
  if (!myTeam) {
    return NextResponse.json({ taxi: [], picks: [], hasTeam: false, picksState: context.availability.futurePicks })
  }

  const teamNameByRosterId = new Map(context.teams.map((t) => [t.rosterId, t.teamName ?? t.ownerName]))

  const taxi = myTeam.players
    .filter((p) => p.slotType === 'taxi')
    .map((p) => ({
      id: p.playerId,
      name: p.playerName,
      position: p.position,
      team: p.team,
      age: p.age,
      // Not derivable here without each player's pro-experience year; null rather than a guess.
      eligibilityYearsLeft: null as number | null,
    }))

  const picks = myTeam.picks
    .slice()
    .sort((a, b) => a.season - b.season || a.round - b.round)
    .map((pk) => {
      const own = !pk.originalRosterId || pk.originalRosterId === myTeam.rosterId
      return {
        id: pk.id,
        year: pk.season,
        round: pk.round,
        type: own ? ('own' as const) : ('incoming' as const),
        fromTeam: own
          ? null
          : (pk.originalTeamName ?? (pk.originalRosterId ? teamNameByRosterId.get(pk.originalRosterId) : null) ?? null),
      }
    })

  return NextResponse.json({
    taxi,
    picks,
    hasTeam: true,
    picksState: context.availability.futurePicks,
  })
}
