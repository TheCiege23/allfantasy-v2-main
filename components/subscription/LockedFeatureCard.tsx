'use client'

/**
 * PROMPT 258 — Locked feature card: explains why locked and offers upgrade + optional token CTA.
 */

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import {
  resolvePlanTierFromSku,
  trackLockedFeatureConversionClick,
  trackLockedFeatureViewed,
  trackTokenPurchaseClicked,
  trackUpgradeEntryClicked,
  trackUpgradePromptOpened,
} from '@/lib/monetization-analytics'

export interface LockedFeatureCardProps {
  featureName: string
  featureId?: string
  requiredPlan: string
  upgradeHref?: string
  statusMessage?: string
  /** Optional: token cost for single-use fallback; when set, show "Or use N tokens" link */
  tokenCost?: number
  tokenHref?: string
  tokenCtaLabel?: string
  onUpgradeClick?: () => void
  /** PROMPT 267: optional callback when token link is clicked (analytics) */
  onTokenClick?: () => void
  entitlementStatus?: 'active' | 'grace' | 'past_due' | 'expired' | 'none'
  className?: string
  /** Viewer has no account at all (guest tier) — swap the CTA to "Sign up free" instead of "Upgrade". */
  isGuestLocked?: boolean
  signUpHref?: string
}

export function LockedFeatureCard({
  featureName,
  featureId,
  requiredPlan,
  upgradeHref = '/pricing',
  statusMessage,
  tokenCost,
  tokenHref = '/tokens',
  tokenCtaLabel,
  onUpgradeClick,
  onTokenClick,
  entitlementStatus = 'none',
  className = '',
  isGuestLocked = false,
  signUpHref = '/signup',
}: LockedFeatureCardProps) {
  const showTokenFallback = !isGuestLocked && tokenCost != null && tokenCost > 0
  const tokenLabel =
    tokenCtaLabel
    ?? `Or use ${tokenCost} token${tokenCost !== 1 ? 's' : ''} for one-time use`
  const didTrackView = useRef(false)

  useEffect(() => {
    if (didTrackView.current) return
    didTrackView.current = true
    trackUpgradePromptOpened({
      surface: 'locked_feature_card',
      featureId: featureId ?? featureName,
      requiredPlan,
      entitlementStatus,
    })
    trackLockedFeatureViewed({
      surface: 'locked_feature_card',
      featureId: featureId ?? featureName,
      requiredPlan,
      entitlementStatus,
    })
  }, [entitlementStatus, featureId, featureName, requiredPlan])

  const targetPlan = resolvePlanTierFromSku(requiredPlan)

  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/[0.03] p-5 ${className}`}
      role="region"
      aria-label={`${featureName} is locked`}
    >
      <div className="flex items-center gap-3 text-cyan-400">
        <Lock className="h-8 w-8 shrink-0" />
        <h3 className="text-lg font-semibold text-white">{featureName} is locked</h3>
      </div>
      <p className="mt-2 text-sm text-white/70">
        {isGuestLocked
          ? `Sign up free to create your AllFantasy account, then upgrade to ${requiredPlan} to unlock this.`
          : `This feature requires ${requiredPlan}. Subscribe to unlock it.${
              showTokenFallback ? ' You can also use tokens for a one-time unlock where available.' : ''
            }`}
      </p>
      {statusMessage ? (
        <p
          className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
          data-testid="locked-feature-status-message"
        >
          {statusMessage}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2">
        {isGuestLocked ? (
          <Link
            href={signUpHref}
            onClick={() => {
              trackLockedFeatureConversionClick({
                surface: 'locked_feature_card',
                ctaType: 'upgrade',
                featureId: featureId ?? featureName,
                requiredPlan,
              })
            }}
            className="flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-medium text-white hover:bg-cyan-500 active:scale-[0.98] transition-premium focus-ring touch-manipulation"
            data-testid="locked-feature-signup-link"
          >
            Sign up free
          </Link>
        ) : onUpgradeClick ? (
          <button
            type="button"
            onClick={() => {
              trackLockedFeatureConversionClick({
                surface: 'locked_feature_card',
                ctaType: 'upgrade',
                featureId: featureId ?? featureName,
                requiredPlan,
              })
              trackUpgradeEntryClicked({
                targetPlan,
                surface: 'locked_feature_card',
                pagePath: window.location.pathname,
              })
              onUpgradeClick()
            }}
            className="flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-medium text-white hover:bg-cyan-500 active:scale-[0.98] transition-premium focus-ring touch-manipulation"
            data-testid="locked-feature-upgrade-button"
          >
            <Lock className="h-4 w-4" />
            Unlock with {requiredPlan}
          </button>
        ) : (
          <Link
            href={upgradeHref}
            onClick={() => {
              trackLockedFeatureConversionClick({
                surface: 'locked_feature_card',
                ctaType: 'upgrade',
                featureId: featureId ?? featureName,
                requiredPlan,
              })
              trackUpgradeEntryClicked({
                targetPlan,
                surface: 'locked_feature_card',
                pagePath: window.location.pathname,
              })
            }}
            className="flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-medium text-white hover:bg-cyan-500 active:scale-[0.98] transition-premium focus-ring touch-manipulation"
            data-testid="locked-feature-upgrade-link"
          >
            <Lock className="h-4 w-4" />
            View plans
          </Link>
        )}
        {showTokenFallback && (
          <Link
            href={tokenHref}
            onClick={() => {
              const query = tokenHref.includes('?') ? tokenHref.split('?')[1] ?? '' : ''
              const tokenRuleCode = query ? new URLSearchParams(query).get('ruleCode') : null
              trackLockedFeatureConversionClick({
                surface: 'locked_feature_card',
                ctaType: 'tokens',
                featureId: featureId ?? featureName,
                requiredPlan,
                ruleCode: tokenRuleCode,
              })
              trackTokenPurchaseClicked({
                surface: 'locked_feature_card',
                pagePath: window.location.pathname,
                ruleCode: tokenRuleCode,
              })
              onTokenClick?.()
            }}
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center text-sm text-amber-300 hover:bg-amber-500/20 active:scale-[0.98] transition-premium focus-ring touch-manipulation"
            data-testid="locked-feature-token-fallback-link"
          >
            {tokenLabel}
          </Link>
        )}
      </div>
    </div>
  )
}
