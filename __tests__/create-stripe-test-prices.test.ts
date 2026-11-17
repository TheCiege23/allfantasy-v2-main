import { describe, expect, it } from 'vitest'
import { getMonetizationCatalog } from '@/lib/monetization/catalog'
import {
  planPrices,
  priceMatches,
  refuseNonTestKey,
  upsertEnvLines,
} from '../scripts/create-stripe-test-prices'

describe('create-stripe-test-prices', () => {
  it('🛑 refuses a LIVE key (secret or restricted) before any call', () => {
    for (const k of ['sk_live_abc', 'rk_live_abc']) expect(refuseNonTestKey(k)).toMatch(/LIVE key/)
    expect(refuseNonTestKey('')).toMatch(/not set/)
    expect(refuseNonTestKey('pk_test_abc')).toMatch(/not a recognisable/)
  })

  it('accepts only a test key', () => {
    expect(refuseNonTestKey('sk_test_abc')).toBeNull()
    expect(refuseNonTestKey('rk_test_abc')).toBeNull()
  })

  it('plans one price per catalog SKU, from the catalog amounts — never a second copy of them', () => {
    const catalog = getMonetizationCatalog().all
    const plans = planPrices(catalog)
    expect(plans).toHaveLength(catalog.length)
    for (const [i, item] of catalog.entries()) {
      expect(plans[i]).toMatchObject({
        sku: item.sku,
        envVar: item.stripePriceEnvVar,
        unitAmount: Math.round(item.amountUsd * 100),
        interval: item.interval,
        lookupKey: `af_${item.sku}`,
      })
      expect(Number.isInteger(plans[i]!.unitAmount)).toBe(true)
    }
  })

  it("groups a plan's monthly and yearly prices under one product; token packs stand alone", () => {
    const plans = planPrices(getMonetizationCatalog().all)
    const pro = plans.filter((p) => p.sku.startsWith('af_pro_'))
    expect(new Set(pro.map((p) => p.productKey)).size).toBe(1)
    expect(pro[0]!.productName).toBe('AF Pro')
    const tokens = plans.filter((p) => p.sku.startsWith('af_tokens_'))
    expect(new Set(tokens.map((p) => p.productKey)).size).toBe(tokens.length)
  })

  it('reuses a price only when it charges exactly the plan', () => {
    const plan = planPrices(getMonetizationCatalog().all).find((p) => p.sku === 'af_pro_monthly')!
    const good = { active: true, currency: 'usd', unit_amount: plan.unitAmount, type: 'recurring', recurring: { interval: 'month' } } as any
    expect(priceMatches(good, plan)).toBe(true)
    expect(priceMatches({ ...good, unit_amount: plan.unitAmount + 1 }, plan)).toBe(false)
    expect(priceMatches({ ...good, recurring: { interval: 'year' } }, plan)).toBe(false)
    expect(priceMatches({ ...good, active: false }, plan)).toBe(false)
    const pack = planPrices(getMonetizationCatalog().all).find((p) => p.interval === null)!
    expect(priceMatches({ active: true, currency: 'usd', unit_amount: pack.unitAmount, type: 'one_time', recurring: null } as any, pack)).toBe(true)
  })

  it('writes env lines: replaces in place, appends missing, touches nothing else, keeps CRLF', () => {
    const before = 'A=1\r\nSTRIPE_PRICE_AF_PRO_MONTHLY=price_live_old\r\nB=2\r\n'
    const after = upsertEnvLines(before, { STRIPE_PRICE_AF_PRO_MONTHLY: 'price_test_new', STRIPE_PRICE_AF_TOKENS_5: 'price_test_t5' })
    expect(after).toBe('A=1\r\nSTRIPE_PRICE_AF_PRO_MONTHLY=price_test_new\r\nB=2\r\nSTRIPE_PRICE_AF_TOKENS_5=price_test_t5\r\n')
    expect(after.replace(/\r\n/g, '')).not.toMatch(/\n|\r/)
  })

  it('appends safely to a file with no trailing newline, and to an empty file', () => {
    expect(upsertEnvLines('A=1', { X: 'y' })).toBe('A=1\nX=y\n')
    expect(upsertEnvLines('', { X: 'y' })).toBe('X=y\n')
  })
})
