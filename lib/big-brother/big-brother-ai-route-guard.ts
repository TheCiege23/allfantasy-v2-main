/**
 * Entitlements + AF Token metering for POST /api/leagues/[leagueId]/big-brother/ai.
 * - Ungated: `rule_explain`.
 * - Player: `big_brother_ai` (+ tokens for 2–3 token rules when subscribed).
 * - Host / commissioner: `big_brother_host_ai` for Chimmy host, challenge themes, finale moderator.
 */

import { NextResponse } from 'next/server'
import { getLeagueRole } from '@/lib/league/permissions'
import type { FeatureGateDecision } from '@/lib/subscription/FeatureGateService'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import type { BigBrotherAIPromptType } from '@/lib/big-brother/ai/BigBrotherAIPrompts'
import { getTokenSpendRuleMatrixEntry } from '@/lib/tokens/pricing-matrix'
import type { TokenSpendRuleCode } from '@/lib/tokens/constants'
import type { TokenLedgerEntryView, TokenSpendPreview } from '@/lib/tokens/TokenSpendService'

export const BIG_BROTHER_AI_VALID_TYPES: readonly BigBrotherAIPromptType[] = [
  'chimmy_host',
  'challenge_generator_hoh',
  'challenge_generator_veto',
  'recap',
  'game_theory',
  'social_strategy',
  'finale_moderator',
  'rule_explain',
]

export const BIG_BROTHER_AI_UNGATED_TYPES: readonly BigBrotherAIPromptType[] = ['rule_explain']

const HOST_TYPES: readonly BigBrotherAIPromptType[] = [
  'chimmy_host',
  'challenge_generator_hoh',
  'challenge_generator_veto',
  'finale_moderator',
]

const PLAYER_TYPES: readonly BigBrotherAIPromptType[] = ['recap', 'game_theory', 'social_strategy']

/** Token rule per gated type — must exist in `TOKEN_SPEND_RULE_MATRIX`. */
export const BIG_BROTHER_AI_TYPE_RULE_CODE: Record<
  Exclude<BigBrotherAIPromptType, (typeof BIG_BROTHER_AI_UNGATED_TYPES)[number]>,
  TokenSpendRuleCode
> = {
  chimmy_host: 'big_brother_ai_host_ceremony',
  challenge_generator_hoh: 'big_brother_ai_host_challenge',
  challenge_generator_veto: 'big_brother_ai_host_challenge',
  recap: 'big_brother_ai_strategy_report',
  game_theory: 'big_brother_ai_vote_prediction',
  social_strategy: 'big_brother_ai_alliance_read',
  finale_moderator: 'big_brother_ai_host_finale',
}

function ruleCodeForType(type: BigBrotherAIPromptType): TokenSpendRuleCode | null {
  if (BIG_BROTHER_AI_UNGATED_TYPES.includes(type as (typeof BIG_BROTHER_AI_UNGATED_TYPES)[number])) return null
  return BIG_BROTHER_AI_TYPE_RULE_CODE[type as keyof typeof BIG_BROTHER_AI_TYPE_RULE_CODE] ?? null
}

function tokenCostForRule(ruleCode: TokenSpendRuleCode): number {
  return Math.max(1, getTokenSpendRuleMatrixEntry(String(ruleCode))?.tokenCost ?? 1)
}

function mustMeterSubscribedUsers(ruleCode: TokenSpendRuleCode): boolean {
  return tokenCostForRule(ruleCode) >= 2
}

export type BigBrotherAiAccessResult =
  | {
      ok: true
      featureDecision: FeatureGateDecision
      tokenSpend: TokenLedgerEntryView | null
      tokenPreview: TokenSpendPreview | null
      ruleCode: TokenSpendRuleCode | null
    }
  | { ok: false; response: NextResponse }

export async function resolveBigBrotherAiAccess(input: {
  userId: string
  userEmail: string | null | undefined
  leagueId: string
  type: BigBrotherAIPromptType
  confirmTokenSpend: boolean
}): Promise<BigBrotherAiAccessResult> {
  const { userId, userEmail, leagueId, type, confirmTokenSpend } = input

  if (!BIG_BROTHER_AI_VALID_TYPES.includes(type)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid type', validTypes: BIG_BROTHER_AI_VALID_TYPES },
        { status: 400 },
      ),
    }
  }

  if (BIG_BROTHER_AI_UNGATED_TYPES.includes(type as (typeof BIG_BROTHER_AI_UNGATED_TYPES)[number])) {
    const entitlement = await new EntitlementResolver().resolveSnapshot(userId, userEmail ?? null)
    const featureDecision: FeatureGateDecision = {
      allowed: true,
      featureId: 'big_brother_ai',
      entitlement,
      requiredPlan: null,
      upgradePath: '/settings',
      message: 'Ungated Big Brother AI surface.',
    }
    return {
      ok: true,
      featureDecision,
      tokenSpend: null,
      tokenPreview: null,
      ruleCode: null,
    }
  }

  const ruleCode = ruleCodeForType(type)
  if (!ruleCode) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid Big Brother AI type' }, { status: 400 }),
    }
  }

  const isHost = HOST_TYPES.includes(type as (typeof HOST_TYPES)[number])
  const isPlayer = PLAYER_TYPES.includes(type as (typeof PLAYER_TYPES)[number])

  if (isHost) {
    const role = await getLeagueRole(leagueId, userId)
    if (role !== 'commissioner' && role !== 'co_commissioner') {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: 'Forbidden',
            message: 'Only commissioners can generate host narration for this league.',
          },
          { status: 403 },
        ),
      }
    }
  }

  if (!isHost && !isPlayer) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unsupported Big Brother AI type' }, { status: 400 }),
    }
  }

  const featureId = isHost ? 'big_brother_host_ai' : 'big_brother_ai'

  const gate = await requireFeatureEntitlement({
    userId,
    userEmail: userEmail ?? null,
    featureId,
    allowTokenFallback: true,
    forceTokenFallback: mustMeterSubscribedUsers(ruleCode),
    confirmTokenSpend,
    tokenRuleCode: ruleCode,
    tokenSourceType: 'big_brother_ai',
    tokenSourceId: `${leagueId}:${type}:${Date.now()}`,
    tokenDescription: `Big Brother AI — ${type}`,
    tokenMetadata: { leagueId, bigBrotherAiType: type },
  })

  if (!gate.ok) {
    return { ok: false, response: gate.response }
  }

  if (gate.tokenSpend) {
    return {
      ok: true,
      featureDecision: gate.decision,
      tokenSpend: gate.tokenSpend,
      tokenPreview: gate.tokenPreview,
      ruleCode,
    }
  }


  return {
    ok: true,
    featureDecision: gate.decision,
    tokenSpend: null,
    tokenPreview: null,
    ruleCode,
  }
}
