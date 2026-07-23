'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Coins, Loader2 } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { usePostPurchaseSync } from '@/hooks/usePostPurchaseSync'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { confirmTokenSpend } from '@/lib/tokens/client-confirm'
import { resolveCheckoutUrl } from '@/lib/monetization/checkout-client'
import { MonetizationComplianceNotice } from '@/components/monetization/MonetizationComplianceNotice'
import { StripePaymentHint } from '@/components/monetization/StripePaymentHint'
import CouponInput from '@/components/promotions/CouponInput'
import SponsorCouponCard from '@/components/promotions/SponsorCouponCard'
import {
  trackInsufficientTokenFlowViewed,
  trackMonetizationPageVisited,
  trackTokenPurchaseClicked,
} from '@/lib/monetization-analytics'
import {
  trackCouponViewed,
  trackCouponApplied,
  trackCouponRejected,
  trackTokenPackCheckoutClicked,
} from '@/lib/promotions/couponAnalytics'

type TokenPack = {
  sku: string
  title: string
  description: string
  amountUsd: number
  tokenAmount: number
  stripePriceConfigured: boolean
}

type SpendRule = {
  code: string
  category: string
  featureLabel: string
  description: string
  tokenCost: number
  baseTokenCost: number
  pricingTier: 'low' | 'mid' | 'high'
  requiredPlan: string | null
  discountPct: number
  chargeMode: 'tokens_only' | 'subscriber_discounted_tokens'
  subscriptionEligible: boolean
  policyMessage: string
  monthlyIncludedPremiumCredits: number | null
  supportsUnlimitedLowTierInFuture: boolean
}

