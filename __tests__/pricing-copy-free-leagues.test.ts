import { describe, expect, it } from 'vitest'

import { getNocturneCopy } from '@/components/landing/nocturne/copy.i18n'
import { getLandingCopy } from '@/lib/i18n/landing-copy'
import { getMonetizationCatalogItemBySku, type MonetizationSku } from '@/lib/monetization/catalog'
import { PLAN_FAMILY_INCLUDES, PLAN_FAMILY_SHORT_TAGLINE } from '@/lib/monetization/planIncludes'
import { CHIMMY_PLAN_DAILY_INCLUDED } from '@/lib/chimmy/planAllowanceView'

/*
 * Pricing and landing copy must say what the product does (Oct 15 paywall launch):
 *  - creating, importing and running leagues is free, for commissioners too;
 *  - a price on the page is the price checkout charges;
 *  - no plan promises tokens (subscriptions grant none) or bundles a tier it doesn't.
 *
 * Every rule here was broken on the live pages on 2026-09-24. The landing tiers carried
 * hand-typed prices in five languages that had drifted from checkout (yearly Pro $99.99
 * vs a charged $79.99; AF Legacy $29.99 vs $9.99), promised a monthly token allowance,
 * sold Commissioner as "Everything in Pro", and listed mock drafts and the live draft
 * room as paid.
 */

const LOCALES = ['en', 'es', 'zh', 'fil', 'vi'] as const

function usd(sku: MonetizationSku): string {
  const amount = getMonetizationCatalogItemBySku(sku)?.amountUsd
  if (amount == null) throw new Error(`catalog has no ${sku}`)
  return `$${amount.toFixed(2)}`
}

const TIER_SKUS: Record<string, { monthly: MonetizationSku; yearly: MonetizationSku }> = {
  pro: { monthly: 'af_pro_monthly', yearly: 'af_pro_yearly' },
  commissioner: { monthly: 'af_commissioner_monthly', yearly: 'af_commissioner_yearly' },
  supreme: { monthly: 'af_supreme_monthly', yearly: 'af_supreme_yearly' },
}

describe.each(LOCALES)('landing pricing tiers (%s)', (lang) => {
  const copy = getNocturneCopy(lang)

  it('every paid tier shows the price checkout charges, monthly and yearly', () => {
    for (const tier of copy.pricing.tiers) {
      const skus = TIER_SKUS[tier.key]
      if (!skus) continue
      expect(tier.price, `${lang}/${tier.key} monthly`).toBe(usd(skus.monthly))
      expect(tier.priceYear ?? '', `${lang}/${tier.key} yearly`).toContain(usd(skus.yearly))
    }
    // Every paid tier was checked — a tier key that stops matching would skip silently.
    expect(copy.pricing.tiers.filter((t) => TIER_SKUS[t.key]).map((t) => t.key)).toEqual([
      'pro',
      'commissioner',
      'supreme',
    ])
  })

  it('shows Free, Pro, Commissioner and Supreme — AF Legacy is off the launch pricing', () => {
    expect(copy.pricing.tiers.map((t) => t.key)).toEqual(['free', 'pro', 'commissioner', 'supreme'])
  })

  it('promises no token allowance anywhere in the pricing section', () => {
    const text = JSON.stringify(copy.pricing).toLowerCase()
    // ⚠ Chinese says 代币, not "token" — a check for the English word alone passed the zh
    // copy while it still promised "每个付费方案都包含每月代币额度".
    expect(text).not.toMatch(/token|代币/)
  })

  it('does not sell Commissioner as including Pro (only Supreme bundles tiers)', () => {
    const commissioner = copy.pricing.tiers.find((t) => t.key === 'commissioner')!
    const pro = copy.pricing.tiers.find((t) => t.key === 'pro')!
    // Commissioner's first line is "Everything in <the Free tier's name>", never Pro's.
    expect(commissioner.features[0].text).not.toContain(pro.name)
    expect(commissioner.features[0].text).not.toMatch(/\bPro\b/)
  })

  it('leaves nothing on the Free tier locked, and states the Chimmy allowance from the enforced constant', () => {
    const free = copy.pricing.tiers.find((t) => t.key === 'free')!
    expect(free.features.some((f) => f.locked)).toBe(false)
    const pro = copy.pricing.tiers.find((t) => t.key === 'pro')!
    expect(pro.features.map((f) => f.text).join(' ')).toContain(String(CHIMMY_PLAN_DAILY_INCLUDED))
  })

  it('quotes the real entry price in the hero fine print', () => {
    expect(copy.hero.finePrint).toContain(usd('af_pro_monthly'))
  })
})

describe('live landing copy (LandingV4)', () => {
  const prices = { min: '$9.99', max: '$19.99' }

  it.each(['en', 'es'] as const)('%s: leads with free leagues, never "free for players" or "upgrade to act"', (lang) => {
    const c = getLandingCopy(lang, prices)
    const text = [c.hero.reassure, c.pricing.h2, c.pricing.body, ...c.faq.items.map((i) => i.a)].join(' ')
    expect(text).not.toMatch(/for players|para jugadores/i)
    expect(text).not.toMatch(/act on it|para actuar/i)
    expect(c.pricing.body).toMatch(lang === 'en' ? /Create, import and run/ : /Crea, importa y dirige/)
  })
})

describe('pricing-page plan copy', () => {
  it('does not list free commissioner basics (lock settings, invites) as Commissioner features', () => {
    const text = PLAN_FAMILY_INCLUDES.af_commissioner.join(' ')
    expect(text).not.toMatch(/invites|lock settings/i)
  })

  it('does not sell the draft room itself, or running a league, as paid', () => {
    const all = [
      ...Object.values(PLAN_FAMILY_SHORT_TAGLINE),
      ...Object.values(PLAN_FAMILY_INCLUDES).flat(),
      getMonetizationCatalogItemBySku('af_commissioner_monthly')!.description,
      getMonetizationCatalogItemBySku('af_war_room_monthly')!.description,
    ].join(' | ')
    expect(all).not.toMatch(/The live draft room|Draft room plus|tools to run your leagues|league operations/i)
  })
})
