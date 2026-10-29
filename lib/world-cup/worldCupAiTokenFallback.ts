import { preparePaidToolCharge, replayPaidToolRequest } from '@/lib/tokens/paidToolBilling'
import "server-only"
import { NextResponse } from "next/server"
import {
  TokenSpendRuleNotFoundError,
  TokenSpendService,
  type TokenLedgerEntryView,
  type TokenSpendPreview,
} from "@/lib/tokens/TokenSpendService"
import type { TokenSpendRuleCode } from "@/lib/tokens/constants"

export const WORLD_CUP_AI_TOKEN_RULES = {
  matchup: "world_cup_ai_matchup_analysis",
  bracketExplanation: "world_cup_ai_bracket_explanation",
  commissionerReport: "world_cup_ai_commissioner_report",
  chimmyCoaching: "world_cup_ai_chimmy_coaching",
  edgeReport: "world_cup_ai_edge_report",
} as const satisfies Record<string, TokenSpendRuleCode>

export type WorldCupAiTokenAccess =
  | {
      ok: true
      mode: "subscription"
      tokenPreview: null
      commitTokenSpend: null
    }
  | {
      ok: true
      mode: "tokens"
      tokenPreview: TokenSpendPreview
      commitTokenSpend: () => Promise<TokenLedgerEntryView>
    }
  | {
      ok: false
      response: NextResponse
    }

function insufficientTokenResponse(preview: TokenSpendPreview, upgradePath: string) {
  return NextResponse.json(
    {
      error: "Insufficient token balance",
      code: "insufficient_token_balance",
      message: `Need ${preview.tokenCost} token${preview.tokenCost === 1 ? "" : "s"} for this one-time World Cup AI action.`,
      upgrade: true,
      upgradePath,
      preview,
    },
    { status: 402 }
  )
}

function missingRuleResponse(ruleCode: string, upgradePath: string) {
  return NextResponse.json(
    {
      error: "Token fallback is temporarily unavailable for this World Cup AI action.",
      code: "token_spend_rule_missing",
      ruleCode,
      upgrade: true,
      upgradePath,
    },
    { status: 500 }
  )
}

export async function prepareWorldCupAiTokenFallback(input: {
  userId: string
  userEmail?: string | null
  entitled: boolean
  ruleCode: TokenSpendRuleCode
  confirmTokenSpend?: boolean
  sourceType: string
  sourceId: string
  idempotencyKey: string
  description: string
  metadata?: Record<string, unknown>
  upgradePath: string
}): Promise<WorldCupAiTokenAccess> {
  const replay = await replayPaidToolRequest(input.userId)
  if (replay) return { ok: false, response: replay }
  if (input.entitled) {
    return { ok: true, mode: "subscription", tokenPreview: null, commitTokenSpend: null }
  }

  const tokenSpendService = new TokenSpendService()
  let preview: TokenSpendPreview
  try {
    preview = await tokenSpendService.previewSpend(
      input.userId,
      input.ruleCode,
      input.userEmail ?? null
    )
  } catch (error) {
    if (error instanceof TokenSpendRuleNotFoundError) {
      return { ok: false, response: missingRuleResponse(input.ruleCode, input.upgradePath) }
    }
    throw error
  }

  if (!preview.canSpend) {
    return { ok: false, response: insufficientTokenResponse(preview, input.upgradePath) }
  }

  const prepared = await preparePaidToolCharge({
    ...input, confirmed: input.confirmTokenSpend === true, preview,
  })
  if (!prepared.ok) return prepared
  return { ok: true, mode: "tokens", tokenPreview: preview, commitTokenSpend: prepared.commit }
}
