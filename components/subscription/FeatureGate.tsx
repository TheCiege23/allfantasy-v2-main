'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { LockedFeatureCard } from '@/components/subscription/LockedFeatureCard'
import { useEntitlement } from '@/hooks/useEntitlement'
import { useAccessTier } from '@/hooks/useAccessTier'
import {
  getDisplayPlanName,
  getDisplayPlanNameWithPrice,
  getRequiredPlanForFeature,
} from '@/lib/subscription/feature-access'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'
import {
  getFeatureGateMatrixEntry,
  type FeatureGateMatrixEntry,
} from '@/lib/subscription/feature-gate-matrix'
import type { TokenSpendRuleCode } from '@/lib/tokens/constants'
import { previewTokenSpend } from '@/lib/tokens/client-confirm'

type FeatureGateProps = {
  featureId: SubscriptionFeatureId
  children: ReactNode
  className?: string
  featureNameOverride?: string
  requiredPlanOverride?: string
  showTokenFallback?: boolean
  tokenRuleCodeOverride?: TokenSpendRuleCode
}

function resolveRequiredPlanLabel(
  featureId: SubscriptionFeatureId,
  entitlementRequiredPlan: string | null | undefined
): string {
  if (entitlementRequiredPlan) return entitlementRequiredPlan
  const requiredPlan = getRequiredPlanForFeature(featureId)
  return requiredPlan ? getDisplayPlanNameWithPrice(requiredPlan) : 'a premium plan'
}

function resolveTokenHref(ruleCode: string): string {
  const params = new URLSearchParams()
  params.set('ruleCode', ruleCode)
  return `/tokens?${params.toString()}`
}

export function FeatureGate({
  featureId,
  children,
  className = '',
  featureNameOverride,
  requiredPlanOverride,
  showTokenFallback = true,
  tokenRuleCodeOverride,
}: FeatureGateProps) {
  const { featureAccess, loading, entitlement, upgradePath } = useEntitlement(featureId)
  const accessTier = useAccessTier()
  const matrixEntry: FeatureGateMatrixEntry = useMemo(
    () => getFeatureGateMatrixEntry(featureId),
    [featureId]
  )
  const [tokenCost, setTokenCost] = useState<number | null>(null)
  const tokenRuleCode = tokenRuleCodeOverride ?? matrixEntry.tokenFallbackRuleCode

  useEffect(() => {
    if (loading || featureAccess || !showTokenFallback || !tokenRuleCode) {
      setTokenCost(null)
      return
    }
    let cancelled = false
    void previewTokenSpend(tokenRuleCode)
      .then((preview) => {
        if (cancelled) return
        setTokenCost(preview.tokenCost)
      })
      .catch(() => {
        if (!cancelled) setTokenCost(null)
      })
    return () => {
      cancelled = true
    }
  }, [featureAccess, loading, showTokenFallback, tokenRuleCode])

  if (loading || accessTier.loading) {
    return <p className="text-sm text-white/60">Checking premium access...</p>
  }

  if (featureAccess) {
    return <>{children}</>
  }

  const requiredPlan = requiredPlanOverride
    ?? resolveRequiredPlanLabel(featureId, entitlement?.requiredPlan)

  const statusMessage = [matrixEntry.lockedReason, entitlement?.message]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(' ')

  // Guests (no account) never get an "upgrade" CTA — there's nothing to upgrade yet. The
  // primary action is signing up free; the required paid tier is shown as context for what
  // comes after, per the 3-tier access model (guest -> free -> paid).
  if (accessTier.isGuest) {
    return (
      <LockedFeatureCard
        featureName={featureNameOverride ?? matrixEntry.title}
        featureId={featureId}
        requiredPlan={requiredPlan}
        upgradeHref={upgradePath}
        statusMessage={statusMessage}
        tokenCost={undefined}
        tokenHref={undefined}
        entitlementStatus="none"
        className={className}
        isGuestLocked
        signUpHref={`/signup?next=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname : '/')}`}
      />
    )
  }

  return (
    <LockedFeatureCard
      featureName={featureNameOverride ?? matrixEntry.title}
      featureId={featureId}
      requiredPlan={requiredPlan}
      upgradeHref={upgradePath}
      statusMessage={statusMessage}
      tokenCost={showTokenFallback ? tokenCost ?? undefined : undefined}
      tokenHref={tokenRuleCode ? resolveTokenHref(tokenRuleCode) : undefined}
      entitlementStatus={entitlement?.status ?? 'none'}
      className={className}
    />
  )
}
