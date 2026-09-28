import { NextResponse } from 'next/server'
import type { FeatureGateDecision } from '@/lib/subscription/FeatureGateService'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'
import type { TokenLedgerEntryView, TokenSpendPreview } from '@/lib/tokens/TokenSpendService'
import {
  TokenInsufficientBalanceError,
  TokenSpendConfirmationRequiredError,
  TokenSpendRuleNotFoundError,
  TokenSpendService,
} from '@/lib/tokens/TokenSpendService'
import type { TokenSpendRuleCode } from '@/lib/tokens/constants'
import { getFeatureTokenFallbackRule } from '@/lib/subscription/feature-gate-matrix'

export type FeatureGateMiddlewareOptions = {
  userId: string
  /** Session email — enables ADMIN_EMAILS platform-admin bypass (same as `/admin`). */
  userEmail?: string | null
  featureId: SubscriptionFeatureId
  allowTokenFallback?: boolean
  tokenRuleCode?: TokenSpendRuleCode
  confirmTokenSpend?: boolean
  tokenSourceType?: string
  tokenSourceId?: string
  tokenDescription?: string
  tokenMetadata?: Record<string, unknown>
  /**
   * Take the token path EVEN THOUGH the plan grants the feature. For a feature a plan includes up to
   * an allowance (Chimmy: AF Pro, 100 answers a day — lib/chimmy/planAllowance.ts): once it is used,
   * the plan holder pays tokens exactly as a free account does, consent prompt and all. Requires
   * `allowTokenFallback`. Absent or false changes nothing for any existing caller.
   */
  forceTokenFallback?: boolean
}

export type FeatureGateMiddlewareResult =
  | {
      ok: true
      decision: FeatureGateDecision
      tokenSpend: null
      tokenPreview: null
    }
  | {
      ok: true
      decision: FeatureGateDecision
      tokenSpend: TokenLedgerEntryView
      tokenPreview: TokenSpendPreview
    }
  | {
      ok: false
      response: NextResponse
    }

function lockedResponse(decision: FeatureGateDecision): NextResponse {
  return NextResponse.json(
    {
      error: 'Premium feature',
      code: 'feature_not_entitled',
      message: decision.message,
      requiredPlan: decision.requiredPlan,
      upgradePath: decision.upgradePath,
      entitlement: decision.entitlement,
    },
    { status: 403 }
  )
}

function tokenConfirmationRequiredResponse(
  decision: FeatureGateDecision,
  preview: TokenSpendPreview
): NextResponse {
  return NextResponse.json(
    {
      error: 'Token spend confirmation required.',
      code: 'token_confirmation_required',
      message: `Use ${preview.tokenCost} token${preview.tokenCost === 1 ? '' : 's'} to unlock this request once.`,
      requiredPlan: decision.requiredPlan,
      upgradePath: decision.upgradePath,
      entitlement: decision.entitlement,
      preview,
    },
    { status: 409 }
  )
}

function insufficientTokenResponse(
  decision: FeatureGateDecision,
  preview: TokenSpendPreview
): NextResponse {
  return NextResponse.json(
    {
      error: 'Insufficient token balance',
      code: 'insufficient_token_balance',
      message: `Need ${preview.tokenCost} token${preview.tokenCost === 1 ? '' : 's'} for this one-time unlock.`,
      requiredPlan: decision.requiredPlan,
      upgradePath: decision.upgradePath,
      entitlement: decision.entitlement,
      preview,
    },
    { status: 402 }
  )
}

function unavailableTokenRuleResponse(decision: FeatureGateDecision): NextResponse {
  return NextResponse.json(
    {
      error: 'Token fallback is temporarily unavailable for this feature.',
      code: 'token_spend_rule_missing',
      requiredPlan: decision.requiredPlan,
      upgradePath: decision.upgradePath,
      entitlement: decision.entitlement,
    },
    { status: 500 }
  )
}

export async function requireFeatureEntitlement(
  options: FeatureGateMiddlewareOptions
): Promise<FeatureGateMiddlewareResult> {
  const gate = new FeatureGateService()
  const decision = await gate.evaluateUserFeatureAccess(
    options.userId,
    options.featureId,
    options.userEmail
  )
  if (decision.allowed && !(options.forceTokenFallback && options.allowTokenFallback)) {
    return { ok: true, decision, tokenSpend: null, tokenPreview: null }
  }

  if (!options.allowTokenFallback) {
    return { ok: false, response: lockedResponse(decision) }
  }

  const tokenRuleCode = options.tokenRuleCode ?? getFeatureTokenFallbackRule(options.featureId)
  if (!tokenRuleCode) {
    return { ok: false, response: lockedResponse(decision) }
  }

  const tokenSpendService = new TokenSpendService()
  let preview: TokenSpendPreview
  try {
    const balance = await tokenSpendService.getBalance(options.userId, options.userEmail)
    preview = await tokenSpendService.previewSpendWithEntitlement({
      userId: options.userId,
      ruleCode: tokenRuleCode,
      entitlement: decision.entitlement,
      currentBalance: Number(balance.balance || 0),
      userEmail: options.userEmail,
    })
  } catch (error) {
    if (error instanceof TokenSpendRuleNotFoundError) {
      return { ok: false, response: unavailableTokenRuleResponse(decision) }
    }
    throw error
  }
  if (!preview.canSpend) {
    return { ok: false, response: insufficientTokenResponse(decision, preview) }
  }
  if (!options.confirmTokenSpend) {
    return { ok: false, response: tokenConfirmationRequiredResponse(decision, preview) }
  }

  let tokenSpend: TokenLedgerEntryView
  try {
    tokenSpend = await tokenSpendService.spendTokensForRule({
      userId: options.userId,
      ruleCode: tokenRuleCode,
      confirmed: true,
      sourceType: options.tokenSourceType ?? 'feature_gate_fallback',
      sourceId: options.tokenSourceId ?? `${options.featureId}:${Date.now()}`,
      description: options.tokenDescription ?? `Token fallback unlock for ${options.featureId}`,
      metadata: {
        featureId: options.featureId,
        ...(options.tokenMetadata ?? {}),
      },
      userEmail: options.userEmail,
    })
  } catch (error) {
    if (error instanceof TokenInsufficientBalanceError) {
      return { ok: false, response: insufficientTokenResponse(decision, preview) }
    }
    if (error instanceof TokenSpendConfirmationRequiredError) {
      return { ok: false, response: tokenConfirmationRequiredResponse(decision, preview) }
    }
    if (error instanceof TokenSpendRuleNotFoundError) {
      return { ok: false, response: unavailableTokenRuleResponse(decision) }
    }
    throw error
  }

  return {
    ok: true,
    decision,
    tokenSpend,
    tokenPreview: preview,
  }
}
