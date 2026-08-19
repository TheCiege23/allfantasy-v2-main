'use client'

import { useMemo, useState } from 'react'
import { useGeoRestriction } from '@/lib/geo/useGeoRestriction'
import { resolveCheckoutUrl } from '@/lib/monetization/checkout-client'
import { PLAN_FAMILY_INCLUDES, type PlanFamilyKey } from '@/lib/monetization/planIncludes'
import { LockedFeatureBanner } from '@/components/monetization/LockedFeatureBanner'
import { CheckoutOutcomePanel } from '@/components/monetization/CheckoutOutcomePanel'
import { usePostPurchaseSync } from '@/hooks/usePostPurchaseSync'
import '@/components/core-app/af-pricing.css'

/**
 * Screen 18a — pricing.
 *
 * ⚠ EVERY FIGURE COMES FROM THE CATALOG VIA getPlanPresentations. Nothing here is
 * typed as a literal. That is not tidiness: the token grants were wrong in three
 * separate files this morning, each of which had transcribed a number rather than
 * derived it, and the copy customers read was never the load-bearing one. A
 * pricing page that restates prices is a fourth place for them to be wrong.
 *
 * ⚠ TWO DELIBERATE DEPARTURES FROM THE HANDOFF, BOTH BECAUSE THE FACTS MOVED:
 *
 * 1. NO TOKEN LINE ON PLAN CARDS. The design puts an allowance on every one.
 *    Subscriptions no longer grant tokens at all — tokens are the pay-per-use path
 *    for people who do not subscribe — so that line would describe a product we
 *    stopped selling.
 *
 * 2. "BEST VALUE" ON SUPREME, NOT "MOST POPULAR" ON COMMISSIONER. Popularity is a
 *    claim about behaviour and there are currently zero subscribers, so it would be
 *    fabricated social proof. "Best value" is arithmetic anyone can check: Supreme
 *    is $19.99 against $24.98 for Pro and Commissioner bought separately.
 */

export type PricingPlan = {
  planFamily: string
  name: string
  description: string
  monthlySku: string | null
  monthlyPrice: number | null
  yearlySku: string | null
  yearlyPrice: number | null
  savings: { savedUsd: number; savedPct: number; effectiveMonthly: number } | null
}

export type PricingPack = {
  sku: string
  title: string
  amountUsd: number
  tokenAmount: number | null
}

export type PricingV4Props = {
  plans: PricingPlan[]
  packs: PricingPack[]
  /** Derived headline, e.g. "Save 28% paying yearly". Null when no plan has a yearly saving. */
  savingsHeadline: string | null
}

type Interval = 'month' | 'year'

/**
 * ⚠ ASCENDING BY PRICE, WHICH IS NOT THE ORDER THE HANDOFF DRAWS. The design put
 * Legacy last, after Supreme, because Legacy was then the $29.99 top tier. It is
 * now $9.99 — a peer of Pro — so leaving it in the last column would present the
 * cheapest paid plan as the most premium one. Price order also makes Supreme the
 * natural endpoint, which is what it now is.
 */
const LANE_ORDER = ['af_pro', 'af_war_room', 'af_commissioner', 'af_supreme'] as const

const FREE_INCLUDES = [
  'Every league you play, in one place',
  'Live scores and standings',
  'Import from Sleeper, ESPN and Yahoo',
]

function money(n: number): string {
  // Whole dollars lose the .00 — "$80" reads as a price, "$80.00" as an invoice.
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
}

