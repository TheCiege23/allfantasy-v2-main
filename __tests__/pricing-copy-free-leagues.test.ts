import { describe, expect, it } from 'vitest'

import { getLandingCopy } from '@/lib/i18n/landing-copy'
import { getMonetizationCatalogItemBySku } from '@/lib/monetization/catalog'
import { PLAN_FAMILY_INCLUDES, PLAN_FAMILY_SHORT_TAGLINE } from '@/lib/monetization/planIncludes'

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
