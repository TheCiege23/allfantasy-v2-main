/**
 * 2E — Entitlement gating. Access is decided SERVER-SIDE, BEFORE any provider call, from the repo's
 * authoritative subscription/entitlement sources — never from client-sent tier/role/balance and never inferred
 * from UI state. One centralized policy maps each intelligence tool to an explicit feature entitlement; the
 * resolver returns a structured deny reason the UI can act on. Commissioners retain manager capabilities
 * (a commissioner passes a manager-tier feature via the underlying FeatureGateService).
 *
 * The concrete checkers (FeatureGateService, resolveLeagueAccess) are INJECTED so this module — and its tests —
 * stay free of Prisma and network I/O.
 */
import type { SubscriptionFeatureId } from '@/lib/subscription/types'
import type { IntelligenceDenyReason, IntelligenceRequestContext, IntelligenceTool } from './types'

export type IntelligenceFeatureMapping = {
  featureId: SubscriptionFeatureId
  /** When the subscription check fails, may the user pay with tokens for a one-off run? */
  allowTokenFallback: boolean
  /** Token spend-rule code used for the one-off fallback (server validates it against the rule table). */
  tokenRuleCode?: string
  /** Requires the commissioner role on the league (managers are rejected). */
  commissionerOnly: boolean
}

/** Centralized tool → entitlement map. Manager surfaces map to manager features; the commissioner surface is
 *  commissioner-gated. Editing access policy happens HERE, not scattered across routes. */
export const INTELLIGENCE_FEATURE_MAP: Record<IntelligenceTool, IntelligenceFeatureMapping> = {
  // tokenRuleCode values are real entries in TOKEN_SPEND_RULE_MATRIX; confirm/seed them when wiring live routes.
  user_os: {
    featureId: 'player_ai_recommendations',
    allowTokenFallback: true,
    tokenRuleCode: 'ai_weekly_planning_session',
    commissionerOnly: false,
  },
  manager_intelligence: {
    featureId: 'ai_team_managers',
    allowTokenFallback: true,
    tokenRuleCode: 'ai_war_room_multi_step_planning',
    commissionerOnly: false,
  },
  mission_control: {
    featureId: 'planning_tools',
    allowTokenFallback: true,
    tokenRuleCode: 'ai_weekly_planning_session',
    commissionerOnly: false,
  },
  commissioner_command_center: {
    featureId: 'commissioner_ai_tools',
    allowTokenFallback: false, // commissioner tier is required; no token bypass of the role gate
    commissionerOnly: true,
  },
}

/** Injected feature-entitlement checker (real impl wraps FeatureGateService.evaluateUserFeatureAccess). */
export interface FeatureAccessChecker {
  check(input: {
    userId: string
    userEmail?: string | null
    featureId: SubscriptionFeatureId
  }): Promise<{ allowed: boolean; requiredPlan?: string | null }>
}

/** Injected league-access checker (real impl wraps resolveLeagueAccess). Returns null when not a member. */
export interface LeagueAccessChecker {
  check(input: {
    leagueId: string
    userId: string
  }): Promise<{ isMember: boolean; isCommissioner: boolean } | null>
}

export type IntelligenceAccessResult =
  | { ok: true; entitlementMode: 'subscription' | 'tokens'; tokenRuleCode?: string; isCommissioner: boolean }
  | { ok: false; denyReason: IntelligenceDenyReason }

/**
 * Resolve access for a request. Order: authentication → league membership → commissioner tier → feature
 * entitlement (with optional token fallback). Any failure returns a structured deny reason and NO provider or
 * token activity happens.
 */
export async function resolveIntelligenceAccess(input: {
  ctx: IntelligenceRequestContext
  featureChecker: FeatureAccessChecker
  leagueChecker: LeagueAccessChecker
}): Promise<IntelligenceAccessResult> {
  const { ctx, featureChecker, leagueChecker } = input
  const mapping = INTELLIGENCE_FEATURE_MAP[ctx.tool]
  if (!mapping) return { ok: false, denyReason: 'unsupported_feature' }

  // 1) Authentication — a verified user id is mandatory.
  if (!ctx.userId || !ctx.userId.trim()) return { ok: false, denyReason: 'authentication_required' }

  // 2) League membership — required for league-scoped decisions.
  let isCommissioner = false
  const leagueId = ctx.packet.canonicalLeagueId
  if (ctx.packet.mode === 'league') {
    if (!leagueId) return { ok: false, denyReason: 'league_access_denied' }
    const access = await leagueChecker.check({ leagueId, userId: ctx.userId })
    if (!access || !access.isMember) return { ok: false, denyReason: 'league_access_denied' }
    isCommissioner = access.isCommissioner
  }

  // 3) Commissioner-only surfaces reject managers.
  if (mapping.commissionerOnly && !isCommissioner) {
    return { ok: false, denyReason: 'commissioner_tier_required' }
  }

  // 4) Feature entitlement (subscription/tier). Commissioners pass manager features via the underlying gate.
  const decision = await featureChecker.check({
    userId: ctx.userId,
    userEmail: ctx.userEmail,
    featureId: mapping.featureId,
  })
  if (decision.allowed) {
    return { ok: true, entitlementMode: 'subscription', isCommissioner }
  }

  // 5) Not entitled by subscription — token fallback if the tool allows it (balance is verified later).
  if (mapping.allowTokenFallback && mapping.tokenRuleCode) {
    return { ok: true, entitlementMode: 'tokens', tokenRuleCode: mapping.tokenRuleCode, isCommissioner }
  }
  return { ok: false, denyReason: 'subscription_required' }
}
