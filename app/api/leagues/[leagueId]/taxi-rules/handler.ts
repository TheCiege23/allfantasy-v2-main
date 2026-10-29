/**
 * The taxi squad's move rules (lib/taxi/taxiMoveRules.ts) for the Roster settings page.
 *
 *   GET  any member — the rules, whether they are enforced, and whether the viewer may change them
 *   PUT  commissioner with AF Commissioner — { enforced?, lockAfterWeek?, promotionDeadlineWeek?,
 *        lockBehavior?, inSeasonMoves?, postseasonMoves? }. The rules go to the dynasty config, the
 *        switch through the settings patch.
 *
 * The rules are enforced by the lineup saves themselves, not here.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { getLeagueRole } from '@/lib/league/permissions'
import { readTaxiRulesView, saveTaxiRules, type TaxiRulesSaveBody } from '@/lib/taxi/taxiRulesService'

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
  const role = await getLeagueRole(leagueId, userId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const view = await readTaxiRulesView(leagueId, { userId, isCommissioner: role === 'commissioner' || role === 'co_commissioner' })
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(view, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isCommissioner(leagueId, userId))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  const body = (await req.json().catch(() => null)) as TaxiRulesSaveBody | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const result = await saveTaxiRules(leagueId, userId, body)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}
