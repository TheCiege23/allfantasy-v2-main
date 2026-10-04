// @vitest-environment node
/**
 * The two decisions behind an irreversible mass send (scripts/send-founding-offer.ts), tested here
 * so they never have to be "verified" by sending: when `--apply` must refuse, and who receives it.
 */
import { describe, expect, it } from 'vitest'

import { foundingSendBlockers, selectFoundingRecipients, type CouponCheck } from '@/lib/monetization/foundingOfferSend'

const BEFORE = new Date('2026-10-04T12:00:00Z')
const LAUNCH = new Date('2026-10-15T04:00:00Z')
const PROD = 'https://www.allfantasy.ai'
const READY: CouponCheck = { keyMode: 'LIVE', couponSet: true, coupon: { valid: true, livemode: true } }

describe('foundingSendBlockers', () => {
  it('a live key, a valid live coupon, before launch, on production: nothing blocks', () => {
    expect(foundingSendBlockers({ coupon: READY, now: BEFORE, startsAt: LAUNCH, baseUrl: PROD })).toEqual([])
  })

  it('refuses without the coupon — today’s production state', () => {
    const b = foundingSendBlockers({ coupon: { keyMode: 'LIVE', couponSet: false, coupon: null }, now: BEFORE, startsAt: LAUNCH, baseUrl: PROD })
    expect(b).toEqual(['STRIPE_FOUNDING_COUPON_ID is not set'])
  })

  it('refuses on a test key, an invalid or test-mode coupon, or a failed lookup', () => {
    expect(foundingSendBlockers({ coupon: { ...READY, keyMode: 'TEST' }, now: BEFORE, startsAt: LAUNCH, baseUrl: PROD })).toContain('Stripe key is not LIVE')
    expect(foundingSendBlockers({ coupon: { ...READY, coupon: { valid: false, livemode: true } }, now: BEFORE, startsAt: LAUNCH, baseUrl: PROD })).toHaveLength(1)
    expect(foundingSendBlockers({ coupon: { ...READY, coupon: { valid: true, livemode: false } }, now: BEFORE, startsAt: LAUNCH, baseUrl: PROD })).toEqual(['coupon is not a LIVE coupon'])
    expect(foundingSendBlockers({ coupon: { ...READY, coupon: null, lookupError: 'No such coupon' }, now: BEFORE, startsAt: LAUNCH, baseUrl: PROD })).toEqual(['coupon lookup failed: No such coupon'])
  })

  it('refuses once the paywall has started, and on a non-production base URL', () => {
    expect(foundingSendBlockers({ coupon: READY, now: LAUNCH, startsAt: LAUNCH, baseUrl: PROD })).toHaveLength(1)
    expect(foundingSendBlockers({ coupon: READY, now: BEFORE, startsAt: LAUNCH, baseUrl: 'http://localhost:3000' })).toHaveLength(1)
    expect(foundingSendBlockers({ coupon: READY, now: BEFORE, startsAt: LAUNCH, baseUrl: 'http://www.allfantasy.ai' })).toHaveLength(1)
  })
})

describe('selectFoundingRecipients', () => {
  const at = new Date('2026-09-01T00:00:00Z')
  const verified = new Date('2026-09-02T00:00:00Z')
  const u = (id: string, email: string | null, opts: { verified?: boolean; createdAt?: Date } = {}) => ({
    id, email, emailVerified: opts.verified === false ? null : verified, createdAt: opts.createdAt ?? at,
  })

  it('keeps verified founding members, in their language, once per address', () => {
    const { recipients, skipped } = selectFoundingRecipients({
      users: [u('1', 'Ana@Gmail.com'), u('2', 'bo@gmail.com'), u('3', 'ana@gmail.com')],
      optedOut: new Set(),
      languages: new Map([['1', 'es-MX'], ['2', null]]),
      includeUnverified: false,
    })
    expect(recipients).toEqual([{ email: 'ana@gmail.com', lang: 'es' }, { email: 'bo@gmail.com', lang: 'en' }])
    expect(skipped).toEqual({ 'duplicate address': 1 })
  })

  it('skips the opted-out, test and undeliverable domains, the unverified, post-launch accounts and blanks', () => {
    const { recipients, skipped } = selectFoundingRecipients({
      users: [
        u('a', 'out@gmail.com'),
        u('b', 'qa@example.com'),
        u('c', 'new@gmail.com', { verified: false }),
        u('d', 'late@gmail.com', { createdAt: new Date('2026-10-16T00:00:00Z') }),
        u('e', null),
      ],
      optedOut: new Set(['out@gmail.com']),
      languages: new Map(),
      includeUnverified: false,
    })
    expect(recipients).toEqual([])
    expect(skipped).toEqual({
      'unsubscribed or product updates off': 1,
      'test domain': 1,
      'email never verified': 1,
      'not a founding member': 1,
      'no email': 1,
    })
  })

  it('--include-unverified reaches unverified addresses; --only narrows to one', () => {
    const users = [u('1', 'a@gmail.com', { verified: false }), u('2', 'b@gmail.com')]
    expect(selectFoundingRecipients({ users, optedOut: new Set(), languages: new Map(), includeUnverified: true }).recipients).toHaveLength(2)
    expect(selectFoundingRecipients({ users, optedOut: new Set(), languages: new Map(), includeUnverified: true, only: 'B@gmail.com' }).recipients).toEqual([{ email: 'b@gmail.com', lang: 'en' }])
  })
})
