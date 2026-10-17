// @vitest-environment node
/**
 * The price-parity check compares more than the amount (2026-10-04): a Stripe Price must also be
 * active, in USD, and recurring on the catalog's interval — or one-time for a token pack.
 */
import { describe, expect, it } from 'vitest'

import { getMonetizationCatalog } from '@/lib/monetization/catalog'
import { stripePriceShapeProblems, type PriceShape } from '@/lib/monetization/stripePriceShape'

const monthly = { type: 'subscription' as const, interval: 'month' as const }
const yearly = { type: 'subscription' as const, interval: 'year' as const }
const tokens = { type: 'token_pack' as const, interval: null }

const recurring = (interval: string, interval_count = 1, extra: Partial<PriceShape> = {}): PriceShape => ({
  active: true,
  currency: 'usd',
  type: 'recurring',
  recurring: { interval, interval_count },
  ...extra,
})
const oneTime = (extra: Partial<PriceShape> = {}): PriceShape => ({ active: true, currency: 'usd', type: 'one_time', recurring: null, ...extra })

describe('stripePriceShapeProblems', () => {
  it('the right kind of price has no problems', () => {
    expect(stripePriceShapeProblems(monthly, recurring('month'))).toEqual([])
    expect(stripePriceShapeProblems(yearly, recurring('year'))).toEqual([])
    expect(stripePriceShapeProblems(tokens, oneTime())).toEqual([])
    expect(stripePriceShapeProblems(monthly, recurring('month', 1, { currency: 'USD' }))).toEqual([])
  })

  it('a yearly SKU on a price that bills monthly — twelve times the advertised year', () => {
    expect(stripePriceShapeProblems(yearly, recurring('month'))).toEqual(['bills every month, catalog says every year'])
  })

  it('"every 3 months" at the monthly figure', () => {
    expect(stripePriceShapeProblems(monthly, recurring('month', 3))).toEqual(['bills every 3 months, not every 1'])
  })

  it('a token pack on a recurring price would renew; a subscription on a one-time price would not', () => {
    expect(stripePriceShapeProblems(tokens, recurring('month'))).toEqual(['a token pack points at a recurring price — it would renew'])
    expect(stripePriceShapeProblems(monthly, oneTime())).toEqual(['a subscription SKU points at a one-time price'])
  })

  it('an archived price, or one in another currency', () => {
    expect(stripePriceShapeProblems(monthly, recurring('month', 1, { active: false }))).toEqual(['price is archived — checkout will refuse it'])
    expect(stripePriceShapeProblems(tokens, oneTime({ currency: 'eur' }))).toEqual(['currency is eur, not usd'])
  })
})

describe('the catalog gives the check what it needs', () => {
  it('every subscription SKU names a month or year interval, and every token pack none', () => {
    for (const item of getMonetizationCatalog().all) {
      if (item.type === 'subscription') expect(['month', 'year'], item.sku).toContain(item.interval)
      else expect(item.interval, item.sku).toBeNull()
    }
  })
})
