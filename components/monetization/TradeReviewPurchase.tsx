'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMonetizationContext } from '@/hooks/useMonetizationContext'
import { useGeoRestriction } from '@/lib/geo/useGeoRestriction'
import { getMonetizationCatalogItemBySku, STARTER_TOKEN_PACK_SKU } from '@/lib/monetization/catalog'
import { resolveCheckoutUrl } from '@/lib/monetization/checkout-client'
import { useNativeIapPrices } from '@/lib/monetization/native-iap-client'
import { withLockReturn } from '@/lib/monetization/lockReturn'
import { monthlyUpgradeHref, upgradePathForPlan } from '@/lib/monetization/upgradeDestination'
import { trackLockedFeatureConversionClick, trackLockedFeatureViewed, trackTokenPurchaseClicked } from '@/lib/monetization-analytics'
import { TRADE_REVIEW_TOKEN_RULE } from '@/lib/monetization/tradeReviewDraft'

const STARTER_PACK = getMonetizationCatalogItemBySku(STARTER_TOKEN_PACK_SKU)!
const PRO_OFFER_SOURCE = 'lock_trade_evaluator'

export function TradeReviewPurchase({
  busy, onReview, saveReturnPath,
}: {
  busy: boolean
  onReview: () => void
  saveReturnPath: () => string | null
}) {
  const { status } = useSession()
  const signedIn = status === 'authenticated'
  const { feature, previewsByRuleCode, loading, refetch } = useMonetizationContext({
    featureId: 'trade_analyzer',
    ruleCodes: [TRADE_REVIEW_TOKEN_RULE],
    enabled: signedIn,
  })
  const { nativeApp, prices } = useNativeIapPrices()
  const geo = useGeoRestriction()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trackedOffer = useRef(false)
  useEffect(() => {
    if (loading || !signedIn || !feature || feature.available === false || feature.hasAccess || trackedOffer.current) return
    trackedOffer.current = true
    trackLockedFeatureViewed({ surface: PRO_OFFER_SOURCE, requiredPlan: 'AF Pro' })
  }, [feature, loading, signedIn])

  const quote = previewsByRuleCode.get(TRADE_REVIEW_TOKEN_RULE)?.preview
  const packPrice = nativeApp ? prices[STARTER_PACK.sku] : `$${STARTER_PACK.amountUsd.toFixed(2)}`
  const restricted = geo.isPaidBlocked && !geo.loading
  const reviewCount = quote && quote.tokenCost > 0 ? Math.floor((STARTER_PACK.tokenAmount ?? 0) / quote.tokenCost) : 0

  function continueToSignIn() {
    const returnPath = saveReturnPath()
    if (!returnPath) {
      setError('This browser could not save your trade for sign-in.')
      return
    }
    window.location.assign(`/login?callbackUrl=${encodeURIComponent(returnPath)}`)
  }

  function openProOffer() {
    const back = saveReturnPath()
    if (!back) {
      setError('This browser could not save your trade for checkout.')
      return
    }
    trackLockedFeatureConversionClick({ surface: PRO_OFFER_SOURCE, ctaType: 'upgrade', requiredPlan: 'AF Pro' })
    window.location.assign(withLockReturn(monthlyUpgradeHref(upgradePathForPlan('af_pro')), { source: PRO_OFFER_SOURCE, back }))
  }

  async function buyStarterPack() {
    const returnPath = saveReturnPath()
    if (!returnPath) {
      setError('This browser could not save your trade for checkout.')
      return
    }
    setError(null)
    setPending(true)
    trackTokenPurchaseClicked({
      sku: STARTER_PACK.sku,
      surface: 'trade_review_starter_pack',
      pagePath: '/trade-evaluator',
      ruleCode: TRADE_REVIEW_TOKEN_RULE,
    })
    const result = await resolveCheckoutUrl({
      productType: 'token_pack',
      sku: STARTER_PACK.sku,
      returnPath,
      entrySource: 'trade_review_starter_pack',
    })
    if (!result.ok) {
      setError(result.error)
      setPending(false)
      return
    }
    window.location.assign('completed' in result ? returnPath : result.url)
  }

  const actionClass = 'inline-flex min-h-11 items-center rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'

  if (feature?.available === false) {
    return <p role="status" className="mt-4 text-sm text-white/70">Full trade review is temporarily unavailable.</p>
  }

  return (
    <section className="mt-4 space-y-3 rounded-2xl border border-violet-400/25 bg-violet-500/10 p-4" aria-label="Full trade review">
      <h2 className="font-bold">Full trade review</h2>
      <p className="text-sm text-white/75">Get Chimmy’s reasoning, roster context, and trade options.</p>
      {status === 'loading' || loading ? <p role="status" className="text-sm text-white/65">Checking access…</p> : null}
      {status === 'unauthenticated' ? (
        <button type="button" className={actionClass} onClick={continueToSignIn}>Sign in to continue</button>
      ) : null}
      {signedIn && feature?.hasAccess ? (
        <button type="button" className={actionClass} disabled={busy} onClick={onReview} data-testid="trade-full-review">
          {busy ? 'Reviewing trade…' : 'Run full review'}
        </button>
      ) : null}
      {signedIn && feature && !feature.hasAccess ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={actionClass} onClick={openProOffer} data-ios-purchase>
            Unlock with AF Pro
          </button>
          {quote?.canSpend ? (
            <button type="button" className={actionClass} disabled={busy} onClick={onReview} data-testid="trade-full-review">
              {busy ? 'Reviewing trade…' : `Review this trade · ${quote.tokenCost} tokens`}
            </button>
          ) : quote && packPrice && !restricted ? (
            <button type="button" className={actionClass} disabled={pending || busy} onClick={() => void buyStarterPack()} data-testid="trade-starter-checkout" data-ios-purchase>
              {pending ? 'Opening checkout…' : `Get ${STARTER_PACK.tokenAmount} tokens · ${packPrice}`}
            </button>
          ) : null}
        </div>
      ) : null}
      {feature && !feature.hasAccess && quote && !quote.canSpend ? (
        <p className="text-sm text-white/70" data-ios-purchase>
          A review costs {quote.tokenCost} tokens.
          {reviewCount > 0 ? ` The Starter pack covers ${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'} at this rate.` : ''}
        </p>
      ) : null}
      {signedIn && !loading && !feature ? (
        <p role="status" className="text-sm text-white/70">
          Full trade review is temporarily unavailable.{' '}
          <button type="button" className="underline" onClick={() => void refetch()}>Check again</button>
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-rose-200">{error}</p> : null}
    </section>
  )
}
