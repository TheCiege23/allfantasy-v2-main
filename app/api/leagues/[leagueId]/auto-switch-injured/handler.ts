/**
 * /api/leagues/[leagueId]/auto-switch-injured — "Auto-switch injured starters" on Member Settings
 * (lib/lineup-automation/autoSwitchInjuredService.ts).
 *
 * GET ?scope=league  commissioner / co-commissioner — every team's switch and whether its owner has Pro
 * GET                any league member — your own team's switch, so the Team tab can show it
 * POST { rosterId, on, level?, timing? }
 *                    the commissioner turns it on, changes it, or turns it off; the team's owner may
 *                    only turn it off (owner decision 2026-11-18)
 *
 * Postgres only; no provider or AI call.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueAccess } from '@/lib/league-access'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { readAutoSwitchForLeague, readMyAutoSwitch, setAutoSwitchInjured } from '@/lib/lineup-automation/autoSwitchInjuredService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function member(leagueId: string): Promise<{ userId: string } | NextResponse> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((await resolveLeagueAccess(leagueId, userId)) == null) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { userId }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const who = await member(leagueId)
  if (who instanceof NextResponse) return who
  const headers = { 'Cache-Control': 'private, no-store' }
  if (req.nextUrl.searchParams.get('scope') === 'league') {
    if (!(await canCommissionerAct(leagueId, who.userId, 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json(await readAutoSwitchForLeague(leagueId), { headers })
  }
  return NextResponse.json(await readMyAutoSwitch(leagueId, who.userId), { headers })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const who = await member(leagueId)
  if (who instanceof NextResponse) return who
  const body = (await req.json().catch(() => null)) as { rosterId?: unknown } | null
  const r = await setAutoSwitchInjured(leagueId, who.userId, body?.rosterId, body)
  return r.ok ? NextResponse.json({ setting: r.setting }) : NextResponse.json({ error: r.error }, { status: r.status })
}
