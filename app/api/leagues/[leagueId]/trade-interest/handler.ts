/**
 * /api/leagues/[leagueId]/trade-interest — the AF crest (lib/league/tradeInterest.ts).
 *
 * GET  → { available, counts: { playerId: n }, mine: playerId[] } — counts are anonymous.
 * POST { playerId, interested } → { ok, count } — marks or unmarks one player for the viewer.
 *
 * League members only (resolveLeagueAccess). Postgres only; no provider or AI call.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueAccess } from '@/lib/league-access'
import { readTradeInterest, setTradeInterest, validPlayerId } from '@/lib/league/tradeInterest'

export const dynamic = 'force-dynamic'

async function viewer(leagueId: string): Promise<{ userId: string } | NextResponse> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((await resolveLeagueAccess(leagueId, userId)) == null) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { userId }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const who = await viewer(leagueId)
  if (who instanceof NextResponse) return who
  return NextResponse.json(await readTradeInterest(leagueId, who.userId), { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const who = await viewer(leagueId)
  if (who instanceof NextResponse) return who
  const body = (await req.json().catch(() => null)) as { playerId?: unknown; interested?: unknown } | null
  if (!validPlayerId(body?.playerId) || typeof body?.interested !== 'boolean') {
    return NextResponse.json({ error: 'playerId and interested are required' }, { status: 400 })
  }
  const result = await setTradeInterest({ leagueId, userId: who.userId, playerId: body.playerId, interested: body.interested })
  if (result.ok) return NextResponse.json(result)
  return NextResponse.json({ ok: false, unavailable: result.unavailable }, { status: result.unavailable ? 503 : 500 })
}
