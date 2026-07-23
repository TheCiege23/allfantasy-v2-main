/**
 * Billing Truth — pure decision helpers for what billing surfaces may honestly claim.
 *
 * observed    = read from Stripe (the real billing period, the real charged amount)
 * derived     = computed locally from observed inputs (a now+interval period estimate)
 * unavailable = cannot be verified right now — say so, never guess
 */

export type BillingProvenance = 'observed' | 'derived' | 'unavailable'

export interface ResolvedBillingPeriod {
  currentPeriodStart: Date
  currentPeriodEnd: Date
  /** 'stripe_subscription' = observed from Stripe; 'derived_estimate' = local now+interval. */
  periodSource: 'stripe_subscription' | 'derived_estimate'
  provenance: BillingProvenance
}

/**
 * Prefer Stripe's real billing period over a local estimate. The estimate drifts the moment
 * Stripe prorates, trials, or anchors billing — it must never be presented as the renewal
 * date when the real one is available.
 */
export function resolveCheckoutBillingPeriod(input: {
  stripeSubscription: {
    current_period_start?: number | null
    current_period_end?: number | null
  } | null
  now: Date
  interval: 'month' | 'year'
}): ResolvedBillingPeriod {
  const sub = input.stripeSubscription
  if (sub && typeof sub.current_period_end === 'number' && sub.current_period_end > 0) {
    return {
      currentPeriodStart:
        typeof sub.current_period_start === 'number' && sub.current_period_start > 0
          ? new Date(sub.current_period_start * 1000)
          : input.now,
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      periodSource: 'stripe_subscription',
      provenance: 'observed',
    }
  }

  const end = new Date(input.now)
  if (input.interval === 'year') {
    end.setUTCFullYear(end.getUTCFullYear() + 1)
  } else {
    end.setUTCMonth(end.getUTCMonth() + 1)
  }
  return {
    currentPeriodStart: input.now,
    currentPeriodEnd: end,
    periodSource: 'derived_estimate',
    provenance: 'derived',
  }
}

export interface ChargedAmountVerification {
  /** null = Stripe supplied no amount to verify against (unavailable, not a pass). */
  matchesCatalog: boolean | null
  expectedAmountCents: number
  subtotalCents: number | null
  paidAmountCents: number | null
  discountCents: number
  provenance: BillingProvenance
}

/**
 * Compares the PRE-discount subtotal against the catalog list price the user was shown. A
 * legitimate promo code lowers amount_total and must not read as drift; a stale Payment Link
 * changes the subtotal itself. A missing subtotal is UNAVAILABLE — never assumed to match.
 */
export function verifyChargedAmount(input: {
  expectedAmountUsd: number
  amountSubtotalCents?: number | null
  amountTotalCents?: number | null
  discountCents?: number | null
}): ChargedAmountVerification {
  const expectedAmountCents = Math.round(input.expectedAmountUsd * 100)
  const paidAmountCents = typeof input.amountTotalCents === 'number' ? input.amountTotalCents : null
  const subtotalCents =
    typeof input.amountSubtotalCents === 'number' ? input.amountSubtotalCents : paidAmountCents

  return {
    matchesCatalog: subtotalCents === null ? null : subtotalCents === expectedAmountCents,
    expectedAmountCents,
    subtotalCents,
    paidAmountCents,
    discountCents: input.discountCents ?? 0,
    provenance: subtotalCents === null ? 'unavailable' : 'observed',
  }
}

/**
 * What a checkout-return banner may honestly show. Green success requires EVIDENCE — either a
 * server-verified session ('synced') or webhook rows found for this user. A bare ?success=1
 * with nothing verifiable is 'pending', never success.
 */
export function resolvePostPurchasePhase(input: {
  syncStatus: 'synced' | 'pending' | 'no_session'
  evidence: { subscription: boolean; tokens: boolean }
}): 'success' | 'pending' {
  if (input.syncStatus === 'synced') return 'success'
  if (input.syncStatus === 'no_session' && (input.evidence.subscription || input.evidence.tokens)) {
    return 'success'
  }
  return 'pending'
}
