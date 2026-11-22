/**
 * POST: Nominate a player (auction draft). Puts player on the block and starts bid timer.
 * Body: { playerName, position, team?, playerId?, byeWeek? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { namedRosterId, resolveAuctionActor } from '@/lib/live-draft-engine/auction/multiTeamAuction'
import { nominatePlayer } from '@/lib/live-draft-engine/auction/AuctionEngine'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { rosterConfigurationIncompleteBody } from '@/lib/league/roster-configuration-gate-error'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  // A manager with several teams nominates for the team named, else their team whose turn it is
  // (lib/live-draft-engine/auction/multiTeamAuction.ts).
  const actor = await resolveAuctionActor({ leagueId, userId, purpose: 'nominate', requestedRosterId: namedRosterId(req, body) })
  if (!actor.ok) {
    return NextResponse.json({ error: actor.error, code: actor.code, ...(actor.code === 'TEAM_REQUIRED' ? { rosterIds: actor.rosterIds } : {}) }, { status: actor.status })
  }
  const rosterId = actor.rosterId

  const playerName = body.playerName ?? body.player_name
  const position = body.position ?? ''
  if (!playerName) return NextResponse.json({ error: 'playerName required' }, { status: 400 })

  const result = await nominatePlayer(leagueId, {
    playerName: String(playerName).trim(),
    position: String(position).trim(),
    team: body.team ?? null,
    playerId: body.playerId ?? body.player_id ?? null,
    byeWeek: body.byeWeek ?? body.bye_week ?? null,
  }, rosterId)

  if (!result.success) {
    const status = result.code === 'ROSTER_CONFIGURATION_INCOMPLETE' ? 409 : 400
    if (result.code === 'ROSTER_CONFIGURATION_INCOMPLETE') {
      return NextResponse.json(rosterConfigurationIncompleteBody({ leagueId, message: result.error }), { status })
    }
    return NextResponse.json({ error: result.error }, { status })
  }

  const updated = await buildSessionSnapshot(leagueId)
  return NextResponse.json({ ok: true, session: updated })
}
