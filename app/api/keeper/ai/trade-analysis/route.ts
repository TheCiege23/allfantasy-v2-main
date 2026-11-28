import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'
import { recordTradeSurfaceShadow } from '@/lib/decision-os/trade/surfaceShadow'
import { evaluateStoredTrade } from '@/lib/decision-os/trade/evaluateStoredTrade'
import { NO_LEAGUE_REASON } from '@/lib/decision-os/trade/evaluateTrade'
import type { TradeRef } from '@/lib/decision-os/trade/tradeRecord'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/keeper/ai/trade-analysis — THE grade for a keeper-league trade.
 *
 * History (AF_TRADE_UNIFICATION_BRIEF): this endpoint first returned a HARDCODED placeholder (B/B,
 * "counter") for every trade behind a paid entitlement, then an honest 501 `coming_soon`. It now grades
 * through the one canonical grader — `evaluateStoredTrade` → `evaluateTrade` → `createLeagueTradeGrader`
 * / `gradeDeal` — which applies the league's own concept rule. For a keeper league that is the keeper
 * option scale (`footballTradeFormatGrade.ts`: current value plus a one-season keeper option on each
 * player's verified keeper cost); where it cannot price that, the grade is WITHHELD with its reason.
 * This route computes no letter, value or verdict of its own.
 *
 * Body: `{ leagueId, trade: TradeRef }`, or the legacy `{ leagueId, tradeId }` (an AllFantasy-native
 * trade id). No league → an honest withheld answer, never a letter.
 */

const Ref = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('af'), tradeId: z.string().min(1).max(128) }),
  z.object({ kind: z.literal('redraft'), proposalId: z.string().min(1).max(128) }),
  z.object({ kind: z.literal('provider'), provider: z.literal('sleeper'), providerTradeId: z.string().min(1).max(128) }),
])
const Body = z.object({
  leagueId: z.string().trim().max(64).optional().nullable(),
  tradeId: z.string().min(1).max(128).optional(),
  trade: Ref.optional(),
})

/** A refusal is an answer ("can't grade it yet"), not an error — except not found / not yours. */
const STATUS_FOR: Record<string, number> = { not_member: 403, not_party: 403, not_found: 404 }

const KEEPER_TRADE_ANALYSIS_SURFACE = 'keeper-ai-trade-analysis'

export async function POST(req: NextRequest) {
  const gate = await requireAfSub()
  if (gate instanceof Response) return gate
  const userId = gate

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const ref: TradeRef | null = parsed.data.trade
    ? (parsed.data.trade as TradeRef)
    : parsed.data.tradeId
      ? { kind: 'af', tradeId: parsed.data.tradeId }
      : null
  if (!ref) return NextResponse.json({ error: 'trade or tradeId required' }, { status: 400 })

  const leagueId = parsed.data.leagueId?.trim() || null
  if (!leagueId) {
    recordTradeSurfaceShadow({ surface: 'keeper', userId, leagueId: null, surfaceVerdict: null, surfaceAnalysisMode: 'withheld_no_league' })
    return NextResponse.json({ available: false, status: 'withheld', reason: NO_LEAGUE_REASON, grade: null })
  }

  const result = await evaluateStoredTrade({ leagueId, ref, userId, surface: KEEPER_TRADE_ANALYSIS_SURFACE })
  if (!result.ok) {
    recordTradeSurfaceShadow({ surface: 'keeper', userId, leagueId, surfaceVerdict: null, surfaceAnalysisMode: `refused_${result.refusal.code}` })
    return NextResponse.json(
      { available: false, status: 'refused', reason: result.refusal.reason, refusal: result.refusal, grade: null },
      { status: STATUS_FOR[result.refusal.code] ?? 200 },
    )
  }

  const { receipt } = result
  const grade = receipt.grade
  recordTradeSurfaceShadow({
    surface: 'keeper',
    userId,
    leagueId,
    surfaceVerdict: grade.graded ? grade.letter : null,
    surfaceAnalysisMode: grade.graded ? 'canonical' : 'canonical_withheld',
  })

  return NextResponse.json({
    available: grade.graded,
    status: grade.graded ? 'graded' : 'withheld',
    reason: grade.graded ? null : grade.reason,
    /** THE grade, from the perspective side (the viewer's, when they are in the trade). */
    grade,
    partnerGrade: receipt.partnerGrade,
    receipt,
    perspectiveTeamId: result.perspectiveTeamId,
    viewerInTrade: result.viewerInTrade,
  })
}
