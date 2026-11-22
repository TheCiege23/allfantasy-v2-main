/**
 * Taxi stealing (lib/taxi/taxiStealing.ts): claim a player off another team's taxi squad; the owner
 * protects them by promoting them, or loses them when the window closes. AF Commissioner.
 *
 *   GET   a team in the league or a commissioner — the rule, every claimable taxi player, the
 *         claims on the viewer's players and the viewer's own claims
 *   POST  { action: 'claim', playerId }     a team; one open claim per player
 *         { action: 'protect', claimId }    the owner; promotes the player to the active roster
 *         { action: 'release', claimId }    the owner; the player moves to the claimer now
 *         { action: 'withdraw', claimId }   the claimer
 *         { action: 'rule', rule }          through the league settings save, so the plan check, the
 *                                           co-commissioner permissions, the settings lock and the
 *                                           audit log all apply
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { TAXI_STEALING_KEY } from '@/lib/taxi/taxiStealing'
import {
  claimTaxiPlayer,
  protectTaxiPlayer,
  readTaxiStealView,
  releaseTaxiPlayer,
  withdrawTaxiClaim,
  type StealResult,
} from '@/lib/taxi/taxiStealingService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await readTaxiStealView(leagueId, userId)
  if (!r.ok) return NextResponse.json({ error: r.status === 404 ? 'League not found' : 'Forbidden' }, { status: r.status })
  return NextResponse.json(r.view, { headers: { 'Cache-Control': 'private, no-store' } })
}

function reply(r: StealResult) {
  if (!r.ok) return NextResponse.json({ error: r.error, ...(r.code ? { code: r.code } : {}) }, { status: r.status })
  return NextResponse.json({ ok: true, status: r.claim.status, deadline: r.claim.deadline })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  switch (body?.action) {
    case 'claim':
      return reply(await claimTaxiPlayer(leagueId, userId, { playerId: body.playerId }))
    case 'protect':
      return reply(await protectTaxiPlayer(leagueId, userId, { claimId: body.claimId }))
    case 'release':
      return reply(await releaseTaxiPlayer(leagueId, userId, { claimId: body.claimId }))
    case 'withdraw':
      return reply(await withdrawTaxiClaim(leagueId, userId, { claimId: body.claimId }))
    case 'rule':
      if (!('rule' in body)) return NextResponse.json({ error: 'Send the rule to save.' }, { status: 400 })
      return executeLeagueSettingsPatch(userId, { leagueId, settingsMerge: { [TAXI_STEALING_KEY]: body.rule } })
    default:
      return NextResponse.json({ error: "Send an action: 'claim', 'protect', 'release', 'withdraw' or 'rule'." }, { status: 400 })
  }
}
