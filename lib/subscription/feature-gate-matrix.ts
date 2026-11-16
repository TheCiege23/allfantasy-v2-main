import type { SubscriptionFeatureId } from '@/lib/subscription/types'
import type { TokenSpendRuleCode } from '@/lib/tokens/constants'
import { getRequiredPlanForFeature } from '@/lib/subscription/feature-access'
import { getPremiumMonetizationForFeature } from '@/lib/monetization/feature-monetization-matrix'

type FeatureGateFamily = 'pro' | 'commissioner' | 'war_room'

export type FeatureGateMatrixEntry = {
  featureId: SubscriptionFeatureId
  family: FeatureGateFamily
  title: string
  lockedReason: string
  tokenFallbackRuleCode: TokenSpendRuleCode | null
}

function resolveFamily(featureId: SubscriptionFeatureId): FeatureGateFamily {
  const requiredPlan = getRequiredPlanForFeature(featureId)
  if (requiredPlan === 'commissioner') return 'commissioner'
  if (requiredPlan === 'war_room') return 'war_room'
  return 'pro'
}

export function getFeatureGateMatrixEntry(featureId: SubscriptionFeatureId): FeatureGateMatrixEntry {
  const monetization = getPremiumMonetizationForFeature(featureId)
  if (monetization) {
    return {
      featureId,
      family: resolveFamily(featureId),
      title: monetization.title,
      lockedReason: monetization.lockedReason,
      tokenFallbackRuleCode: monetization.tokenRuleCode,
    }
  }

  return {
    featureId,
    family: resolveFamily(featureId),
    title: featureId.replaceAll('_', ' '),
    lockedReason: 'This premium capability is currently locked for your account.',
    tokenFallbackRuleCode: null,
  }
}

export function getFeatureTokenFallbackRule(
  featureId: SubscriptionFeatureId
): TokenSpendRuleCode | null {
  return getFeatureGateMatrixEntry(featureId).tokenFallbackRuleCode
}
