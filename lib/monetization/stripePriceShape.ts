/**
 * Is a Stripe Price the right KIND of price for a catalog SKU — not just the right amount?
 *
 * scripts/verify-stripe-price-parity.ts compared `unit_amount` and nothing else, so each of these
 * read "ok" while charging the wrong thing:
 *   - an ARCHIVED price (checkout refuses it — a dead buy button behind a green check)
 *   - a price in another currency
 *   - a yearly SKU pointed at a $79.99 price that bills MONTHLY (twelve times the advertised year)
 *   - a token pack pointed at a RECURRING price (a one-off purchase that renews forever)
 *   - a recurring price on an `interval_count` of 3 ("every 3 months" at the monthly figure)
 * Found 2026-10-04 while checking live prices before the Oct 15 launch.
 *
 * Pure: takes the catalog fields and the price's own fields, returns the problems found (empty =
 * the shape matches). Amount is still compared by the script, in cents.
 */

export type CatalogShape = {
  type: 'subscription' | 'token_pack'
  interval: 'month' | 'year' | null
}

export type PriceShape = {
  active: boolean
  currency: string
  type: 'one_time' | 'recurring' | string
  recurring: { interval: string; interval_count: number } | null
}

export function stripePriceShapeProblems(item: CatalogShape, price: PriceShape): string[] {
  const problems: string[] = []
  if (!price.active) problems.push('price is archived — checkout will refuse it')
  if (String(price.currency).toLowerCase() !== 'usd') problems.push(`currency is ${price.currency}, not usd`)
  if (item.type === 'subscription') {
    if (price.type !== 'recurring' || !price.recurring) {
      problems.push('a subscription SKU points at a one-time price')
    } else {
      if (price.recurring.interval !== item.interval) {
        problems.push(`bills every ${price.recurring.interval}, catalog says every ${item.interval}`)
      }
      if (price.recurring.interval_count !== 1) {
        problems.push(`bills every ${price.recurring.interval_count} ${price.recurring.interval}s, not every 1`)
      }
    }
  } else if (price.type !== 'one_time') {
    problems.push('a token pack points at a recurring price — it would renew')
  }
  return problems
}
