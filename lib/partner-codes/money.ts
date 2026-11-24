/**
 * Commissioner Partner Codes — the money rules, as pure functions.
 *
 * Nothing here touches the database, Stripe, Apple or Google. Every webhook,
 * job and screen goes through these, so the tests in
 * __tests__/partner-codes/money.test.ts are the program's rulebook.
 *
 * Units: cents for money people pay, MILLICENTS (1/1000 cent) for commission on
 * the ledger. See settings.ts for why.
 */
import type { PartnerSettings } from './settings'

export type BillingInterval = 'month' | 'year'

export const MILLICENTS_PER_CENT = 1000

// ---------------------------------------------------------------------------
// Friend discount
// ---------------------------------------------------------------------------

/** What a friend pays for each of their first `discountMonths` monthly bills. */
export function discountedMonthlyCents(priceCents: number, s: PartnerSettings): number {
  return priceCents - Math.round((priceCents * s.discountPercent) / 100)
}

/**
 * The one-time amount taken off a friend's first yearly bill.
 * prorated: 10% × 3/12 of $159.99 = $4.00. full_year: 10% of $159.99 = $16.00.
 */
export function yearlyDiscountCents(annualPriceCents: number, s: PartnerSettings): number {
  const share = s.yearlyDiscountMode === 'prorated' ? s.discountMonths / 12 : 1
  return Math.round((annualPriceCents * s.discountPercent * share) / 100)
}

// ---------------------------------------------------------------------------
// Commission on one payment
// ---------------------------------------------------------------------------

export type PaymentAmounts = {
  /** What the subscriber was charged, after the friend discount. */
  grossCents: number
  /** Processor or store fee (Stripe fee, or Apple/Google's cut). */
  feeCents: number
  /** Refunded so far. */
  refundCents: number
}

/** The amount commission is a percentage of. Never negative. */
export function commissionBasisCents(p: PaymentAmounts, s: PartnerSettings): number {
  const fee = s.commissionBasis === 'net' ? p.feeCents : 0
  return Math.max(0, p.grossCents - fee - p.refundCents)
}

/** Exact: integer cents × whole percent × 10 = millicents. */
export function commissionMillicents(basisCents: number, s: PartnerSettings): number {
  return basisCents * s.commissionPercent * 10
}

export function millicentsToCents(m: number): number {
  // Round half away from zero so a −$0.005 clawback and a +$0.005 earning mirror.
  return Math.sign(m) * Math.round(Math.abs(m) / MILLICENTS_PER_CENT)
}

// ---------------------------------------------------------------------------
// Accrual: monthly pays once, yearly pays 1/12 a month for 12 months
// ---------------------------------------------------------------------------

