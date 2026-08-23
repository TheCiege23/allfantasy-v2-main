'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useGeoRestriction } from '@/lib/geo/useGeoRestriction'
import { resolveCheckoutUrl } from '@/lib/monetization/checkout-client'
import { PLAN_FAMILY_INCLUDES, type PlanFamilyKey } from '@/lib/monetization/planIncludes'
import { LockedFeatureBanner } from '@/components/monetization/LockedFeatureBanner'
import { CheckoutOutcomePanel } from '@/components/monetization/CheckoutOutcomePanel'
import { usePostPurchaseSync } from '@/hooks/usePostPurchaseSync'
import {
  getTermsUrl,
  getPrivacyUrl,
  getNoGamblingPolicyUrl,
} from '@/lib/legal/legal-route-resolver'
import {
  getPricingCopy,
  PRICING_PATHS,
  PRICING_LANGS,
  DEFAULT_PRICING_LANG,
  type PricingLang,
} from '@/lib/i18n/pricing-copy'
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
  /**
   * Smallest real yearly saving, as a PERCENTAGE. Null when no plan is sold yearly.
   *
   * ⚠ A NUMBER, NOT THE FORMATTED SENTENCE. This used to arrive as
   * describeYearlySavings()'s English "Save 28% paying yearly", which rendered
   * verbatim on the Spanish page in the middle of otherwise-translated copy.
   * The figure is still derived from the catalog; only the wording is local.
   */
  savingsPct: number | null
  /**
   * The sku this visitor picked BEFORE being sent to signup, echoed back by the
   * `?plan=` on the callbackUrl (see startCheckout's 401 branch).
   *
   * Passed down from the server page rather than read here with
   * useSearchParams, so this component needs no Suspense boundary and the value
   * is present in the server-rendered HTML instead of appearing after hydration.
   */
  pickedSku?: string | null
  /** Which language of the page this is. Drives copy, the canonical and the switch. */
  lang?: PricingLang
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

