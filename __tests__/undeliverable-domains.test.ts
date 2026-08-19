import { describe, it, expect } from 'vitest'
import { isUndeliverableEmailDomain } from '@/lib/email/undeliverableDomains'

/**
 * The exact addresses that polluted production are the first case, because a
 * regression here is invisible: the list simply starts filling with test rows
 * again and nobody notices until the totals look wrong.
 */
describe('isUndeliverableEmailDomain', () => {
  it('rejects the e2e addresses that actually reached production', () => {
    // 113 of 146 rows in EarlyAccessSignup looked like this.
    expect(isUndeliverableEmailDomain('e2e-user-1755551234@example.com')).toBe(true)
    expect(isUndeliverableEmailDomain('playwright+run@example.com')).toBe(true)
  })

  it('rejects every RFC 2606 reserved second-level domain, and their subdomains', () => {
    for (const e of [
      'a@example.com', 'a@example.net', 'a@example.org',
      'a@mail.example.com', 'a@deep.sub.example.org',
    ]) expect(isUndeliverableEmailDomain(e)).toBe(true)
  })

  it('rejects reserved TLDs', () => {
    for (const e of ['a@foo.test', 'a@bar.invalid', 'a@thing.localhost', 'a@localhost'])
      expect(isUndeliverableEmailDomain(e)).toBe(true)
  })

  it('is case and whitespace insensitive', () => {
    expect(isUndeliverableEmailDomain('  E2E@EXAMPLE.COM  ')).toBe(true)
  })

  it('treats malformed input as uncontactable rather than letting it through', () => {
    for (const e of ['', '   ', null, undefined, 'no-at-sign', '@nolocal.com', 'trailing@'])
      expect(isUndeliverableEmailDomain(e as string)).toBe(true)
  })

  it('ACCEPTS real addresses — including ones that merely look testy', () => {
    for (const e of [
      'sean@gmail.com',
      'ip@parron.law',
      'noah.timmer@oracle.com',
      // A real domain that happens to contain "example" or "test" is fine —
      // only the reserved names are excluded.
      'a@exampleschool.edu',
      'a@testudo.com',
      'a@protest.org',
      'user+tag@gmail.com',
    ]) expect(isUndeliverableEmailDomain(e)).toBe(false)
  })
})
