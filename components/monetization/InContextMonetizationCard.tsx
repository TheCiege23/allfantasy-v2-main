'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { Coins, Crown, Lock, Sparkles } from 'lucide-react'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'
import { useMonetizationContext } from '@/hooks/useMonetizationContext'
import {
  resolvePlanTierFromSku,
  trackInsufficientTokenFlowViewed,
  trackLockedFeatureConversionClick,
  trackTokenPurchaseClicked,
  trackUpgradeEntryClicked,
} from '@/lib/monetization-analytics'

function planLabel(plan: string): string {
  if (plan === 'supreme') return 'AF Supreme'
  if (plan === 'commissioner') return 'AF Commissioner'
  if (plan === 'war_room') return 'AF Legacy'
  if (plan === 'pro') return 'AF Pro'
  return plan || 'Free'
}

function resolveCurrentPlan(plans: string[]): string {
  if (plans.includes('supreme')) return 'AF Supreme'
  if (plans.includes('commissioner')) return 'AF Commissioner'
  if (plans.includes('war_room')) return 'AF Legacy'
  if (plans.includes('pro')) return 'AF Pro'
  return 'Free'
}

export function InContextMonetizationCard({
  title,
  featureId,
  tokenRuleCodes = [],
  className = '',
  testIdPrefix = 'in-context-monetization',
}: {
  title: string
  featureId?: SubscriptionFeatureId
  tokenRuleCodes?: string[]
  className?: string
  testIdPrefix?: string
}) {
  const { loading, error, entitlement, feature, tokenBalance, previewsByRuleCode, refetch } = useMonetizationContext({
    featureId,
    ruleCodes: tokenRuleCodes,
  })

  const primaryRuleCode = tokenRuleCodes[0] ?? null
  const primaryPreview = primaryRuleCode ? previewsByRuleCode.get(primaryRuleCode)?.preview ?? null : null
  const includedWithPlan = Boolean(feature?.hasAccess)
  const isSupremeUser = Boolean(entitlement?.plans?.includes('supreme'))
  const showBuyTokensCta = Boolean(!includedWithPlan && primaryPreview && !primaryPreview.canSpend)
  const showUpgradeCta = Boolean(feature && !feature.hasAccess)
  const showSupremeUpsellCta = Boolean(
    showUpgradeCta && feature?.requiredPlan !== 'AF Supreme'
  )
  const currentPlanLabel = resolveCurrentPlan(entitlement?.plans ?? [])
  const didTrackPrompt = useRef(false)
  const didTrackInsufficient = useRef(false)

  useEffect(() => {
    if (loading || !feature || feature.hasAccess || didTrackPrompt.current) return
    didTrackPrompt.current = true
  }, [entitlement?.status, feature, loading])

  useEffect(() => {
    if (!showBuyTokensCta || didTrackInsufficient.current) return
    didTrackInsufficient.current = true
    trackInsufficientTokenFlowViewed({
      surface: 'in_context_monetization_card',
      featureId: feature?.featureId ?? featureId ?? null,
      ruleCode: primaryRuleCode,
      tokenCost: primaryPreview?.tokenCost ?? null,
      currentBalance: primaryPreview?.currentBalance ?? tokenBalance?.balance ?? null,
    })
  }, [
    feature?.featureId,
    featureId,
    primaryPreview?.currentBalance,
    primaryPreview?.tokenCost,
    primaryRuleCode,
    showBuyTokensCta,
    tokenBalance?.balance,
  ])

  if (loading) {
    return (
      <div
        className={`rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/55 ${className}`}
        data-testid={`${testIdPrefix}-loading`}
      >
        Loading monetization details...
      </div>
    )
  }

  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 ${className}`}
      data-testid={`${testIdPrefix}-card`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-white/85">
          <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
          <span className="font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100">
            <Crown className="h-3 w-3" />
            {currentPlanLabel}
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-full border border-white/20 bg-black/20 px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/10"
            data-testid={`${testIdPrefix}-refresh`}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-white/65">
        <span className="inline-flex items-center gap-1" data-testid={`${testIdPrefix}-token-balance`}>
          <Coins className="h-3.5 w-3.5 text-amber-300" />
          {loading ? '...' : error || !tokenBalance ? '— tokens (unavailable)' : `${tokenBalance.balance} tokens`}
        </span>
        {feature ? (
          <span
            className={`inline-flex items-center gap-1 ${
              feature.hasAccess ? 'text-emerald-200/85' : 'text-amber-200/85'
            }`}
            data-testid={`${testIdPrefix}-entitlement-state`}
          >
            <Lock className="h-3 w-3" />
            {feature.hasAccess
              ? isSupremeUser
                ? 'Included with AF Supreme bundle inheritance'
                : 'Included with your plan'
              : `${feature.requiredPlan ?? 'Premium'} required`}
          </span>
        ) : null}
        {primaryPreview && !includedWithPlan ? (
          <span
            className="inline-flex items-center gap-1 text-cyan-200/85"
            data-testid={`${testIdPrefix}-token-cost`}
          >
            Cost before run: {primaryPreview.tokenCost} token{primaryPreview.tokenCost === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 text-[11px] text-amber-200/85" data-testid={`${testIdPrefix}-error`}>
          {error}
        </p>
      ) : null}

      {tokenRuleCodes.length > 1 && !includedWithPlan ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tokenRuleCodes.map((ruleCode) => {
            const preview = previewsByRuleCode.get(ruleCode)?.preview
            if (!preview) return null
            return (
              <span
                key={ruleCode}
                className="rounded-full border border-white/15 bg-black/20 px-2 py-0.5 text-[10px] text-white/70"
              >
                {preview.featureLabel}: {preview.tokenCost}
              </span>
            )
          })}
        </div>
      ) : null}
      {includedWithPlan && primaryPreview ? (
        <p className="mt-2 text-[11px] text-white/65" data-testid={`${testIdPrefix}-token-clarity-note`}>
          This feature is included with your subscription. Tokens only apply to token-metered actions where policy requires.
        </p>
      ) : null}

      {(showUpgradeCta || showBuyTokensCta || showSupremeUpsellCta) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {showUpgradeCta ? (
            <Link
              href={feature?.upgradePath ?? '/pricing'}
              onClick={() => {
                trackLockedFeatureConversionClick({
                  surface: 'in_context_monetization_card',
                  ctaType: 'upgrade',
                  featureId: feature?.featureId ?? featureId ?? null,
                  requiredPlan: feature?.requiredPlan ?? null,
                })
                trackUpgradeEntryClicked({
                  targetPlan: resolvePlanTierFromSku(feature?.requiredPlan ?? 'pro'),
                  surface: 'in_context_monetization_card',
                  pagePath: window.location.pathname,
                })
              }}
              className="rounded-lg border border-cyan-400/35 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-100 hover:bg-cyan-500/20"
              data-testid={`${testIdPrefix}-upgrade-cta`}
            >
              Upgrade plan
            </Link>
          ) : null}
          {showBuyTokensCta ? (
            <Link
              href={`/tokens${primaryRuleCode ? `?ruleCode=${encodeURIComponent(primaryRuleCode)}` : ''}`}
              onClick={() => {
                trackLockedFeatureConversionClick({
                  surface: 'in_context_monetization_card',
                  ctaType: 'tokens',
                  featureId: feature?.featureId ?? featureId ?? null,
                  requiredPlan: feature?.requiredPlan ?? null,
                  ruleCode: primaryRuleCode,
                })
                trackTokenPurchaseClicked({
                  ruleCode: primaryRuleCode,
                  surface: 'in_context_monetization_card',
                  pagePath: window.location.pathname,
                })
              }}
              className="rounded-lg border border-amber-400/35 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-100 hover:bg-amber-500/20"
              data-testid={`${testIdPrefix}-buy-tokens-cta`}
            >
              Buy tokens
            </Link>
          ) : null}
          {showSupremeUpsellCta ? (
            <Link
              href="/pricing?highlight=supreme"
              onClick={() => {
                trackLockedFeatureConversionClick({
                  surface: 'in_context_monetization_card',
                  ctaType: 'supreme',
                  featureId: feature?.featureId ?? featureId ?? null,
                  requiredPlan: feature?.requiredPlan ?? null,
                })
                trackUpgradeEntryClicked({
                  targetPlan: 'supreme',
                  surface: 'in_context_monetization_card',
                  pagePath: window.location.pathname,
                })
              }}
              className="rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-100 hover:bg-emerald-500/20"
              data-testid={`${testIdPrefix}-supreme-cta`}
            >
              Get AF Supreme
            </Link>
          ) : null}
        </div>
      )}

      {feature && !feature.hasAccess ? (
        <p className="mt-2 text-[11px] text-white/60" data-testid={`${testIdPrefix}-locked-copy`}>
          {feature.message || `${planLabel(feature.requiredPlan ?? '')} is required for this action.`}
        </p>
      ) : null}
    </div>
  )
}

