/**
 * The season rollover wizard (lib/season-rollover) for the Commissioner Hub.
 *
 *   GET   head commissioner — each step's state, what the renew will cancel, and (AF Commissioner)
 *         the drafted announcement and the dues-to-payouts carry
 *   POST  { action: 'carry_payouts' }  head commissioner with AF Commissioner — next season's dues
 *         become the payout buy-in, through the settings patch
 *   POST  { action: 'set_dues', amount }  dynasty, head commissioner — next season's dues, a fresh
 *         list with nobody marked paid (a redraft league sets them in its renew)
 *
 * The renew itself stays POST /api/commissioner/leagues/[id]/renew; a dynasty league's start stays
 * POST /api/leagues/[id]/season/start-new and its rookie draft the `create_next_draft` control.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { carryDuesIntoPayouts, readRolloverView, setNextSeasonDues } from '@/lib/season-rollover/rolloverService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

const errorFor = (status: number) => (status === 401 ? 'Unauthorized' : status === 404 ? 'Not found' : 'Forbidden')

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const result = await readRolloverView(leagueId, await sessionUserId())
  if (!result.ok) return NextResponse.json({ error: errorFor(result.status) }, { status: result.status })
  return NextResponse.json(result.view, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const body = (await req.json().catch(() => null)) as { action?: unknown; amount?: unknown } | null
  if (body?.action === 'set_dues') {
    const amount = body.amount == null || body.amount === '' ? null : Number(body.amount)
    if (amount != null && !Number.isFinite(amount)) return NextResponse.json({ error: 'Enter dues as a number.' }, { status: 400 })
    const result = await setNextSeasonDues(leagueId, await sessionUserId(), amount)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return result.response
  }
  if (body?.action !== 'carry_payouts') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  const result = await carryDuesIntoPayouts(leagueId, await sessionUserId())
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return result.response
}
