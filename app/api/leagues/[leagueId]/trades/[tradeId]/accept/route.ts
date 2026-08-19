import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { acceptAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'
import { evaluateTradeSettlementGuard } from '@/lib/fantasy-os/sports-runtime/tradeSettlementGuard'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; tradeId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId, tradeId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  // Reject-only certified guard, re-evaluated immediately before the authoritative acceptance/persistence.
  // Emits evidence; never grants permission; never blocks on its own today (engine does not enforce the
  // declared individual_game_time policy). Fails open on any error.
  const sports = await evaluateTradeSettlementGuard(leagueId, tradeId)
  if (sports.block) {
    return NextResponse.json({ error: `Trade blocked by certified game evidence: ${sports.reason}`, code: 'SPORTS_DATA_LOCK', sportsDataDecision: sports.decision }, { status: 409 })
  }

  try {
    const out = await acceptAfLeagueTrade({ tradeId, leagueId, userId })
    return NextResponse.json({ ok: true, ...out, ...(sports.decision ? { sportsDataDecision: sports.decision } : {}) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