export type PlannedEntry = {
  installment: number
  /** 'YYYY-MM' — the month this slice belongs to. */
  periodMonth: string
  /** When this slice becomes payable (before the clearing hold). */
  earnedAt: Date
  commissionMillicents: number
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function addMonthsUtc(d: Date, n: number): Date {
  const out = new Date(d.getTime())
  const day = out.getUTCDate()
  out.setUTCDate(1)
  out.setUTCMonth(out.getUTCMonth() + n)
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate()
  out.setUTCDate(Math.min(day, lastDay))
  return out
}

/**
 * Split a payment's commission into ledger entries. A yearly payment becomes 12
 * slices whose sum is exactly the whole commission (the last slice carries the
 * remainder), so a refund in month 2 only has to undo what is left.
 */
export function planAccrual(args: {
  interval: BillingInterval
  basisCents: number
  paidAt: Date
  settings: PartnerSettings
}): PlannedEntry[] {
  const total = commissionMillicents(args.basisCents, args.settings)
  if (total <= 0) return []
  if (args.interval === 'month') {
    return [{ installment: 0, periodMonth: monthKey(args.paidAt), earnedAt: args.paidAt, commissionMillicents: total }]
  }
  const per = Math.floor(total / 12)
  const out: PlannedEntry[] = []
  for (let i = 0; i < 12; i++) {
    const at = addMonthsUtc(args.paidAt, i)
    out.push({
      installment: i,
      periodMonth: monthKey(at),
      earnedAt: at,
      commissionMillicents: i === 11 ? total - per * 11 : per,
    })
  }
  return out
}

/**
 * Has this subscriber run past the per-subscriber cap? `monthsAlreadyPaid` is
 * how many months of their payments have already earned commission.
 */
export function withinCommissionCap(monthsAlreadyPaid: number, s: PartnerSettings): boolean {
  return s.commissionCapMonths == null || monthsAlreadyPaid < s.commissionCapMonths
}

// ---------------------------------------------------------------------------
// Refunds and chargebacks
// ---------------------------------------------------------------------------

export type LedgerSlice = {
  id: string
  installment: number
  status: 'scheduled' | 'accrued' | 'paid' | 'reversed' | 'clawback'
  commissionMillicents: number
}

/**
 * How much commission a refund of `refundCents` out of `grossCents` undoes.
 * Proportional, so a partial refund undoes part.
 */
export function reversalMillicents(totalCommissionMillicents: number, refundCents: number, grossCents: number): number {
  if (grossCents <= 0 || refundCents <= 0) return 0
  const f = Math.min(1, refundCents / grossCents)
  return Math.round(totalCommissionMillicents * f)
}

/**
 * Undo `reverse` millicents from a payment's slices. Unpaid slices are cancelled
 * latest-first (whole slices only); whatever is still owed after that — because
 * it was already paid out — becomes one negative `clawback` entry that comes off
 * the next statement. A commissioner is never sent a bill: a negative balance
 * just carries forward (see buildPayout).
 *
 * cancelled + clawback always equals `reverse` exactly.
 */
export function planReversal(slices: LedgerSlice[], reverse: number): { cancelIds: string[]; clawbackMillicents: number } {
  let remaining = reverse
  const cancelIds: string[] = []
  const unpaid = slices
    .filter((s) => s.status === 'scheduled' || s.status === 'accrued')
    .sort((a, b) => b.installment - a.installment)
  for (const s of unpaid) {
    if (remaining <= 0) break
    if (s.commissionMillicents > remaining) break
    cancelIds.push(s.id)
    remaining -= s.commissionMillicents
  }
  return { cancelIds, clawbackMillicents: remaining > 0 ? -remaining : 0 }
}

// ---------------------------------------------------------------------------
// Monthly statement
// ---------------------------------------------------------------------------

export type PayoutDecision =
  | { kind: 'none'; totalCents: number; reason: 'empty' | 'below_minimum' | 'negative_balance' }
  | { kind: 'payout'; totalCents: number; status: 'pending_review' | 'held'; heldReason: string | null }

/**
 * Turn the payable entries (all unpaid entries earned before the cutoff,
 * including negative clawbacks) into a statement decision.
 */
export function buildPayout(args: {
  entriesMillicents: number[]
  hasTaxForm: boolean
  settings: PartnerSettings
}): PayoutDecision {
  if (args.entriesMillicents.length === 0) return { kind: 'none', totalCents: 0, reason: 'empty' }
  const sum = args.entriesMillicents.reduce((a, b) => a + b, 0)
  const totalCents = millicentsToCents(sum)
  if (totalCents < 0) return { kind: 'none', totalCents, reason: 'negative_balance' }
  if (totalCents < args.settings.minPayoutCents) return { kind: 'none', totalCents, reason: 'below_minimum' }
  if (!args.hasTaxForm) {
    return { kind: 'payout', totalCents, status: 'held', heldReason: 'Waiting on the W-9 tax form' }
  }
  return { kind: 'payout', totalCents, status: 'pending_review', heldReason: null }
}

/** The 'YYYY-MM' before `now`'s month — the period a 1st-of-month run closes. */
export function previousMonthKey(now: Date): string {
  return monthKey(addMonthsUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), -1))
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000)
}
