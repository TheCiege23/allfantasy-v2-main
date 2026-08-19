/**
 * Monetization analytics — purchase return, subscription, token events.
 * PROMPT 267.
 */

import { gtagEvent } from '@/lib/gtag'

const CONVERSION_CATEGORY = 'monetization'
const MONETIZATION_EVENT_PREFIX = 'monetization'

type SubscriptionLifecycleStatus = 'active' | 'grace' | 'past_due' | 'expired' | 'none'

export type MonetizationPlanTier =
  | 'pro'
  | 'commissioner'
  | 'war_room'
  | 'supreme'
  | 'tokens'
  | 'unknown'

function toPlanTier(input: string | null | undefined): MonetizationPlanTier {
  const value = String(input ?? '').trim().toLowerCase()
  if (!value) return 'unknown'
  if (value.includes('supreme')) return 'supreme'
  // Retired All-Access tier — any legacy all_access value now maps to the surviving Supreme bundle.
  if (value.includes('all_access') || value.includes('all-access')) return 'supreme'
  if (value.includes('war_room') || value.includes('war-room')) return 'war_room'
  if (value.includes('commissioner')) return 'commissioner'
  if (value.includes('pro')) return 'pro'
  if (value.includes('token')) return 'tokens'
  return 'unknown'
}

export function resolvePlanTierFromSku(sku: string | null | undefined): MonetizationPlanTier {
  return toPlanTier(sku)
}

function event(eventName: string, params: Record<string, unknown>) {
  gtagEvent(`${MONETIZATION_EVENT_PREFIX}_${eventName}`, {
    event_category: CONVERSION_CATEGORY,
    ...params,
  })
}

/** Fire when user returns from checkout with success (subscription or tokens). */
export function trackPurchaseReturnSuccess(params: { returnPath: string }) {
  event('purchase_return_success', {
    ...params,
  })
}

export function trackMonetizationPageVisited(params: {
  pagePath: string
  surface: string
  focusPlanTier?: MonetizationPlanTier
}) {
  event('page_visited', {
    page_path: params.pagePath,
    surface: params.surface,
    focus_plan_tier: params.focusPlanTier ?? null,
  })
}

export function trackPlanCheckoutClicked(params: {
  sku: string
  planTier: MonetizationPlanTier
  interval: 'month' | 'year'
  surface: string
  pagePath: string
}) {
  event('plan_checkout_clicked', {
    sku: params.sku,
    plan_tier: params.planTier,
    billing_interval: params.interval,
    surface: params.surface,
    page_path: params.pagePath,
  })
}

export function trackTokenPurchaseClicked(params: {
  sku?: string | null
  ruleCode?: string | null
  surface: string
  pagePath: string
}) {
  event('token_purchase_clicked', {
    sku: params.sku ?? null,
    rule_code: params.ruleCode ?? null,
    plan_tier: 'tokens',
    surface: params.surface,
    page_path: params.pagePath,
  })
}

export function trackUpgradeEntryClicked(params: {
  targetPlan: MonetizationPlanTier
  surface: string
  pagePath: string
  sourcePlan?: MonetizationPlanTier | null
}) {
  event('upgrade_entry_clicked', {
    target_plan_tier: params.targetPlan,
    source_plan_tier: params.sourcePlan ?? null,
    surface: params.surface,
    page_path: params.pagePath,
  })
}

export function trackSubscriptionPurchaseSuccess(params: {
  returnPath: string
  sessionId: string | null
  effectivePlanTiers: MonetizationPlanTier[]
}) {
  event('subscription_purchase_success', {
    return_path: params.returnPath,
    session_id: params.sessionId ?? null,
    plan_tiers: params.effectivePlanTiers,
    primary_plan_tier: params.effectivePlanTiers[0] ?? 'unknown',
  })
}

export function trackTokenPurchaseSuccess(params: {
  returnPath: string
  sessionId: string | null
  balanceAfter: number | null
}) {
  event('token_purchase_success', {
    return_path: params.returnPath,
    session_id: params.sessionId ?? null,
    balance_after: params.balanceAfter ?? null,
    plan_tier: 'tokens',
  })
}

export function trackUpgradePromptOpened(params: {
  surface: string
  featureId?: string | null
  requiredPlan?: string | null
  entitlementStatus?: SubscriptionLifecycleStatus | null
}) {
  event('upgrade_prompt_opened', {
    surface: params.surface,
    feature_id: params.featureId ?? null,
    required_plan: params.requiredPlan ?? null,
    required_plan_tier: toPlanTier(params.requiredPlan),
    entitlement_status: params.entitlementStatus ?? null,
  })
}

export function trackLockedFeatureViewed(params: {
  surface: string
  featureId?: string | null
  requiredPlan?: string | null
  entitlementStatus?: SubscriptionLifecycleStatus | null
}) {
  event('locked_feature_viewed', {
    surface: params.surface,
    feature_id: params.featureId ?? null,
    required_plan: params.requiredPlan ?? null,
    required_plan_tier: toPlanTier(params.requiredPlan),
    entitlement_status: params.entitlementStatus ?? null,
  })
}

export function trackLockedFeatureConversionClick(params: {
  surface: string
  ctaType: 'upgrade' | 'tokens' | 'supreme'
  featureId?: string | null
  requiredPlan?: string | null
  ruleCode?: string | null
}) {
  event('locked_feature_conversion_click', {
    surface: params.surface,
    cta_type: params.ctaType,
    feature_id: params.featureId ?? null,
    required_plan: params.requiredPlan ?? null,
    required_plan_tier: toPlanTier(params.requiredPlan),
    rule_code: params.ruleCode ?? null,
  })
}

export function trackInsufficientTokenFlowViewed(params: {
  surface: string
  featureId?: string | null
  ruleCode?: string | null
  tokenCost?: number | null
  currentBalance?: number | null
}) {
  event('insufficient_token_flow_viewed', {
    surface: params.surface,
    feature_id: params.featureId ?? null,
    rule_code: params.ruleCode ?? null,
    token_cost: params.tokenCost ?? null,
    current_balance: params.currentBalance ?? null,
  })
}

export function trackInsufficientTokenBuyClick(params: {
  surface: string
  featureId?: string | null
  ruleCode?: string | null
}) {
  event('insufficient_token_buy_click', {
    surface: params.surface,
    feature_id: params.featureId ?? null,
    rule_code: params.ruleCode ?? null,
  })
}

export function trackSubscriptionStateViewed(params: {
  status: SubscriptionLifecycleStatus
  surface: string
  featureId?: string | null
}) {
  if (params.status !== 'past_due' && params.status !== 'expired') return
  event('subscription_state_viewed', {
    status: params.status,
    surface: params.surface,
    feature_id: params.featureId ?? null,
  })
}
