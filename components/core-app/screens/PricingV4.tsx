'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useGeoRestriction } from '@/lib/geo/useGeoRestriction'
import { resolveCheckoutUrl } from '@/lib/monetization/checkout-client'
import { PLAN_FAMILY_INCLUDES, type PlanFamilyKey } from '@/lib/monetization/planIncludes'
import { LockedFeatureBanner } from '@/components/monetization/LockedFeatureBanner'
import { CheckoutOutcomePanel } from '@/components/monetization/CheckoutOutcomePanel'
import { usePostPurchaseSync } from '@/hooks/usePostPurchaseSync'
// af-core.css carries the .af-core token layer (--surface, --line, --chip, --text2 …)
// that every rule in af-pricing.css reads. AfCoreShell imports it for screens inside
// the shell; this one renders standalone at /pricing, so without this line the whole
// token layer is missing. Measured on the live page before this fix: 11 of the 20
// tokens af-pricing.css consumes computed to the EMPTY STRING — --surface, --surface2,
// --line, --line2, --text2, --chip, --chip-line, --accent-ink, --good-soft, --warn-soft
// and --chimmy — while --accent fell through to the unrelated #2563EB in
// app/globals.css instead of the design's #22d3ee teal. Plan cards painted with
// background rgba(0,0,0,0) and no border, the checkout buttons rendered as unfilled
// transparent rectangles, and in dark mode the page background computed to pure black
// rather than #06070f. Must precede af-pricing.css so the tokens exist before use.
//
// Same failure, same fix as LandingV4.tsx and AuthV4.tsx — both of which carry the
// equivalent note. This screen was simply missed when those two were repaired.
import '@/components/core-app/af-core.css'
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
 *    (Re-confirmed by the owner 2026-08-19 against handoff 18a build rule 2, which
 *    asks for MOST POPULAR on Commissioner. The departure stands.)
 *
 * ⚠ THE ROOT ELEMENT MUST CARRY `af-core` AS WELL AS `af-pr`. This is the second
 * half of the token fix described at the af-core.css import above, and it is easy
 * to do one without the other: af-core.css declares the palette on the `.af-core`
 * SCOPE rather than at :root — deliberately, so the handoff cannot repaint the
 * rest of the product — so importing the stylesheet without also naming the class
 * leaves every var() in af-pricing.css still resolving to nothing. This screen
 * shipped with neither half.
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

/** Same mark as the landing nav, so the two public pages share one brand lockup. */
function Shield() {
  return (
    <svg width="26" height="28" viewBox="0 0 28 30" aria-hidden focusable="false">
      <path
        d="M14 1.5 26 6v10.5c0 6.4-5 10.6-12 12.5-7-1.9-12-6.1-12-12.5V6l12-4.5Z"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <text
        x="14"
        y="19"
        textAnchor="middle"
        fill="var(--accent)"
        style={{ font: '900 10px Archivo, sans-serif', letterSpacing: '0.02em' }}
      >
        AF
      </text>
    </svg>
  )
}

/**
 * ⚠ THE COMPLIANCE ANSWER IS VERBATIM FROM THE HANDOFF AND MUST STAY THAT WAY —
 * build rule 5. The WA block and the HI/ID/MT/NV restriction are real
 * geo-restrictions enforced by useGeoRestriction, not filler copy.
 *
 * ⚠ NO TOKEN-ALLOWANCE OR TOKEN-DISCOUNT CLAIM APPEARS HERE. The handoff's trust
 * strip promises "every plan discounts token costs on top: 20% on Pro and
 * Commissioner, 25% on Legacy, 45% on Supreme". Every one of those is 0 in
 * lib/tokens/subscription-policy.ts, and that file notes the zeroes are
 * load-bearing — grantMonthlyCreditsFromInvoice bails on <= 0, so they are what
 * actually stops the Stripe webhook crediting anything. Printing the discounts
 * would advertise a product that was deliberately withdrawn.
 */