type LedgerEntry = {
  id: string
  entryType: string
  tokenDelta: number
  balanceAfter: number
  spendFeatureLabel: string | null
  description: string | null
  createdAt: string
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function formatDelta(delta: number): string {
  return `${delta > 0 ? '+' : ''}${delta}`
}

export default function TokensPage() {
  const { t, tInterpolate } = useLanguage()
  const { balance, loading: balanceLoading, error: balanceError, refetch: refetchBalance } = useTokenBalance()
  const [tokenPacks, setTokenPacks] = useState<TokenPack[]>([])
  const [rules, setRules] = useState<SpendRule[]>([])
  const [history, setHistory] = useState<LedgerEntry[]>([])
  const [isAdminBypassAccount, setIsAdminBypassAccount] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingSku, setPendingSku] = useState<string | null>(null)
  const [pendingSpend, setPendingSpend] = useState(false)
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null)
  const [appliedCouponPct, setAppliedCouponPct] = useState<number>(0)
  const [selectedRuleCode, setSelectedRuleCode] = useState<string>('')
  const [historyOpen, setHistoryOpen] = useState(true)
  const [spendMessage, setSpendMessage] = useState<string | null>(null)
  const [pricingSearch, setPricingSearch] = useState('')
  const [pricingCategory, setPricingCategory] = useState('all')
  const [discountOnly, setDiscountOnly] = useState(false)
  const trackedPageVisit = useRef(false)

  // ── i18n helpers (must close over `t` from hook) ────────────────────────────

  const tierTitle = useCallback(
    (tier: 'low' | 'mid' | 'high'): string => {
      if (tier === 'low') return t('tokens.pricing.tierLow')
      if (tier === 'mid') return t('tokens.pricing.tierMid')
      return t('tokens.pricing.tierHigh')
    },
    [t]
  )

  const formatPlanLabel = useCallback(
    (plan: string | null): string => {
      if (!plan) return t('tokens.pricing.planAny')
      if (plan === 'supreme') return t('tokens.pricing.planSupreme')
      if (plan === 'war_room') return t('tokens.pricing.planWarRoom')
      if (plan === 'commissioner') return t('tokens.pricing.planCommissioner')
      if (plan === 'pro') return t('tokens.pricing.planPro')
      return plan
    },
    [t]
  )

  const humanizeEntryType = useCallback(
    (type: string): string => {
      switch (type.toUpperCase()) {
        case 'PURCHASE': return t('tokens.history.entryTypePurchase')
        case 'SPEND': return t('tokens.history.entryTypeSpend')
        case 'REFUND': return t('tokens.history.entryTypeRefund')
        case 'ADJUSTMENT': return t('tokens.history.entryTypeAdjustment')
        default: return type
      }
    },
    [t]
  )

  // ── Data loading ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (trackedPageVisit.current) return
    trackedPageVisit.current = true
    trackMonetizationPageVisited({
      pagePath: '/tokens',
      surface: 'tokens_page',
      focusPlanTier: 'tokens',
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [catalogRes, rulesRes, historyRes] = await Promise.all([
        fetch('/api/monetization/catalog', { cache: 'no-store' }),
        fetch('/api/tokens/spend-rules', { cache: 'no-store' }),
        fetch('/api/tokens/history?limit=30', { cache: 'no-store' }),
      ])

      const [catalogJson, rulesJson, historyJson] = await Promise.all([
        catalogRes.json().catch(() => ({})),
        rulesRes.json().catch(() => ({})),
        historyRes.json().catch(() => ({})),
      ])

      if (!catalogRes.ok) throw new Error(catalogJson.error || t('tokens.error.generic'))
      if (!rulesRes.ok) throw new Error(rulesJson.error || t('tokens.error.generic'))
      if (!historyRes.ok) throw new Error(historyJson.error || t('tokens.error.generic'))

      const packs = Array.isArray(catalogJson?.catalog?.tokenPacks) ? catalogJson.catalog.tokenPacks : []
      const nextRules = Array.isArray(rulesJson?.rules) ? rulesJson.rules : []
      const nextHistory = Array.isArray(historyJson?.entries) ? historyJson.entries : []
      setIsAdminBypassAccount(Boolean(historyJson.isAdminBypassAccount))

      setTokenPacks(
        packs.map((pack: any) => ({
          sku: String(pack.sku),
          title: String(pack.title),
          description: String(pack.description ?? ''),
          amountUsd: Number(pack.amountUsd ?? 0),
          tokenAmount: Number(pack.tokenAmount ?? 0),
          stripePriceConfigured: Boolean(pack.stripePriceConfigured),
        }))
      )
      setRules(
        nextRules.map((rule: any) => ({
          code: String(rule.code),
          category: String(rule.category),
          featureLabel: String(rule.featureLabel),
          description: String(rule.description ?? ''),
          tokenCost: Number(rule.tokenCost ?? 0),
          baseTokenCost: Number(rule.baseTokenCost ?? rule.tokenCost ?? 0),
          pricingTier:
            rule.pricingTier === 'low' || rule.pricingTier === 'mid' || rule.pricingTier === 'high'
              ? rule.pricingTier
              : 'mid',
          requiredPlan: rule.requiredPlan ? String(rule.requiredPlan) : null,
          discountPct: Number(rule.discountPct ?? 0),
          chargeMode:
            rule.chargeMode === 'subscriber_discounted_tokens'
              ? 'subscriber_discounted_tokens'
              : 'tokens_only',
          subscriptionEligible: Boolean(rule.subscriptionEligible),
          policyMessage: String(rule.policyMessage ?? ''),
          monthlyIncludedPremiumCredits:
            typeof rule.monthlyIncludedPremiumCredits === 'number'
              ? Number(rule.monthlyIncludedPremiumCredits)
              : null,
          supportsUnlimitedLowTierInFuture: Boolean(rule.supportsUnlimitedLowTierInFuture),
        }))
      )
      setHistory(
        nextHistory.map((entry: any) => ({
          id: String(entry.id),
          entryType: String(entry.entryType),
          tokenDelta: Number(entry.tokenDelta ?? 0),
          balanceAfter: Number(entry.balanceAfter ?? 0),
          spendFeatureLabel: entry.spendFeatureLabel ? String(entry.spendFeatureLabel) : null,
          description: entry.description ? String(entry.description) : null,
          createdAt: String(entry.createdAt),
        }))
      )
      if (nextRules[0]?.code) {
        setSelectedRuleCode((prev) => prev || String(nextRules[0].code))
      }
    } catch (e: any) {
      setError(e?.message || t('tokens.error.generic'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const postPurchaseSync = usePostPurchaseSync({
    successMessage: t('tokens.purchase.success'),
    tokenSuccessMessage: t('tokens.purchase.tokenSuccess'),
    onSuccess: () => {
      void load()
    },
  })

  useEffect(() => {
    void load()
  }, [load])

  // ── Derived state ─────────────────────────────────────────────────────────────

  const selectedRule = useMemo(
    () => rules.find((rule) => rule.code === selectedRuleCode) ?? null,
    [rules, selectedRuleCode]
  )
  const matrixCategories = useMemo(() => {
    const values = Array.from(new Set(rules.map((rule) => rule.category).filter(Boolean)))
    values.sort((a, b) => a.localeCompare(b))
    return values
  }, [rules])
  const filteredRules = useMemo(() => {
    const query = pricingSearch.trim().toLowerCase()
    return rules.filter((rule) => {
      if (pricingCategory !== 'all' && rule.category !== pricingCategory) return false
      if (discountOnly && !(rule.discountPct > 0 && rule.tokenCost < rule.baseTokenCost)) return false
      if (!query) return true
      return (
        rule.featureLabel.toLowerCase().includes(query) ||
        rule.description.toLowerCase().includes(query) ||
        rule.code.toLowerCase().includes(query)
      )
    })
  }, [rules, pricingSearch, pricingCategory, discountOnly])
  const pricingByTier = useMemo(() => {
    const bucket: Record<'low' | 'mid' | 'high', SpendRule[]> = { low: [], mid: [], high: [] }
    for (const rule of filteredRules) {
      bucket[rule.pricingTier].push(rule)
    }
    for (const tier of ['low', 'mid', 'high'] as const) {
      bucket[tier].sort((a, b) => {
        if (a.tokenCost !== b.tokenCost) return a.tokenCost - b.tokenCost
        return a.featureLabel.localeCompare(b.featureLabel)
      })
    }
    return bucket
  }, [filteredRules])
  const hasSubscriberDiscounts = useMemo(
    () => rules.some((rule) => rule.discountPct > 0 && rule.tokenCost < rule.baseTokenCost),
    [rules]
  )
  const hasMonthlyCreditsHints = useMemo(
    () => rules.some((r) => r.monthlyIncludedPremiumCredits != null && r.monthlyIncludedPremiumCredits > 0),
    [rules]
  )

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function startCheckout(sku: string) {
    setPendingSku(sku)
    setSpendMessage(null)
    trackTokenPurchaseClicked({
      sku,
      surface: 'tokens_page_pack_card',
      pagePath: '/tokens',
    })
    trackTokenPackCheckoutClicked({
      sku,
      surface: 'tokens_page_pack_card',
      couponApplied: Boolean(appliedCouponCode),
      couponCode: appliedCouponCode ?? undefined,
    })
    const result = await resolveCheckoutUrl({
      sku,
      productType: 'token_pack',
      returnPath: '/tokens',
      couponCode: appliedCouponCode,
    })
    if (!result.ok) {
      setError(result.error)
      setPendingSku(null)
      return
    }
    window.location.assign(result.url)
  }

  async function runSpendSimulator() {
    if (!selectedRule) return
    setPendingSpend(true)
    setSpendMessage(null)
    try {
      const { confirmed, preview } = await confirmTokenSpend(selectedRule.code)
      if (!preview.canSpend) {
        trackInsufficientTokenFlowViewed({
          surface: 'tokens_page_simulator',
          ruleCode: selectedRule.code,
          tokenCost: preview.tokenCost,
          currentBalance: preview.currentBalance,
        })
        setSpendMessage(
          tInterpolate('tokens.preview.insufficientBalance', {
            cost: String(preview.tokenCost),
            plural: preview.tokenCost === 1 ? '' : 's',
            balance: String(preview.currentBalance),
          })
        )
        return
      }
      if (!confirmed) {
        setSpendMessage(t('tokens.preview.spendCancelled'))
        return
      }

      const res = await fetch('/api/tokens/spend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ruleCode: selectedRule.code,
          confirmed: true,
          sourceType: 'tokens_page_simulator',
          sourceId: `simulator:${Date.now()}`,
          description: `Token simulator spend for ${selectedRule.featureLabel}`,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || t('tokens.preview.spendError'))
      }

      setSpendMessage(
        tInterpolate('tokens.preview.spendSuccess', {
          cost: String(selectedRule.tokenCost),
          plural: selectedRule.tokenCost === 1 ? '' : 's',
          feature: selectedRule.featureLabel,
        })
      )
      await Promise.all([refetchBalance(), load()])
    } catch (e: any) {
      setSpendMessage(e?.message || t('tokens.preview.spendError'))
    } finally {
      setPendingSpend(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05060a] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-[140px]" />
        <div className="absolute top-40 -left-40 h-[420px] w-[420px] rounded-full bg-fuchsia-500/8 blur-[160px]" />
        <div className="absolute -bottom-48 right-0 h-[480px] w-[480px] rounded-full bg-indigo-500/8 blur-[170px]" />
      </div>
      <div className="relative mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="rounded-2xl border border-white/[0.09] bg-[#0a1220]/95 p-5 shadow-lg shadow-black/20 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300/85">
                {t('tokens.header.breadcrumb')}
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {t('tokens.header.title')}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-white/65">
                {t('tokens.header.subtitleBefore')}{' '}
                <a
                  href="https://stripe.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-cyan-300/90 underline-offset-2 hover:underline"
                >
                  Stripe
                </a>
                {t('tokens.header.subtitleAfter')}
              </p>
            </div>
            <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
              <Link
                href="/"
                className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/85 transition hover:bg-white/[0.09]"
              >
                {t('tokens.header.homeLink')}
              </Link>
              <Link
                href="/pricing"
                className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
              >
                {t('tokens.header.plansLink')}
              </Link>
            </div>
          </div>

          {/* Balance chip */}
          <div
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-2"
            data-testid="tokens-balance-display"
          >
            <Coins className="h-4 w-4 text-amber-300" />
            {balanceLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
            ) : balanceError || balance == null ? (
              <span className="text-sm font-semibold text-amber-100/50 tabular-nums" data-testid="tokens-balance-unavailable">
                —
              </span>
            ) : (
              <span className="text-sm font-semibold text-amber-100 tabular-nums">{balance}</span>
            )}
            <span className="text-xs text-amber-100/80">{t('tokens.balance.available')}</span>
          </div>

          {/* Admin bypass notice — only shown when applicable */}
          {isAdminBypassAccount && (
            <p
              className="mt-2 text-[11px] italic text-amber-200/60"
              data-testid="tokens-header-admin-bypass-notice"
            >
              {t('tokens.history.adminBypassTitle')} — {t('tokens.history.empty')}
            </p>
          )}
        </header>

        {/* ── Post-purchase banner ────────────────────────────────────────── */}
        {postPurchaseSync.state.phase !== 'idle' ? (
          <section
            className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
              postPurchaseSync.state.phase === 'success'
                ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100'
                : postPurchaseSync.state.phase === 'cancelled'
                  ? 'border-amber-300/35 bg-amber-500/10 text-amber-100'
                  : postPurchaseSync.state.phase === 'failed'
                    ? 'border-red-400/35 bg-red-500/10 text-red-100'
                    : 'border-cyan-300/35 bg-cyan-500/10 text-cyan-100'
            }`}
            data-testid="post-purchase-sync-banner"
          >
            <p data-testid="post-purchase-sync-status">{postPurchaseSync.state.message}</p>
            {(postPurchaseSync.state.phase === 'pending' || postPurchaseSync.state.phase === 'failed') ? (
              <button
                type="button"
                onClick={() => void postPurchaseSync.retrySync()}
                disabled={postPurchaseSync.isSyncing}
                className="mt-2 rounded-lg border border-white/25 bg-black/25 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-black/35 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="post-purchase-sync-retry"
              >
                {postPurchaseSync.isSyncing ? t('tokens.purchase.refreshing') : t('tokens.purchase.retrySync')}
              </button>
            ) : null}
          </section>
        ) : null}

        {/* ── Error banner ──────────────────────────────────────────────── */}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {/* ── Loading skeleton ──────────────────────────────────────────── */}
        {loading ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/65">
            {t('tokens.loading')}
          </div>
        ) : (
          <>
            {/* ── Buy token packs ─────────────────────────────────────────── */}
            <section className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 sm:p-5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/75">
                {t('tokens.packs.title')}
              </h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/58">
                {t('tokens.packs.subtitleBefore')}{' '}
                <Link href="/pricing" className="font-medium text-cyan-300/90 underline-offset-2 hover:underline">
                  {t('tokens.packs.subtitleLinkLabel')}
                </Link>
                {t('tokens.packs.subtitleAfter')}
              </p>

              {/* Coupon input */}
              <div className="mt-4 space-y-3">
                <CouponInput
                  productType="token_pack"
                  placeholder="WassupFred"
                  onApplied={(code, pct) => {
                    setAppliedCouponCode(code)
                    setAppliedCouponPct(pct)
                    trackCouponApplied({ couponCode: code, discountPercent: pct, surface: 'tokens_page', productType: 'token_pack' })
                  }}
                  onRemoved={() => {
                    setAppliedCouponCode(null)
                    setAppliedCouponPct(0)
                  }}
                />
                {!appliedCouponCode && (
                  <SponsorCouponCard
                    compact
                    surface="tokens_page_packs"
                    href="/tokens"
                    onView={() => trackCouponViewed({ couponCode: 'WASSUPFRED', surface: 'tokens_page_packs', productType: 'token_pack' })}
                    onCopyClicked={() => {}}
                    onClaimClicked={() => {}}
                  />
                )}
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tokenPacks.map((pack) => (
                  <article
                    key={pack.sku}
                    className="flex min-h-[15rem] flex-col rounded-xl border border-white/10 bg-[#0a1220]/90 p-4"
                  >
                    <h3 className="text-sm font-semibold leading-snug text-white [overflow-wrap:anywhere]">
                      {pack.title}
                    </h3>
                    <p className="mt-2 flex-1 text-xs leading-relaxed text-white/58 [overflow-wrap:anywhere]">
                      {pack.description}
                    </p>
                    {pack.tokenAmount > 0 ? (
                      <p className="mt-2 text-[11px] font-medium text-cyan-200/90">
                        {tInterpolate('tokens.packs.tokenCount', { count: pack.tokenAmount.toLocaleString() })}
                      </p>
                    ) : null}
                    <div className="mt-3 flex items-baseline gap-2">
                      <span className={`text-xl font-bold tabular-nums ${appliedCouponCode ? 'text-white/40 line-through' : 'text-cyan-300'}`}>
                        {formatUsd(pack.amountUsd)}
                      </span>
                      {appliedCouponCode && appliedCouponPct > 0 && (
                        <span className="text-base font-black tabular-nums text-emerald-300">
                          {formatUsd(pack.amountUsd * (1 - appliedCouponPct / 100))}
                        </span>
                      )}
                    </div>
                    {appliedCouponCode && (
                      <p className="mt-1 text-[10px] font-bold text-emerald-400">
                        {appliedCouponPct}% off with {appliedCouponCode}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => void startCheckout(pack.sku)}
                      disabled={pendingSku != null || !pack.stripePriceConfigured}
                      className="mt-3 min-h-[44px] w-full rounded-lg bg-cyan-500/90 px-3 py-2.5 text-xs font-semibold text-[#041018] transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid={`tokens-buy-cta-${pack.sku}`}
                    >
                      {pendingSku === pack.sku ? t('tokens.packs.openingStripe') : t('tokens.packs.buyWithStripe')}
                    </button>
                    {pack.stripePriceConfigured ? (
                      <StripePaymentHint className="mt-2" />
                    ) : (
                      <p className="mt-2 text-[10px] text-amber-200/90">
                        {t('tokens.packs.checkoutUnavailable')}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>

            {/* ── Compliance notice ────────────────────────────────────────── */}
            <section className="mt-6">
              <MonetizationComplianceNotice />
            </section>

            {/* ── Pricing matrix ───────────────────────────────────────────── */}
            <section
              className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 sm:p-5"
              data-testid="tokens-pricing-matrix"
            >
              <h2 className="text-sm font-semibold text-white">{t('tokens.pricing.title')}</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/58">
                {t('tokens.pricing.subtitle')}
              </p>
              {hasSubscriberDiscounts ? (
                <p className="mt-2 rounded-md border border-emerald-400/25 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-100">
                  {t('tokens.pricing.subscriberDiscountActive')}
                </p>
              ) : null}

              {/* Filters row */}
              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
                <input
                  value={pricingSearch}
                  onChange={(event) => setPricingSearch(event.target.value)}
                  placeholder={t('tokens.pricing.searchPlaceholder')}
                  className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-xs text-white placeholder:text-white/45"
                  data-testid="tokens-pricing-search-input"
                />
                <select
                  value={pricingCategory}
                  onChange={(event) => setPricingCategory(event.target.value)}
                  className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-xs text-white"
                  data-testid="tokens-pricing-category-select"
                >
                  <option value="all">{t('tokens.pricing.allCategories')}</option>
                  {matrixCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setDiscountOnly((prev) => !prev)}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    discountOnly
                      ? 'border-emerald-300/35 bg-emerald-500/20 text-emerald-100'
                      : 'border-white/20 bg-black/25 text-white/75 hover:bg-black/35'
                  }`}
                  data-testid="tokens-pricing-discount-toggle"
                >
                  {discountOnly ? t('tokens.pricing.discountedOnlyOn') : t('tokens.pricing.discountedOnly')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPricingSearch('')
                    setPricingCategory('all')
                    setDiscountOnly(false)
                  }}
                  className="rounded-lg border border-white/20 bg-black/25 px-3 py-2 text-xs text-white/80 hover:bg-black/35"
                  data-testid="tokens-pricing-clear-filters"
                >
                  {t('tokens.pricing.clearFilters')}
                </button>
              </div>

              <p className="mt-2 text-[11px] text-white/55" data-testid="tokens-pricing-results-count">
                {tInterpolate('tokens.pricing.resultsCount', {
                  shown: String(filteredRules.length),
                  total: String(rules.length),
                })}
              </p>

              {/* Tier columns */}
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                {(['low', 'mid', 'high'] as const).map((tier) => (
                  <article
                    key={tier}
                    className="rounded-lg border border-white/10 bg-black/25 p-3"
                    data-testid={`tokens-pricing-tier-${tier}`}
                  >
                    <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-white/80">
                      {tierTitle(tier)}
                    </h3>
                    <div className="mt-2 space-y-2">
                      {pricingByTier[tier].length > 0 ? (
                        pricingByTier[tier].map((rule) => (
                          <div key={rule.code} className="rounded-md border border-white/10 bg-black/30 px-2 py-2">
                            <div className="flex items-start justify-between gap-2">
                              <p className="min-w-0 flex-1 break-words text-[11px] font-medium leading-snug text-white/90">
                                {rule.featureLabel}
                              </p>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  rule.discountPct > 0 && rule.tokenCost < rule.baseTokenCost
                                    ? 'border border-emerald-300/40 bg-emerald-500/15 text-emerald-100'
                                    : 'border border-cyan-300/35 bg-cyan-500/15 text-cyan-100'
                                }`}
                                data-testid={`tokens-pricing-effective-badge-${rule.code}`}
                              >
                                {tInterpolate('tokens.pricing.tokenBadge', {
                                  count: String(rule.tokenCost),
                                  plural: rule.tokenCost === 1 ? '' : 's',
                                })}
                              </span>
                            </div>
                            <p className="mt-1 text-[10px] text-white/60">
                              {formatPlanLabel(rule.requiredPlan)}
                            </p>
                            {rule.discountPct > 0 && rule.tokenCost < rule.baseTokenCost ? (
                              <p className="mt-1 text-[10px] text-emerald-200/90">
                                {tInterpolate('tokens.pricing.subscriberPrice', {
                                  base: String(rule.baseTokenCost),
                                  pct: String(rule.discountPct),
                                })}
                              </p>
                            ) : null}
                            {rule.monthlyIncludedPremiumCredits != null && rule.monthlyIncludedPremiumCredits > 0 ? (
                              <p
                                className="mt-1 text-[10px] text-amber-200/70"
                                title={t('tokens.pricing.monthlyCreditsFootnote')}
                              >
                                {tInterpolate('tokens.pricing.monthlyCreditsHint', {
                                  count: String(rule.monthlyIncludedPremiumCredits),
                                  plural: rule.monthlyIncludedPremiumCredits === 1 ? '' : 's',
                                })}
                              </p>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <p className="text-[11px] text-white/50">{t('tokens.pricing.noRulesInTier')}</p>
                      )}
                    </div>
                  </article>
                ))}
              </div>

              {/* Monthly credits footnote — only rendered when relevant */}
              {hasMonthlyCreditsHints ? (
                <p className="mt-3 text-[10px] text-white/40">
                  {t('tokens.pricing.monthlyCreditsFootnote')}
                </p>
              ) : null}
            </section>

            {/* ── Feature cost preview ─────────────────────────────────────── */}
            <section className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-white">{t('tokens.preview.title')}</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/58">
                {t('tokens.preview.subtitle')}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                <select
                  value={selectedRuleCode}
                  onChange={(event) => setSelectedRuleCode(event.target.value)}
                  className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-xs text-white"
                  data-testid="tokens-spend-rule-select"
                >
                  {rules.map((rule) => (
                    <option key={rule.code} value={rule.code}>
                      {rule.featureLabel} ({tInterpolate('tokens.pricing.tokenBadge', {
                        count: String(rule.tokenCost),
                        plural: rule.tokenCost === 1 ? '' : 's',
                      })}{rule.discountPct > 0 && rule.tokenCost < rule.baseTokenCost
                        ? `, was ${rule.baseTokenCost}`
                        : ''})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void runSpendSimulator()}
                  disabled={!selectedRule || pendingSpend}
                  className="rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-60"
                  data-testid="tokens-spend-confirm"
                >
                  {pendingSpend ? t('tokens.preview.processing') : t('tokens.preview.confirmSpend')}
                </button>
              </div>
              {selectedRule ? (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-white/65">{selectedRule.description}</p>
                  <p className="text-[11px] text-white/55">
                    {tInterpolate('tokens.preview.tierAndPlan', {
                      tier: tierTitle(selectedRule.pricingTier),
                      plan: formatPlanLabel(selectedRule.requiredPlan),
                    })}
                  </p>
                  {selectedRule.policyMessage ? (
                    <p className="text-[11px] text-white/60">{selectedRule.policyMessage}</p>
                  ) : null}
                </div>
              ) : null}
              {spendMessage ? (
                <p
                  className="mt-3 rounded-md border border-amber-400/25 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-100"
                  data-testid="tokens-insufficient-state"
                >
                  {spendMessage}
                </p>
              ) : null}
            </section>

            {/* ── Usage history ────────────────────────────────────────────── */}
            <section className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-white">{t('tokens.history.title')}</h2>
                <button
                  type="button"
                  onClick={() => setHistoryOpen((prev) => !prev)}
                  className="rounded-md border border-white/20 bg-black/20 px-2 py-1 text-[11px] text-white/80 hover:bg-black/30"
                  data-testid="tokens-usage-history-toggle"
                >
                  {historyOpen ? t('tokens.history.hideHistory') : t('tokens.history.openHistory')}
                </button>
              </div>
              {historyOpen ? (
                <div className="mt-3 space-y-2" data-testid="tokens-usage-history-panel">
                  {history.length > 0 ? (
                    history.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-white/90">
                            {entry.spendFeatureLabel || entry.description || humanizeEntryType(entry.entryType)}
                          </p>
                          <p className="text-[11px] text-white/55">
                            {new Date(entry.createdAt).toLocaleString()} · {humanizeEntryType(entry.entryType)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={`text-sm font-semibold tabular-nums ${
                              entry.tokenDelta < 0 ? 'text-red-200' : 'text-emerald-200'
                            }`}
                          >
                            {formatDelta(entry.tokenDelta)}
                          </p>
                          <p className="text-[11px] text-white/55">
                            {tInterpolate('tokens.history.balanceAfter', { balance: String(entry.balanceAfter) })}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : isAdminBypassAccount ? (
                    <div
                      className="rounded-lg border border-amber-400/20 bg-amber-500/[0.08] p-3"
                      data-testid="tokens-admin-bypass-notice"
                    >
                      <p className="text-xs font-semibold text-amber-200/80">
                        {t('tokens.history.adminBypassTitle')}
                      </p>
                      <p className="mt-0.5 text-[11px] text-white/50">
                        {t('tokens.history.adminBypassBody')}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-white/55">{t('tokens.history.empty')}</p>
                  )}
                </div>
              ) : null}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
