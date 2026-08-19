import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { finalizeAfLeagueTradeProcessing } from '@/lib/league-trade-engine/tradeService'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { evaluateTradeSettlementGuard } from '@/lib/fantasy-os/sports-runtime/tradeSettlementGuard'

export const dynamic = 'force-dynamic'

/** Commissioner (or post-veto window) — finalize processing for scheduled / awaiting_votes trades. */
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
  const elevated = await isElevatedCommissioner(leagueId, userId)
  if (!elevated) return NextResponse.json({ error: 'Commissioner access required' }, { status: 403 })

  // Reject-only certified guard, re-evaluated immediately before authoritative settlement/persistence.
  const sports = await evaluateTradeSettlementGuard(leagueId, tradeId)
  if (sports.block) {
    return NextResponse.json({ error: `Trade blocked by certified game evidence: ${sports.reason}`, code: 'SPORTS_DATA_LOCK', sportsDataDecision: sports.decision }, { status: 409 })
  }

  try {
    await finalizeAfLeagueTradeProcessing({ tradeId, actorUserId: userId })
    return NextResponse.json({ ok: true, ...(sports.decision ? { sportsDataDecision: sports.decision } : {}) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
