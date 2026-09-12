import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { prisma } from '@/lib/prisma'
import { finalizeAfLeagueTradeProcessing } from '@/lib/league-trade-engine/tradeService'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { evaluateTradeSettlementGuard } from '@/lib/sports-evidence/tradeSettlementGuard'
import {
  evaluateGenericTradeReversalReadiness,
  reverseGenericTrade,
} from '@/lib/league-trade-engine/tradeReversal'

export const dynamic = 'force-dynamic'

/** Commissioner (or post-veto window) — finalize processing for scheduled / awaiting_votes trades. */
export async function POST(
  req: NextRequest,
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

  /*
   * REVERSAL RIDES THIS ROUTE, AND NOT A NEW ONE.
   *
   * The standing instruction is that new endpoint work folds into an existing built route, and this
   * is the right one on its own merits: same trade, same commissioner gate, already the place a
   * commissioner acts on an individual trade. A reversal is opted into explicitly with
   * `{ action: 'reverse' }` — never the default — so an existing caller posting an empty body keeps
   * finalizing exactly as before.
   *
   * ⚠ `action: 'reverse_preflight'` EXISTS SO THE ANSWER CAN BE ASKED FOR WITHOUT ACTING. Reversal
   * overwrites two rosters; a UI that can only find out by trying is a UI that reverses by accident.
   */
  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string }

  if (body.action === 'reverse_preflight') {
    const readiness = await evaluateGenericTradeReversalReadiness(prisma, tradeId)
    return NextResponse.json({ readiness })
  }

  // Reject-only certified guard, re-evaluated immediately before authoritative settlement/persistence.
  const sports = await evaluateTradeSettlementGuard(leagueId, tradeId)
  if (sports.block) {
    return NextResponse.json({ error: `Trade blocked by certified game evidence: ${sports.reason}`, code: 'SPORTS_DATA_LOCK', sportsDataDecision: sports.decision }, { status: 409 })
  }

  /*
   * ⚠ REVERSAL SITS AFTER THE SPORTS-EVIDENCE GUARD, DELIBERATELY.
   *
   * It was written above it first, which would have let a reversal mutate rosters during a week the
   * certified-evidence lock has closed. Reversal writes rosters exactly as settlement does — points
   * have been scored against those lineups — so the same lock has to bind it. The guard is
   * reject-only, so this makes the destructive path refuse MORE readily, never less.
   *
   * The read-only `reverse_preflight` stays above it on purpose: asking whether a trade could be
   * reversed must keep working while the week is locked, or a commissioner cannot even see why.
   */
  if (body.action === 'reverse') {
    const reason = String(body.reason ?? '').trim()
    // A destructive, audited action has to say why. The column is NOT NULL and the row is the
    // permanent record of who undid what.
    if (!reason) {
      return NextResponse.json({ error: 'A reason is required to reverse a trade.' }, { status: 400 })
    }
    const result = await reverseGenericTrade({
      tradeId,
      actorUserId: userId,
      // The gate above already refused anyone who is not an elevated commissioner, so this is a
      // statement of fact rather than a claim being trusted from the request.
      actorRole: 'commissioner',
      reason,
    })
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Trade cannot be reversed', code: 'REVERSAL_BLOCKED', readiness: result.readiness },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: true, ...result })
  }


  try {
    await finalizeAfLeagueTradeProcessing({ tradeId, actorUserId: userId })
    return NextResponse.json({ ok: true, ...(sports.decision ? { sportsDataDecision: sports.decision } : {}) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
