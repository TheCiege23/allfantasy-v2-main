/**
 * /api/leagues/[leagueId]/connected-leagues — the Commissioner Hub's "Connected leagues" pop-up (owner's
 * page review #16, Phase C4).
 *
 * GET   commissioner / co-commissioner of this league — `{ group }`: the Survivor islands, tournament
 *       round or Zombie universe this league belongs to (lib/league/connectedLeagues.ts), or `null`.
 *
 * Postgres only; no provider or AI call. Names, statuses and draft times only — nothing about any team.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { readConnectedGroup } from '@/lib/league/connectedLeagues'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canCommissionerAct(leagueId, userId, 'view'))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const group = await readConnectedGroup(leagueId, userId).catch(() => undefined)
  if (group === undefined) return NextResponse.json({ error: 'Could not read connected leagues' }, { status: 500 })
  return NextResponse.json({ group }, { headers: { 'Cache-Control': 'private, no-store' } })
}
