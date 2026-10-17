import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { evaluateStoredTrade } from '@/lib/decision-os/trade/evaluateStoredTrade'
import type { TradeRef } from '@/lib/decision-os/trade/tradeRecord'

/**
 * POST /api/trades/evaluate — grade an EXISTING trade by reference and return its receipt.
 * Design build-order step 2 (`docs/TRADE_EVALUATOR_DESIGN.md`): the route that turns a stored trade
 * into one saved `evaluateTrade()` receipt. Screens reading receipts is step 5; nothing calls this
 * from the UI yet.
 *
 * Body: `{ leagueId, trade: { kind: 'af', tradeId } | { kind: 'redraft', proposalId }
 *                         | { kind: 'provider', provider: 'sleeper', providerTradeId } }`
 *
 * Membership, and privacy of a pending offer, are enforced inside `loadTrade` — not here — so every
 * caller of the engine gets the same gate.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Ref = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('af'), tradeId: z.string().min(1).max(128) }),
  z.object({ kind: z.literal('redraft'), proposalId: z.string().min(1).max(128) }),
  z.object({ kind: z.literal('provider'), provider: z.literal('sleeper'), providerTradeId: z.string().min(1).max(128) }),
])
const Body = z.object({ leagueId: z.string().min(1).max(64), trade: Ref })

/** A refusal is an answer ("can't evaluate yet"), not an error — except not found / not yours. */
const STATUS_FOR: Record<string, number> = { not_member: 403, not_party: 403, not_found: 404 }

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = rateLimit(`trades-evaluate:${userId}`, 30, 60_000)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const result = await evaluateStoredTrade({
    leagueId: parsed.data.leagueId,
    ref: parsed.data.trade as TradeRef,
    userId,
    surface: 'trades-evaluate-api',
  })
  if (!result.ok) {
    return NextResponse.json({ ok: false, refusal: result.refusal }, { status: STATUS_FOR[result.refusal.code] ?? 200 })
  }
  return NextResponse.json({
    ok: true,
    receipt: result.receipt,
    trade: result.trade,
    perspectiveTeamId: result.perspectiveTeamId,
    viewerInTrade: result.viewerInTrade,
  })
}
