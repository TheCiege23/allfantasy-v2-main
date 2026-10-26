/**
 * Entitlements + AF Token metering for POST /api/leagues/[leagueId]/survivor/ai.
 * - Ungated types: no feature / token checks.
 * - Player types: `survivor_ai` (+ token fallback when unsubscribed; 2–3 token rules also charge subscribed users).
 * - Host narration: commissioner role + `survivor_host_ai` (+ same metering rules).
 */

import { NextResponse } from 'next/server'
import { getLeagueRole } from '@/lib/league/permissions'
import type { FeatureGateDecision } from '@/lib/subscription/FeatureGateService'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import type { SurvivorAIType } from '@/lib/survivor/ai/SurvivorAIContext'

export const SURVIVOR_AI_VALID_TYPES: readonly SurvivorAIType[] = [
  'host_intro',
  'host_challenge',
  'host_merge',
  'host_council',
  'host_scroll',
  'host_jury',
  'tribe_help',
  'idol_help',
  'tribal_help',
  'exile_help',
  'bestball_help',
]
import { getTokenSpendRuleMatrixEntry } from '@/lib/tokens/pricing-matrix'
import type { TokenSpendRuleCode } from '@/lib/tokens/constants'
import type { TokenLedgerEntryView, TokenSpendPreview } from '@/lib/tokens/TokenSpendService'

/** Storyline / scroll / basic idol coaching — free surface (deterministic engine still authoritative). */
export const SURVIVOR_AI_UNGATED_TYPES: readonly SurvivorAIType[] = ['host_intro', 'host_scroll', 'idol_help']

const HOST_NARRATION_TYPES: readonly SurvivorAIType[] = [
  'host_challenge',
  'host_merge',
  'host_council',
  'host_jury',
]

const PLAYER_STRATEGY_TYPES: readonly SurvivorAIType[] = [
  'tribe_help',
  'tribal_help',
  'exile_help',
  'bestball_help',
]

/** Token rule per AI type — must exist in `TOKEN_SPEND_RULE_MATRIX`. */
export const SURVIVOR_AI_TYPE_RULE_CODE: Record<
  Exclude<SurvivorAIType, (typeof SURVIVOR_AI_UNGATED_TYPES)[number]>,
  TokenSpendRuleCode
> = {
  host_challenge: 'survivor_ai_host_weekly_recap',
  host_merge: 'survivor_ai_host_minigame_grade',
  host_council: 'survivor_ai_host_vote_processing',
  host_jury: 'survivor_ai_host_story_mode',
  tribe_help: 'survivor_ai_vote_risk_quick',
  tribal_help: 'survivor_ai_blindside_risk',
  exile_help: 'survivor_ai_recap_short',
  bestball_help: 'survivor_ai_challenge_strategy',
}

function ruleCodeForType(type: SurvivorAIType): TokenSpendRuleCode | null {
  if (SURVIVOR_AI_UNGATED_TYPES.includes(type as (typeof SURVIVOR_AI_UNGATED_TYPES)[number])) return null
  return SURVIVOR_AI_TYPE_RULE_CODE[type as keyof typeof SURVIVOR_AI_TYPE_RULE_CODE] ?? 'survivor_ai_vote_risk_quick'
}

function tokenCostForRule(ruleCode: TokenSpendRuleCode): number {
  return Math.max(1, getTokenSpendRuleMatrixEntry(String(ruleCode))?.tokenCost ?? 1)
}

function mustMeterSubscribedUsers(ruleCode: TokenSpendRuleCode): boolean {
  return tokenCostForRule(ruleCode) >= 2
}

export type SurvivorAiAccessResult =
  | {
      ok: true
      featureDecision: FeatureGateDecision
      tokenSpend: TokenLedgerEntryView | null
      tokenPreview: TokenSpendPreview | null
      ruleCode: TokenSpendRuleCode | null
    }
  | { ok: false; response: NextResponse }

export async function resolveSurvivorAiAccess(input: {
  userId: string
  userEmail: string | null | undefined
  leagueId: string
  type: SurvivorAIType
  confirmTokenSpend: boolean
}): Promise<SurvivorAiAccessResult> {
  const { userId, userEmail, leagueId, type, confirmTokenSpend } = input

  if (!SURVIVOR_AI_VALID_TYPES.includes(type)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid type', validTypes: SURVIVOR_AI_VALID_TYPES },
        { status: 400 }
      ),
    }
  }

  if (SURVIVOR_AI_UNGATED_TYPES.includes(type as (typeof SURVIVOR_AI_UNGATED_TYPES)[number])) {
    const entitlement = await new EntitlementResolver().resolveSnapshot(userId, userEmail ?? null)
    const featureDecision: FeatureGateDecision = {
      allowed: true,
      featureId: 'survivor_ai',
      entitlement,
      requiredPlan: null,
      upgradePath: '/settings',
      message: 'Ungated Survivor AI surface.',
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
      response: NextResponse.json({ error: 'Invalid survivor AI type' }, { status: 400 }),
    }
  }

  const isHost = HOST_NARRATION_TYPES.includes(type as (typeof HOST_NARRATION_TYPES)[number])
  const isPlayer = PLAYER_STRATEGY_TYPES.includes(type as (typeof PLAYER_STRATEGY_TYPES)[number])

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
          { status: 403 }
        ),
      }
    }
  }

  if (!isHost && !isPlayer) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unsupported survivor AI type' }, { status: 400 }),
    }
  }

  const featureId = isHost ? 'survivor_host_ai' : 'survivor_ai'

  const gate = await requireFeatureEntitlement({
    userId,
    userEmail: userEmail ?? null,
    featureId,
    allowTokenFallback: true,
    forceTokenFallback: mustMeterSubscribedUsers(ruleCode),
    confirmTokenSpend,
    tokenRuleCode: ruleCode,
    tokenSourceType: 'survivor_ai',
    tokenSourceId: `${leagueId}:${type}:${Date.now()}`,
    tokenDescription: `Survivor AI — ${type}`,
    tokenMetadata: { leagueId, survivorAiType: type },
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
