import { describe, expect, it, vi } from 'vitest'

/*
 * The Black Friday sale emails and who receives them (scripts/send-holiday-sale.ts).
 * Pins: every price in the email is the catalog price halved the same way /pricing shows it; only
 * FREE users get it (a paying or unreadable account never does); unsubscribed, unverified, test and
 * duplicate addresses are skipped; --apply refuses outside the sale, on a non-production URL, and
 * for a "last day" email that would arrive before Monday.
 */
vi.mock('server-only', () => ({}))

import { buildHolidaySaleEmail } from '@/lib/monetization/holidaySaleEmail'
import {
  HOLIDAY_EMAIL_DEFAULT_SEND_AT,
  holidaySendBlockers,
  isFreeForSale,
  selectHolidaySaleRecipients,
  type PlanStatus,
} from '@/lib/monetization/holidaySaleSend'

const BASE = 'https://allfantasy.ai'
const NOW = new Date('2026-11-25T15:00:00.000Z')

describe('the emails', () => {
  it('quotes the sale prices the pricing page charges, and links to /pricing', () => {
    const { subject, bodyText } = buildHolidaySaleEmail({ kind: 'launch', lang: 'en', baseUrl: BASE })
    expect(subject).toBe('50% off AllFantasy, this weekend only')
    for (const s of [
      'AF Pro: $40 for the year (normally $79.99)',
      'AF Commissioner: $65 for the year (normally $129.99)',
      'AF Supreme: $80 for the year (normally $159.99)',
      'for 12 months: $5, $7.50 and $10.',
      'Get 50% off: https://allfantasy.ai/pricing',
      'Ends Monday, Nov 30 at 11:59 PM ET.',
    ]) expect(bodyText).toContain(s)
    expect(bodyText).not.toMatch(/\bAI\b/)
  })

  it('has a last-day reminder and Spanish versions of both, with the same prices', () => {
    expect(buildHolidaySaleEmail({ kind: 'lastday', lang: 'en', baseUrl: BASE }).subject).toBe('Last day: 50% off ends tonight')
    const es = buildHolidaySaleEmail({ kind: 'launch', lang: 'es', baseUrl: BASE })
    expect(es.bodyText).toContain('AF Pro: $40 por el año (normalmente $79.99)')
    expect(es.bodyText).toContain('https://allfantasy.ai/pricing')
    expect(buildHolidaySaleEmail({ kind: 'lastday', lang: 'es', baseUrl: BASE }).subject).toContain('termina hoy')
  })
})

describe('who receives it', () => {
  const user = (id: string, email: string | null, verified = true) => ({ id, email, emailVerified: verified ? new Date() : null })
  const status = (entries: Array<[string, PlanStatus]>) => new Map(entries)

  it('free and lapsed users only; payers and unreadable plans are skipped', () => {
    expect(isFreeForSale('none')).toBe(true)
    expect(isFreeForSale('expired')).toBe(true)
    for (const s of ['active', 'grace', 'past_due', null] as PlanStatus[]) expect(isFreeForSale(s)).toBe(false)

    const { recipients, skipped } = selectHolidaySaleRecipients({
      users: [
        user('free', 'Free@Gmail.com'),
        user('lapsed', 'lapsed@gmail.com'),
        user('pro', 'pro@gmail.com'),
        user('broken', 'broken@gmail.com'),
        user('unsub', 'unsub@gmail.com'),
        user('unverified', 'new@gmail.com', false),
        user('test', 'qa@example.com'),
        user('dupe', 'free@gmail.com'),
        user('noemail', null),
        user('es', 'es@gmail.com'),
      ],
      planStatus: status([
        ['free', 'none'], ['lapsed', 'expired'], ['pro', 'active'], ['broken', null], ['unsub', 'none'],
        ['unverified', 'none'], ['test', 'none'], ['dupe', 'none'], ['es', 'none'],
      ]),
      optedOut: new Set(['unsub@gmail.com']),
      languages: new Map([['es', 'es-MX']]),
      includeUnverified: false,
    })
    expect(recipients.map((r) => `${r.email}:${r.lang}`)).toEqual(['free@gmail.com:en', 'lapsed@gmail.com:en', 'es@gmail.com:es'])
    expect(skipped).toEqual({
      'already pays': 1,
      'plan could not be read': 1,
      'unsubscribed or product updates off': 1,
      'email never verified': 1,
      'test domain': 1,
      'duplicate address': 1,
      'no email': 1,
    })
  })

  it('--only narrows to one address', () => {
    const { recipients } = selectHolidaySaleRecipients({
      users: [user('a', 'a@gmail.com'), user('b', 'b@gmail.com')],
      planStatus: status([['a', 'none'], ['b', 'none']]),
      optedOut: new Set(), languages: new Map(), includeUnverified: false, only: 'B@gmail.com',
    })
    expect(recipients.map((r) => r.email)).toEqual(['b@gmail.com'])
  })
})

describe('when it may be sent', () => {
  const env = {}
  it('allows the scheduled Friday and Monday sends', () => {
    expect(holidaySendBlockers({ kind: 'launch', sendAt: new Date(HOLIDAY_EMAIL_DEFAULT_SEND_AT.launch), now: NOW, baseUrl: BASE, env })).toEqual([])
    expect(holidaySendBlockers({ kind: 'lastday', sendAt: new Date(HOLIDAY_EMAIL_DEFAULT_SEND_AT.lastday), now: NOW, baseUrl: BASE, env })).toEqual([])
  })

  it('refuses a delivery outside the sale, a last-day email before Monday, a past time, or a dev URL', () => {
    expect(holidaySendBlockers({ kind: 'launch', sendAt: NOW, now: NOW, baseUrl: BASE, env }).join()).toMatch(/sale is not running/)
    expect(holidaySendBlockers({ kind: 'lastday', sendAt: new Date('2026-11-28T15:00:00Z'), now: NOW, baseUrl: BASE, env }).join()).toMatch(/Monday Nov 30/)
    expect(holidaySendBlockers({ kind: 'launch', sendAt: new Date('2026-11-24T15:00:00Z'), now: NOW, baseUrl: BASE, env }).join()).toMatch(/in the past/)
    expect(holidaySendBlockers({ kind: 'launch', sendAt: new Date(HOLIDAY_EMAIL_DEFAULT_SEND_AT.launch), now: NOW, baseUrl: 'http://localhost:3000', env }).join()).toMatch(/not production/)
    expect(holidaySendBlockers({ kind: 'launch', sendAt: new Date(HOLIDAY_EMAIL_DEFAULT_SEND_AT.launch), now: NOW, baseUrl: BASE, env: { NEXT_PUBLIC_HOLIDAY_SALE_DISABLED: '1' } }).join()).toMatch(/sale is not running/)
  })
})
