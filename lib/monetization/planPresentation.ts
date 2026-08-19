import { getMonetizationCatalog, type MonetizationCatalogItem } from './catalog'

/**
 * Turns the catalog into what a pricing page needs to render — with every
 * derived figure computed, never written down.
 *
 * ⚠ THE SAVINGS COPY IS COMPUTED BECAUSE HARDCODING IT IS WRONG IN ONE STATE OR
 * THE OTHER. The design specifies a "yearly = 2 months free" chip. Against today's
 * live prices that is exactly right on all four tiers. Against the prices staged
 * in PLANNED_PRICE_USD it becomes three to four months, and a chip still claiming
 * two would understate the offer we just decided to make. Deriving it means the
 * page tells the truth before and after the Stripe flip with no second edit — and
 * no window where marketing copy and the price beside it disagree.
 *
 * ⚠ NO TOKEN LINE. The design puts a token allowance on every plan card. That is
 * no longer a fact about any subscription: tokens are the pay-per-use path for
 * people who do not subscribe. A card advertising "includes N tokens" would be
 * describing a product we stopped selling.
 */

export type BillingInterval = 'month' | 'year'

export type PlanPresentation = {
  planFamily: string
  name: string
  description: string
  monthly: MonetizationCatalogItem | null
  yearly: MonetizationCatalogItem | null
  /**
   * What a year costs on each path, and the gap between them.
   *
   * Null when a family is missing one of the two intervals — a plan sold only
   * monthly has no yearly saving to advertise, and inventing one would be the
   * same class of error as the token grants.
   */
  savings: {
    yearlyPrice: number
    twelveMonthsPrice: number
    savedUsd: number
    savedPct: number
    /** Effective cost per month when paying yearly. */
    effectiveMonthly: number
    /** How many months of the monthly price the saving covers. */
    monthsFree: number
  } | null
}

const PLAN_ORDER = ['af_pro', 'af_commissioner', 'af_war_room', 'af_supreme'] as const

const PLAN_NAMES: Record<string, string> = {
  af_pro: 'AF Pro',
  af_commissioner: 'AF Commissioner',
  // Surfaced as "AF Legacy" — never "war room" — per the catalog's naming rule.
  af_war_room: 'AF Legacy',
  af_supreme: 'AF Supreme',
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function getPlanPresentations(): PlanPresentation[] {
  const subs = getMonetizationCatalog().subscriptions
  const out: PlanPresentation[] = []

  for (const family of PLAN_ORDER) {
    const monthly = subs.find((s) => s.planFamily === family && s.interval === 'month') ?? null
    const yearly = subs.find((s) => s.planFamily === family && s.interval === 'year') ?? null
    const source = monthly ?? yearly
    if (!source) continue

    let savings: PlanPresentation['savings'] = null
    if (monthly && yearly) {
      const twelve = round2(monthly.amountUsd * 12)
      const saved = round2(twelve - yearly.amountUsd)
      /*
       * A yearly price at or above 12x monthly has no saving to advertise. This
       * should never happen — a test asserts it — but rendering a negative
       * "you save -$5.00" would be worse than rendering nothing, and the guard
       * costs one comparison.
       */
      savings =
        saved > 0
          ? {
              yearlyPrice: yearly.amountUsd,
              twelveMonthsPrice: twelve,
              savedUsd: saved,
              savedPct: Math.round((saved / twelve) * 100),
              effectiveMonthly: round2(yearly.amountUsd / 12),
              monthsFree: round2(saved / monthly.amountUsd),
            }
          : null
    }

    out.push({
      planFamily: family,
      name: PLAN_NAMES[family] ?? family,
      description: source.description,
      monthly,
      yearly,
      savings,
    })
  }

  return out
}

/**
 * The headline savings claim, in plain words.
 *
 * ⚠ REPORTS THE SMALLEST SAVING ACROSS PLANS, NOT THE LARGEST. "Up to 4 months
 * free" is technically true when one tier gives four and another three, but a
 * customer reading it beside the Commissioner card would be quoted a number that
 * plan does not deliver. The floor is a promise every lane keeps.
 *
 * ⚠ EXPRESSED AS A PERCENTAGE, NOT AS "N MONTHS FREE", AND THAT IS THE HONEST
 * CHOICE RATHER THAN THE TIMID ONE. Prices end in .99, so a whole-month claim is
 * almost never exact: Pro saves $19.89 against twelve months at $9.99, which is
 * 1.99 months. My first version floored that and rendered "1 month free" —
 * understating by half — and rounding it up to "2 months free" would overstate by
 * nine cents. The percentage has no such artifact: it is exactly right in both the
 * current and the planned price states, and at 25-33% after the flip it is a
 * stronger hook than the month count anyway.
 *
 * Per-card the page shows the exact dollar saving, which is unimpeachable.
 */
export function describeYearlySavings(plans: PlanPresentation[]): string | null {
  const pcts = plans.map((p) => p.savings?.savedPct).filter((n): n is number => n != null && n > 0)
  if (pcts.length === 0) return null
  return `Save ${Math.min(...pcts)}% paying yearly`
}
