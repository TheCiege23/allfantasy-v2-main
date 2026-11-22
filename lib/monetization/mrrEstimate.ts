/**
 * MRR ESTIMATE — PURE (2026-11-15). The admin dashboard listed MRR as "not tracked" because the price
 * is not stored on a subscription row. The SKU is (`user_subscriptions.sku`, e.g. `af_pro_yearly`), and
 * the catalog (`./catalog.ts`) is the one place the list price of every SKU is defined — the same price
 * Stripe is checked against (`scripts/verify-stripe-price-parity.ts`). So:
 *
 *   MRR = Σ over paid, live subscriptions of the catalog list price of its SKU, a yearly plan ÷ 12.
 *
 * ⚠ AN ESTIMATE, AND THE LABEL SAYS WHICH WAY IT IS WRONG. It is GROSS LIST PRICE: before the founding
 * member coupon (20% off the first year), any other coupon, and the app stores' cut. So it can only
 * over-state what lands in the bank, never under-state it. Stripe's own MRR is the figure of record.
 *
 * What counts:
 *   - status `active`, `past_due` or `grace` — still being billed. A `trialing` subscription has paid
 *     nothing yet and is counted apart, never as revenue.
 *   - source `stripe`, `apple` or `google_play` — a store took money. Anything else (an internal grant)
 *     is counted apart as comped.
 *   - a SKU the catalog prices. A row whose SKU (or plan code) the catalog does not know is counted as
 *     UNPRICED — reported, never priced as zero, because a $0 would quietly drag the figure down.
 */

import { getMonetizationCatalogItemBySku, type MonetizationSku } from './catalog'

export const MRR_BILLED_STATUSES: readonly string[] = ['active', 'past_due', 'grace']
export const MRR_PAID_SOURCES: readonly string[] = ['stripe', 'apple', 'google_play']

export type MrrRow = { status: string | null; source: string | null; sku: string | null; planCode?: string | null }

export type MrrEstimate = {
  mrrCents: number
  /** Paid, billed subscriptions that were priced into the figure. */
  priced: number
  /** Paid, billed subscriptions whose SKU the catalog does not price — left out, and said. */
  unpriced: number
  /** In a free trial: no money yet. */
  trialing: number
  /** Billed, but not through a store (an internal grant). */
  comped: number
  /** Monthly-equivalent cents per plan family (pro, commissioner, war_room, supreme). */
  byFamily: Record<string, number>
}

function priceOf(row: MrrRow): { monthlyCents: number; family: string } | null {
  for (const candidate of [row.sku, row.planCode]) {
    const sku = typeof candidate === 'string' ? candidate.trim().toLowerCase() : ''
    if (!sku) continue
    const item = getMonetizationCatalogItemBySku(sku as MonetizationSku)
    if (!item || item.type !== 'subscription' || !item.interval || !(item.amountUsd > 0)) continue
    const cents = Math.round(item.amountUsd * 100)
    return { monthlyCents: item.interval === 'year' ? cents / 12 : cents, family: item.planFamily ?? 'other' }
  }
  return null
}

export function estimateMrr(rows: readonly MrrRow[]): MrrEstimate {
  const out: MrrEstimate = { mrrCents: 0, priced: 0, unpriced: 0, trialing: 0, comped: 0, byFamily: {} }
  for (const row of rows) {
    const status = String(row.status ?? '').toLowerCase()
    if (status === 'trialing') {
      out.trialing++
      continue
    }
    if (!MRR_BILLED_STATUSES.includes(status)) continue
    if (!MRR_PAID_SOURCES.includes(String(row.source ?? '').toLowerCase())) {
      out.comped++
      continue
    }
    const price = priceOf(row)
    if (!price) {
      out.unpriced++
      continue
    }
    out.priced++
    out.mrrCents += price.monthlyCents
    out.byFamily[price.family] = (out.byFamily[price.family] ?? 0) + price.monthlyCents
  }
  out.mrrCents = Math.round(out.mrrCents)
  for (const k of Object.keys(out.byFamily)) out.byFamily[k] = Math.round(out.byFamily[k]!)
  return out
}

/** "$1,234.56" */
export function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** The admin note under the figure: what it counts and which way it can be wrong. */
export function describeMrrEstimate(e: MrrEstimate): string {
  const parts = [`${e.priced} paid subscription${e.priced === 1 ? '' : 's'} at list price (yearly ÷ 12), before coupons and store fees`]
  if (e.unpriced) parts.push(`${e.unpriced} with an unknown SKU left out`)
  if (e.trialing) parts.push(`${e.trialing} in a free trial (not counted)`)
  if (e.comped) parts.push(`${e.comped} not billed through a store (not counted)`)
  return parts.join(' · ')
}