export function PricingV4({ plans, packs, savingsHeadline }: PricingV4Props) {
  const [interval, setInterval] = useState<Interval>('month')
  const [pendingSku, setPendingSku] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const geo = useGeoRestriction()
  const blocked = geo.isPaidBlocked && !geo.loading
  const postPurchase = usePostPurchaseSync({
    successMessage: 'Purchase complete. We refreshed your access.',
  })

  const ordered = useMemo(
    () =>
      LANE_ORDER.map((f) => plans.find((p) => p.planFamily === f)).filter(
        (p): p is PricingPlan => p != null
      ),
    [plans]
  )

  async function startCheckout(sku: string, productType: 'subscription' | 'token_pack') {
    setError(null)
    setPendingSku(sku)
    const result = await resolveCheckoutUrl({ sku, productType, returnPath: '/pricing' })
    if (!result.ok) {
      setError(result.error)
      setPendingSku(null)
      return
    }
    window.location.assign(result.url)
  }

  return (
    <div className="af-pr">
      {/*
        Answers to questions the visitor arrived with, above the pitch. Both render
        nothing in the ordinary case.
      */}
      <div className="af-pr-alerts">
        <CheckoutOutcomePanel phase={postPurchase.state.phase} onRetry={postPurchase.retrySync} />
        <LockedFeatureBanner />
      </div>

      <header className="af-pr-hero">
        <span className="af-pr-eyebrow">Pricing</span>
        <h1 className="af-pr-title">Win more with tools built for fantasy managers</h1>
        <p className="af-pr-sub">
          Every league, live score and standing is free forever. Subscribe for Chimmy intelligence
          and commissioner tools — or buy tokens when you need them.
        </p>

        <div className="af-pr-toggle-row">
          <div className="af-pr-toggle" role="group" aria-label="Billing interval">
            <button
              type="button"
              className="af-pr-toggle-btn"
              data-on={interval === 'month'}
              onClick={() => setInterval('month')}
            >
              Monthly
            </button>
            <button
              type="button"
              className="af-pr-toggle-btn"
              data-on={interval === 'year'}
              onClick={() => setInterval('year')}
            >
              Yearly
            </button>
          </div>
          {/*
            ⚠ COMPUTED FROM THE CATALOG, NOT WRITTEN DOWN. The handoff specifies
            "yearly = 2 months free". That was true of the old prices and is not of
            these. Deriving it means the chip cannot outlive the prices it describes.
          */}
          {savingsHeadline ? <span className="af-pr-savechip">{savingsHeadline}</span> : null}
        </div>
      </header>

      {blocked ? (
        <p className="af-pr-blocked">
          Paid plans are not available in your state. Everything free stays available.
        </p>
      ) : null}
      {error ? <p className="af-pr-error">{error}</p> : null}

      <div className="af-pr-grid">
        {/* ── Free ─────────────────────────────────────────────── */}
        <section className="af-pr-card">
          <h2 className="af-pr-name">Free</h2>
          <p className="af-pr-desc">Every league you play, in one place. No card, no trial clock.</p>
          <div className="af-pr-price">
            <span className="af-pr-amount">$0</span>
          </div>
          <p className="af-pr-per">free forever</p>
          <a href="/signup" className="af-pr-cta af-pr-cta--ghost">
            Create an account
          </a>
          <hr className="af-pr-rule" />
          <ul className="af-pr-features">
            {FREE_INCLUDES.map((f) => (
              <li key={f}>
                <span className="af-pr-tick" aria-hidden>
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
        </section>

        {/* ── Paid lanes ───────────────────────────────────────── */}
        {ordered.map((plan) => {
          const sku = interval === 'month' ? plan.monthlySku : plan.yearlySku
          const price = interval === 'month' ? plan.monthlyPrice : plan.yearlyPrice
          const best = plan.planFamily === 'af_supreme'
          const includes = PLAN_FAMILY_INCLUDES[plan.planFamily as PlanFamilyKey] ?? []

          return (
            <section key={plan.planFamily} className="af-pr-card" data-best={best}>
              {best ? <span className="af-pr-tab">Best value</span> : null}
              <h2 className="af-pr-name">{plan.name}</h2>
              <p className="af-pr-desc">{plan.description}</p>

              <div className="af-pr-price">
                {price == null ? (
                  <span className="af-pr-amount af-pr-amount--none">—</span>
                ) : (
                  <span className="af-pr-amount">{money(price)}</span>
                )}
              </div>
              <p className="af-pr-per">
                {price == null
                  ? `not sold ${interval === 'month' ? 'monthly' : 'yearly'}`
                  : interval === 'month'
                    ? 'per month'
                    : 'per year'}
              </p>

              {/*
                On the yearly view, show what it works out to per month and what
                that saves. Both are computed; neither is a rounded month count,
                because .99 pricing makes "2 months free" a fudge in one direction
                or the other.
              */}
              {interval === 'year' && plan.savings ? (
                <p className="af-pr-save">
                  {money(plan.savings.effectiveMonthly)}/mo · save {money(plan.savings.savedUsd)} (
                  {plan.savings.savedPct}%)
                </p>
              ) : (
                <p className="af-pr-save af-pr-save--empty" aria-hidden />
              )}

              <button
                type="button"
                className="af-pr-cta"
                disabled={!sku || blocked || pendingSku === sku}
                onClick={() => sku && startCheckout(sku, 'subscription')}
              >
                {pendingSku === sku ? 'Opening checkout…' : `Choose ${plan.name}`}
              </button>

              <hr className="af-pr-rule" />
              <ul className="af-pr-features">
                {includes.map((f) => (
                  <li key={f}>
                    <span className="af-pr-tick" aria-hidden>
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {/* ── Tokens ─────────────────────────────────────────────── */}
      <section className="af-pr-tokens">
        <div className="af-pr-tokens-head">
          <h2 className="af-pr-h2">Or pay only for what you use</h2>
          <p className="af-pr-sub af-pr-sub--tight">
            Tokens are for managers who do not want a subscription. Every action shows its cost
            before you click, and what you buy never expires into a monthly reset.
          </p>
        </div>
        <div className="af-pr-packs">
          {packs.map((pack) => (
            <div key={pack.sku} className="af-pr-pack">
              <span className="af-pr-pack-tokens">
                {pack.tokenAmount != null ? pack.tokenAmount.toLocaleString() : '—'}
              </span>
              <span className="af-pr-pack-label">tokens</span>
              <span className="af-pr-pack-price">{money(pack.amountUsd)}</span>
              <button
                type="button"
                className="af-pr-cta af-pr-cta--small"
                disabled={blocked || pendingSku === pack.sku}
                onClick={() => startCheckout(pack.sku, 'token_pack')}
              >
                {pendingSku === pack.sku ? 'Opening…' : 'Buy'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <footer className="af-pr-foot">
        <p>
          Checkout is handled by Stripe — we never see your card details. Cancel any time from
          Settings → Billing. League dues and payouts are handled on FanCred, separately from your
          AllFantasy subscription.
        </p>
      </footer>
    </div>
  )
}

export default PricingV4
