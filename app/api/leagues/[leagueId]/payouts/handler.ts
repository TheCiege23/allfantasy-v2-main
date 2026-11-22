/**
 * The payout calculator (lib/payouts): pot, weekly-prize set-aside, place split and each team's take.
 *
 *   GET  any member — the plan and what each team stands to collect; a commissioner also gets how
 *        much of the buy-in has been collected
 *   PUT  { buyIn, placePercents }  commissioner — through the settings patch, so the co-commissioner
 *        MONEY scope and the settings lock apply exactly as they do to dues and side-contest prizes
 *
 * AllFantasy tracks the money; it does not collect or pay it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { PAYOUT_PLAN_KEY, parsePayoutPlanInput } from '@/lib/payouts/payoutCalculator'
import { readPayoutsView } from '@/lib/payouts/payoutService'

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
  const result = await readPayoutsView(leagueId, userId)
  if (!result.ok) {
    const error = result.status === 404 ? 'Not found' : 'Forbidden'
    return NextResponse.json({ error }, { status: result.status })
  }
  const { ok: _ok, ...body } = result
  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = parsePayoutPlanInput(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  return executeLeagueSettingsPatch(userId, { leagueId, settingsMerge: { [PAYOUT_PLAN_KEY]: parsed.value } })
}
