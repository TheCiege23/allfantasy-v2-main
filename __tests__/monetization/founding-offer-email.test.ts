// @vitest-environment node
/**
 * The founding-member offer email (docs/FOUNDING_OFFER_EMAIL_DRAFT.md): the two rules the draft
 * sets — "doesn't expire" only for a `forever` coupon, and Spanish never quotes the English label —
 * plus the list of what becomes Pro, read from the same constant the site uses.
 */
import { describe, expect, it } from 'vitest'

import { PRO_DEPTH_EN, PRO_DEPTH_ES } from '@/components/launch/launchCopy'
import { buildFoundingOfferEmail } from '@/lib/monetization/foundingOfferEmail'

const BASE = 'https://allfantasy.ai'
const LABEL = '50% off AF Pro for life'

describe('buildFoundingOfferEmail', () => {
  it('English with a label quotes it verbatim and says the pricing does not expire only for a forever coupon', () => {
    const forever = buildFoundingOfferEmail({ lang: 'en', label: LABEL, couponForever: true, baseUrl: BASE })
    expect(forever.subject).toBe("You're a founding member — here's what that means on October 15")
    // A colon, so the sentence keeps a verb whatever the label says ("…a founding member: 20% off…").
    expect(forever.bodyText).toContain(`you're a founding member: ${LABEL}, applied automatically at checkout.`)
    expect(buildFoundingOfferEmail({ lang: 'en', label: '20% off your first year', couponForever: false, baseUrl: BASE }).bodyText).toContain(
      "so you're a founding member: 20% off your first year, applied automatically at checkout. No code to enter",
    )
    expect(forever.bodyText).toContain("doesn't expire")

    const limited = buildFoundingOfferEmail({ lang: 'en', label: LABEL, couponForever: false, baseUrl: BASE })
    expect(limited.bodyText).not.toContain('expire')
    expect(limited.bodyText).toContain("Your founding pricing doesn't need claiming")
  })

  it('English without a label names no figure', () => {
    const { bodyText } = buildFoundingOfferEmail({ lang: 'en', label: null, couponForever: true, baseUrl: BASE })
    expect(bodyText).toContain("so you're a founding member, and your founding discount is applied automatically at checkout.")
    expect(bodyText).not.toMatch(/\d+\s*%|\$\d/)
  })

  it('Spanish never quotes the English label, and "no vence" only for a forever coupon', () => {
    const forever = buildFoundingOfferEmail({ lang: 'es', label: LABEL, couponForever: true, baseUrl: BASE })
    expect(forever.bodyText).not.toContain(LABEL)
    expect(forever.bodyText).toContain('tu descuento de fundador se aplica automáticamente al pagar')
    expect(forever.bodyText).toContain('no vence')
    expect(buildFoundingOfferEmail({ lang: 'es', label: null, couponForever: false, baseUrl: BASE }).bodyText).not.toContain('vence')
  })

  it('names what becomes Pro with the site’s own list, and links to production', () => {
    const en = buildFoundingOfferEmail({ lang: 'en', label: null, couponForever: false, baseUrl: BASE }).bodyText
    const es = buildFoundingOfferEmail({ lang: 'es', label: null, couponForever: false, baseUrl: BASE }).bodyText
    expect(en).toContain(PRO_DEPTH_EN)
    expect(es).toContain(PRO_DEPTH_ES)
    for (const body of [en, es]) {
      expect(body).toContain(`${BASE}/pricing`)
      expect(body).toContain(`${BASE}/settings`)
      expect(body).not.toMatch(/localhost/)
    }
  })

  it('warns that a promo code replaces the discount', () => {
    expect(buildFoundingOfferEmail({ lang: 'en', label: null, couponForever: true, baseUrl: BASE }).bodyText).toContain('replaces your founding discount')
    expect(buildFoundingOfferEmail({ lang: 'es', label: null, couponForever: true, baseUrl: BASE }).bodyText).toContain('reemplaza tu descuento de fundador')
  })
})
