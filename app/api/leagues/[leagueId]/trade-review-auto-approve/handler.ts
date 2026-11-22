/**
 * "Trades don't wait forever" (lib/league-trade-engine/tradeReviewAutoApprove.ts): the commissioner's
 * opt-in to approve an unflagged trade still awaiting their review 48 hours after acceptance.
 *
 *   POST  { on: boolean }  through the league settings save, so the co-commissioner permissions, the
 *         settings lock and the audit log all apply
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { TRADE_REVIEW_AUTO_APPROVE_KEY } from '@/lib/league-trade-engine/tradeReviewAutoApprove'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { on?: unknown } | null
  if (!body || typeof body.on !== 'boolean') return NextResponse.json({ error: 'Send on: true or false.' }, { status: 400 })
  return executeLeagueSettingsPatch(userId, { leagueId, settingsMerge: { [TRADE_REVIEW_AUTO_APPROVE_KEY]: body.on } })
}