export function PricingV4({
  plans,
  packs,
  savingsPct,
  pickedSku = null,
  lang = DEFAULT_PRICING_LANG,
}: PricingV4Props) {
  const c = getPricingCopy(lang)
  /*
   * Someone returning from signup picked a lane before they left. Opening on the
   * interval they were actually looking at means a yearly pick does not silently
   * become a monthly one on the way back.
   */
  const [interval, setInterval] = useState<Interval>(() =>
    pickedSku && plans.some((p) => p.yearlySku === pickedSku) ? 'year' : 'month',
  )
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

  /**
   * ⚠ A 401 IS A REDIRECT TO MAKE, NOT A MESSAGE TO PRINT.
   *
   * Measured on the live page: a signed-out visitor clicking "Choose AF Pro" got
   * a full-width error bar reading exactly `Unauthorized` — the checkout
   * endpoint's raw string — and nothing else. No prompt, no link, no way on. The
   * page's entire purpose failed for the audience the landing page sends here,
   * and it failed in developer language.
   *
   * Signed-out is not an error state on a pricing page; it is the expected state
   * of someone deciding whether to buy. So the 401 branch carries the intent to
   * signup instead: `callbackUrl` returns them here afterwards, and `plan` marks
   * the card they picked so the choice survives the round trip.
   *
   * ⚠ THE BUTTON STILL CALLS THE API RATHER THAN LINKING STRAIGHT TO /signup, AND
   * THAT IS DELIBERATE. e2e/monetization-checkout-click-audit.spec.ts drives
   * these testids with the checkout endpoint mocked and no session, asserting the
   * click reaches the endpoint and follows the returned url. Turning the CTA into
   * a link when signed out would break every one of those paths while looking
   * like a UX improvement. Branching on the RESPONSE keeps that contract exactly:
   * a mocked 200 still navigates to checkout, and the spec's 400 case still
   * renders its message inline. Only a real 401 changes behaviour.
   */
  async function startCheckout(sku: string, productType: 'subscription' | 'token_pack') {
    setError(null)
    setPendingSku(sku)
    /*
     * ⚠ BOTH RETURN PATHS ARE THE READER'S OWN LANGUAGE, NOT A HARDCODED
     * `/pricing`. Sending a Spanish visitor to signup and then landing them back
     * on the ENGLISH pricing page would undo the whole point of /es/pricing at
     * the last step of the funnel — and it is the easy mistake here, because the
     * literal reads correctly in the English case.
     */
    const self = PRICING_PATHS[lang]
    const result = await resolveCheckoutUrl({ sku, productType, returnPath: self })
    if (!result.ok) {
      if (result.status === 401) {
        const back = `${self}?plan=${encodeURIComponent(sku)}`
        window.location.assign(`/signup?callbackUrl=${encodeURIComponent(back)}`)
        return
      }
      setError(result.error)
      setPendingSku(null)
      return
    }
    window.location.assign(result.url)
  }

  return (
    <div className="af-core af-pr" lang={c.htmlLang}>
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
          <span className="af-pr-wordmark">{c.nav.wordmark}</span>
        </Link>
        <div className="af-pr-nav-right">
          {/* Two plain links, same rule as the landing switch: a real href per
              language keeps both documents crawlable and shareable. */}
          <div className="af-pr-lang" role="group" aria-label={c.foot.langLabel}>
            {PRICING_LANGS.map((code) => (
              <Link
                key={code}
                href={PRICING_PATHS[code]}
                hrefLang={code}
                className="af-pr-lang-opt"
                data-active={code === lang ? 'true' : undefined}
                aria-current={code === lang ? 'true' : undefined}
              >
                {code === 'en' ? 'EN' : 'ES'}
              </Link>
            ))}
          </div>
          <Link href="/login" className="af-pr-nav-link">
            {c.nav.signIn}
          </Link>
          <Link href="/signup" className="af-pr-nav-cta">
            {c.nav.startFree}
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
        <span className="af-pr-eyebrow">{c.hero.eyebrow}</span>
        <h1 className="af-pr-title">{c.hero.title}</h1>
        <p className="af-pr-sub">{c.hero.sub}</p>

        <div className="af-pr-toggle-row">
          <div className="af-pr-toggle" role="group" aria-label={c.toggle.label}>
            <button
              type="button"
              className="af-pr-toggle-btn"
              data-on={interval === 'month'}
              onClick={() => setInterval('month')}
            >
              {c.toggle.monthly}
            </button>
            <button
              type="button"
              className="af-pr-toggle-btn"
              data-on={interval === 'year'}
              onClick={() => setInterval('year')}
            >
              {c.toggle.yearly}
            </button>
          </div>
          {/*
            ⚠ COMPUTED FROM THE CATALOG, NOT WRITTEN DOWN. The handoff specifies
            "yearly = 2 months free". That was true of the old prices and is not of
            these. Deriving it means the chip cannot outlive the prices it describes.
          */}
          {savingsPct != null ? (
            <span className="af-pr-savechip">{c.card.savingsChip(savingsPct)}</span>
          ) : null}
        </div>
      </header>

      {blocked ? (
        <p className="af-pr-blocked">{c.blocked}</p>
      ) : null}
      {error ? <p className="af-pr-error">{error}</p> : null}

      <div className="af-pr-grid">
        {/* ── Free ─────────────────────────────────────────────── */}
        <section className="af-pr-card">
          <h2 className="af-pr-name">{c.free.name}</h2>
          <p className="af-pr-desc">{c.free.desc}</p>
          <div className="af-pr-price">
            <span className="af-pr-amount">$0</span>
          </div>
          <p className="af-pr-per">{c.free.per}</p>
          {/* <Link>, not <a> — this was the one signup CTA of three doing a full
              document reload instead of a client navigation. */}
          <Link href="/signup" className="af-pr-cta af-pr-cta--ghost">
            {c.free.cta}
          </Link>
          <hr className="af-pr-rule" />
          <ul className="af-pr-features">
            {c.free.includes.map((f) => (
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
          /*
           * Spanish supplies its own bullets and description; English passes null
           * and falls through to the catalog, so the English strings keep exactly
           * one source and cannot drift into a translated second copy.
           */
          const family = plan.planFamily as PlanFamilyKey
          const includes = c.planIncludes?.[family] ?? PLAN_FAMILY_INCLUDES[family] ?? []
          const description = c.planDescriptions?.[family] ?? plan.description
          /*
           * The lane this visitor chose before signup sent them away. Matched on
           * either sku so the mark survives whichever interval they were on.
           */
          const picked =
            pickedSku != null &&
            (plan.monthlySku === pickedSku || plan.yearlySku === pickedSku)

          return (
            <section
              key={plan.planFamily}
              className="af-pr-card"
              data-best={best}
              data-picked={picked || undefined}
              data-testid={picked ? 'pricing-picked-card' : undefined}
            >
              {best ? <span className="af-pr-tab">{c.card.bestValue}</span> : null}
              {picked ? <span className="af-pr-picked">{c.card.picked}</span> : null}
              {/* Plan names are brands and are not translated. */}
              <h2 className="af-pr-name">{plan.name}</h2>
              <p className="af-pr-desc">{description}</p>

              <div className="af-pr-price">
                {price == null ? (
                  <span className="af-pr-amount af-pr-amount--none">—</span>
                ) : (
                  <span className="af-pr-amount">{money(price)}</span>
                )}
              </div>
              <p className="af-pr-per">
                {price == null
                  ? interval === 'month'
                    ? c.card.notSoldMonthly
                    : c.card.notSoldYearly
                  : interval === 'month'
                    ? c.card.perMonth
                    : c.card.perYear}
              </p>

              {/*
                On the yearly view, show what it works out to per month and what
                that saves. Both are computed; neither is a rounded month count,
                because .99 pricing makes "2 months free" a fudge in one direction
                or the other.
              */}
              {interval === 'year' && plan.savings ? (
                <p className="af-pr-save">
                  {c.card.saveLine(
                    money(plan.savings.effectiveMonthly),
                    money(plan.savings.savedUsd),
                    plan.savings.savedPct,
                  )}
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
                {pendingSku === sku ? c.card.opening : c.card.choose(plan.name)}
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
              <h2 className="af-pr-h2">{c.yearly.h2}</h2>
              <p className="af-pr-sub af-pr-sub--tight">{c.yearly.sub}</p>
            </div>
            <div className="af-pr-yearly-grid">
              {yearlyLanes.map((plan) => (
                <div key={plan.planFamily} className="af-pr-yearly-card">
                  <span className="af-pr-yearly-name">{plan.name}</span>
                  <span className="af-pr-yearly-price">{money(plan.yearlyPrice as number)}</span>
                  {plan.savings ? (
                    <span className="af-pr-yearly-save af-num">
                      {c.yearly.line(money(plan.savings.effectiveMonthly), plan.savings.savedPct)}
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
          <h2 className="af-pr-h2">{c.tokens.h2}</h2>
          <p className="af-pr-sub af-pr-sub--tight">{c.tokens.sub}</p>
        </div>
        <div className="af-pr-packs">
          {packs.map((pack) => (
            <div key={pack.sku} className="af-pr-pack">
              <span className="af-pr-pack-tokens">
                {pack.tokenAmount != null ? pack.tokenAmount.toLocaleString() : '—'}
              </span>
              <span className="af-pr-pack-label">{c.tokens.tokensLabel}</span>
              <span className="af-pr-pack-price">{money(pack.amountUsd)}</span>
              <button
                type="button"
                className="af-pr-cta af-pr-cta--small"
                data-testid={`pricing-token-cta-${pack.sku}`}
                disabled={blocked || pendingSku === pack.sku}
                onClick={() => startCheckout(pack.sku, 'token_pack')}
              >
                {pendingSku === pack.sku ? c.tokens.buying : c.tokens.buy}
              </button>
            </div>
          ))}
        </div>
      </section>
      </div>

      {/* ── FAQ ────────────────────────────────────────────────── */}
      <section className="af-pr-faq" aria-labelledby="af-pr-faq-h">
        <h2 className="af-pr-h2" id="af-pr-faq-h">
          {c.faq.h2}
        </h2>
        <div className="af-pr-faq-grid">
          {c.faq.items.map((f) => (
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
        <p>{c.foot.stripe}</p>
        {/*
          ⚠ THE LEGAL LINKS ARE NEW, AND THIS PAGE TAKES MONEY WITHOUT THEM UNTIL NOW.
          Measured on the live page: five links in total — `/`, `/login` and three
          to `/signup` — and not one to Terms or Privacy, on the surface where a
          visitor enters a card. The FAQ above even answers "Can I cancel?" with
          "purchases follow the pricing shown at checkout and the applicable
          refund policy" while linking to no such policy.

          The nav's own comment claims it was added so a visitor could "reach
          Terms or Privacy"; the nav it added contains neither. This is that fix,
          actually made.

          Routed through the legal-route resolver rather than hardcoded hrefs, so
          these match the ones the signup form already shows.
        */}
        <nav className="af-pr-foot-legal" aria-label="Legal">
          <Link href={getTermsUrl()}>{c.foot.terms}</Link>
          <Link href={getPrivacyUrl()}>{c.foot.privacy}</Link>
          <Link href={getNoGamblingPolicyUrl()}>{c.foot.noGambling}</Link>
        </nav>
        <Link href="/signup" className="af-pr-foot-cta">
          {c.foot.cta}
        </Link>
      </footer>
    </div>
  )
}

export default PricingV4