const FAQS: { q: string; a: string }[] = [
  {
    q: 'What stays free?',
    a: "Every league, live score and standing. Imports are unlimited and there's no trial clock on them.",
  },
  {
    q: 'Do you take league dues?',
    a: "No. League dues and payouts are handled on FanCred — AllFantasy never holds your league's money.",
  },
  {
    q: 'Can I cancel?',
    a: 'Any time, from Settings → Billing. Purchases follow the pricing shown at checkout and the applicable refund policy.',
  },
  {
    q: 'Is this gambling?',
    a: 'No. 100% season-long fantasy — no sportsbook, no daily fantasy. Not available in WA; paid leagues restricted in HI, ID, MT, NV.',
  },
]

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

  /*
   * Only lanes that are actually sold yearly. A plan with no yearly SKU has no
   * annual price to show, and rendering it with a dash would read as "free
   * yearly" rather than "not sold that way".
   */
  const yearlyLanes = useMemo(
    () => ordered.filter((p) => p.yearlySku != null && p.yearlyPrice != null),
    [ordered]
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
    <div className="af-core af-pr">
      {/*
        ⚠ THIS PAGE HAD NO NAVIGATION AT ALL. Measured on the live page: zero
        <nav> elements and zero links to "/". A visitor who arrived here could
        not get back to the site, could not sign in, and could not reach Terms
        or Privacy — the only <footer> was the Stripe disclaimer paragraph. The
        handoff draws this 62px header and it is the fix.

        The wordmark is the way home, matching the auth screens.
      */}
      <nav className="af-pr-nav" aria-label="Main">
        <Link href="/" className="af-pr-brand">
          <Shield />
          <span className="af-pr-wordmark">Pricing</span>
        </Link>
        <div className="af-pr-nav-right">
          <Link href="/login" className="af-pr-nav-link">
            Sign in
          </Link>
          <Link href="/signup" className="af-pr-nav-cta">
            Start free
          </Link>
        </div>
      </nav>

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

              {/*
                ⚠ THE data-testid IS A CONTRACT, NOT DECORATION. The monetization
                e2e suite drives every purchase path through
                `pricing-subscription-cta-{sku}` and `pricing-token-cta-{sku}` —
                the ids the previous /pricing surface
                (components/monetization/MonetizationPurchaseSurface.tsx) emitted.
                This screen replaced that surface and kept the behaviour but not
                the ids, so 18 checkout tests started failing on "element(s) not
                found" and the purchase flow lost its coverage silently. The
                shards were already red for other reasons, so nothing surfaced it.
              */}
              <button
                type="button"
                className="af-pr-cta"
                data-testid={sku ? `pricing-subscription-cta-${sku}` : undefined}
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

      {/*
        ── Yearly, beside the tokens card ─────────────────────────
        The handoff pairs these two as a 2-up row, and they answer the two
        questions the grid above leaves open: "what if I pay once a year" and
        "what if I do not want a subscription at all".

        ⚠ NO TOKEN COUNTS ON THE YEARLY CARDS. The handoff prints an allowance
        under each one (3,500 / 1,500 / 15,000 / 3,500) and captions the panel
        "tokens are granted for the whole year up front". Yearly grants are 0 for
        every plan, exactly like the monthly ones — see the FAQS note above. The
        prices here are real and come from the catalog; the token lines are not,
        so they are absent rather than transcribed.
      */}
      <div className="af-pr-row">
        {yearlyLanes.length > 0 ? (
          <section className="af-pr-yearly">
            <div className="af-pr-tokens-head">
              <h2 className="af-pr-h2">Yearly, if you&rsquo;d rather pay once</h2>
              <p className="af-pr-sub af-pr-sub--tight">
                The same plans billed annually. Every figure below is what the card is
                charged.
              </p>
            </div>
            <div className="af-pr-yearly-grid">
              {yearlyLanes.map((plan) => (
                <div key={plan.planFamily} className="af-pr-yearly-card">
                  <span className="af-pr-yearly-name">{plan.name}</span>
                  <span className="af-pr-yearly-price">{money(plan.yearlyPrice as number)}</span>
                  {plan.savings ? (
                    <span className="af-pr-yearly-save af-num">
                      {money(plan.savings.effectiveMonthly)}/mo · save {plan.savings.savedPct}%
                    </span>
                  ) : (
                    <span className="af-pr-yearly-save af-pr-yearly-save--empty" aria-hidden />
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : null}

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
                data-testid={`pricing-token-cta-${pack.sku}`}
                disabled={blocked || pendingSku === pack.sku}
                onClick={() => startCheckout(pack.sku, 'token_pack')}
              >
                {pendingSku === pack.sku ? 'Opening…' : 'Buy'}
              </button>
            </div>
          ))}
        </div>
      </section>
      </div>

      {/* ── FAQ ────────────────────────────────────────────────── */}
      <section className="af-pr-faq" aria-labelledby="af-pr-faq-h">
        <h2 className="af-pr-h2" id="af-pr-faq-h">
          Before you decide
        </h2>
        <div className="af-pr-faq-grid">
          {FAQS.map((f) => (
            <article key={f.q} className="af-pr-faq-item">
              <h3 className="af-pr-faq-q">{f.q}</h3>
              <p className="af-pr-faq-a">{f.a}</p>
            </article>
          ))}
        </div>
      </section>

      {/*
        Trust strip + closing CTA, as drawn — minus the token-discount sentence,
        which describes percentages that are all 0. What is left is true and is
        the part a hesitating buyer actually needs.
      */}
      <footer className="af-pr-foot">
        <p>
          Checkout is handled by Stripe — we never see your card details. League dues and payouts
          are handled on FanCred, separately from your AllFantasy subscription.
        </p>
        <Link href="/signup" className="af-pr-foot-cta">
          Start free
        </Link>
      </footer>
    </div>
  )
}

export default PricingV4
