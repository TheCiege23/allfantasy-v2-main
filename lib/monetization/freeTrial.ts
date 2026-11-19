/**
 * THE AF PRO FREE TRIAL — the rules, PURE (owner's call 2026-11-15: "yes to free trial but we need to
 * make sure this won't affect my apple app review"; built to the plan agreed that day).
 *
 *   - AF Pro only, monthly or yearly: 7 days free, then the plan's normal price. Card taken up front
 *     (Stripe's own subscription trial), charged on day 8 unless cancelled.
 *   - Only an account that has NEVER had a subscription of any kind, from any store. Checked on the
 *     server at checkout (`freeTrialEligibility.ts`) — the client's view of eligibility is a label,
 *     never the decision.
 *   - WEB ONLY. The iOS app sells through Apple or not at all (App Store 3.1.1), and must not point at
 *     a cheaper or free offer elsewhere (3.1.3): the checkout route already refuses an iOS-shell
 *     request, and every surface that shows the trial hides it in a native build. Android stays in
 *     Google Play. Nothing here is reachable from a store build.
 *   - `AF_PRO_TRIAL_DAYS` is the kill switch and the dial: unset → 7, `0` or `off` → no trial, any
 *     other whole number → that many days, clamped to 1..30.
 */

export const DEFAULT_TRIAL_DAYS = 7
export const MAX_TRIAL_DAYS = 30
/** The SKUs a trial can start on. AF Pro is the plan the /core locks sell. */
export const TRIAL_SKUS: readonly string[] = ['af_pro_monthly', 'af_pro_yearly']

export function trialDaysFromEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): number {
  const raw = String(env.AF_PRO_TRIAL_DAYS ?? '').trim().toLowerCase()
  if (!raw) return DEFAULT_TRIAL_DAYS
  if (raw === 'off' || raw === 'false' || raw === 'no') return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return 0
  return Math.min(n, MAX_TRIAL_DAYS)
}

/** The trial a SKU carries when the account is eligible: 0 for any SKU that is not AF Pro. */
export function trialDaysForSku(sku: string | null | undefined, env?: NodeJS.ProcessEnv | Record<string, string | undefined>): number {
  if (!sku || !TRIAL_SKUS.includes(sku)) return 0
  return trialDaysFromEnv(env)
}

/** Parse the `trialDays` a checkout stamped on Stripe metadata. 0 when absent or malformed. */
export function readTrialDays(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(n) && n > 0 && n <= MAX_TRIAL_DAYS ? n : 0
}

/** When a trial started at `start` ends. */
export function trialEndsAt(start: Date, days: number): Date {
  return new Date(start.getTime() + days * 86_400_000)
}

/**
 * The $0 invoice Stripe raises when a trial subscription is created is NOT a payment: marking the row
 * `active` on it would turn every trial into a paying subscriber (and into MRR). Its status is left to
 * the checkout and subscription handlers, which know it is `trialing`.
 */
export function isTrialStartInvoice(invoice: { billing_reason?: string | null; amount_paid?: number | null }): boolean {
  return invoice.billing_reason === 'subscription_create' && (invoice.amount_paid ?? 0) === 0
}
