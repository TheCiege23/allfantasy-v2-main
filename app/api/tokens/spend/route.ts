import { withPaidToolBilling, preparePaidToolCharge, replayPaidToolRequest } from '@/lib/tokens/paidToolBilling'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  TokenInsufficientBalanceError,
  TokenSpendConfirmationRequiredError,
  TokenSpendRuleNotFoundError,
  TokenSpendService,
} from "@/lib/tokens/TokenSpendService"

type SpendRequestBody = {
  ruleCode?: string
  confirmed?: boolean
  sourceType?: string
  sourceId?: string
  idempotencyKey?: string
  description?: string
  metadata?: Record<string, unknown>
}

export const dynamic = "force-dynamic"

async function paidToolPost(req: Request) {
  try {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string; email?: string | null }
    } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as SpendRequestBody
    const ruleCode = String(body.ruleCode ?? "").trim()
    if (!ruleCode) {
      return NextResponse.json({ error: "Missing ruleCode" }, { status: 400 })
    }

    const replay = await replayPaidToolRequest(session.user.id)
    if (replay) return replay
    const service = new TokenSpendService()
    const preview = await service.previewSpend(session.user.id, ruleCode, session.user.email)
    if (!preview.canSpend) return NextResponse.json({ code: 'insufficient_token_balance', error: 'Insufficient token balance', preview }, { status: 402 })
    const prepared = await preparePaidToolCharge({
      userId: session.user.id, userEmail: session.user.email, ruleCode, preview,
      confirmed: body.confirmed === true, sourceType: 'manual_token_spend',
      sourceId: body.sourceId ? String(body.sourceId) : null,
      description: body.description ? String(body.description) : null,
      metadata: body.metadata ?? null,
    })
    if (!prepared.ok) return prepared.response
    const ledger = await prepared.commit()

    return NextResponse.json({
      ok: true,
      ledger,
      currentBalance: ledger.balanceAfter,
    })
  } catch (error) {
    if (error instanceof TokenSpendRuleNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof TokenSpendConfirmationRequiredError) {
      return NextResponse.json(
        {
          error: "Token spend requires explicit confirmation.",
          code: "token_confirmation_required",
          ruleCode: error.ruleCode,
          requiredTokens: error.tokenCost,
        },
        { status: 409 }
      )
    }
    if (error instanceof TokenInsufficientBalanceError) {
      return NextResponse.json(
        {
          error: "Insufficient token balance",
          code: "insufficient_token_balance",
          requiredTokens: error.requiredTokens,
          currentBalance: error.currentBalance,
        },
        { status: 402 }
      )
    }
    console.error("[tokens/spend POST]", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "Failed to spend tokens" }, { status: 500 })
  }
}

export const POST = withPaidToolBilling(paidToolPost)
