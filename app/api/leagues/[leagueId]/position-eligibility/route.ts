/**
 * Commissioner position eligibility (NBA).
 *
 *   GET  — any league member: every rostered player's listed / added / removed positions, this
 *          season's box-score evidence, and the full change log. The log is public to the league on
 *          purpose: a commissioner change that only the commissioner can see is how trust is lost.
 *   POST — a commissioner with the `rosters` area: { playerId, position, action: add|remove|reset, reason }.
 *
 * DB-only. The evidence is read from `player_game_stats`, which the worker's live tick writes; this
 * route never calls a provider.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { canCommissionerAct, commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { planEligibilityChange } from '@/lib/league-eligibility/nbaPositionEligibility'
import {
  appendEligibilityChange,
  leagueSupportsPositionEligibility,
  loadEligibilityChanges,
  loadEligibilityPanel,
  loadLeagueRosteredPlayers,
} from '@/lib/league-eligibility/positionEligibilityStore'

export const dynamic = 'force-dynamic'

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

async function leagueSport(leagueId: string): Promise<string | null> {
  const league = await prisma.league.findFirst({ where: { id: leagueId }, select: { sport: true } })
  return league ? String(league.sport) : null
}

export async function GET(_req: Request, { params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const member = await assertLeagueMember(leagueId, userId)
  if (!member.ok) return NextResponse.json({ error: 'Not a member of this league' }, { status: member.status })
  if (!leagueSupportsPositionEligibility(String(member.league.sport))) {
    return NextResponse.json({ error: 'Position eligibility is available for NBA leagues.' }, { status: 404 })
  }
  const [panel, canEdit] = await Promise.all([
    loadEligibilityPanel(leagueId),
    canCommissionerAct(leagueId, userId, 'rosters'),
  ])
  return NextResponse.json({ ...panel, canEdit })
}

export async function POST(req: Request, { params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const refused = await commissionerAccessResponse(leagueId, userId, 'rosters')
  if (refused) return refused
  if (!leagueSupportsPositionEligibility(await leagueSport(leagueId))) {
    return NextResponse.json({ error: 'Position eligibility is available for NBA leagues.' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const playerId = typeof body?.playerId === 'string' ? body.playerId.trim() : ''
  if (!playerId) return NextResponse.json({ error: 'Pick a player.' }, { status: 400 })

  // Only a player on a roster in THIS league: the log must never name someone the league cannot see.
  const players = await loadLeagueRosteredPlayers(leagueId)
  const player = players.find((p) => p.id === playerId)
  if (!player) return NextResponse.json({ error: 'That player is not on a roster in this league.' }, { status: 404 })

  const history = (await loadEligibilityChanges(leagueId)).filter((c) => c.playerId === playerId)
  const plan = planEligibilityChange({
    playerId,
    playerName: player.name,
    listedRaw: player.listedRaw,
    history,
    position: body?.position,
    action: body?.action,
    reason: body?.reason,
  })
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 })

  await appendEligibilityChange(leagueId, { ...plan.change, actorUserId: userId })
  return NextResponse.json({ ok: true, effective: plan.next.effective })
}
