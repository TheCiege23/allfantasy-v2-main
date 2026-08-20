/**
 * Addresses that can never receive mail, and must never enter a marketing list.
 *
 * ⚠ THIS IS NOT AN ENVIRONMENT CHECK, AND THAT IS THE POINT. The obvious guard —
 * "skip the mirror unless NODE_ENV is production" — does not work here: Vercel
 * PREVIEW deployments point at the PRODUCTION database, so an e2e run against a
 * preview is a production write no matter what the environment variable says.
 * Measured consequence: 114 of 146 rows in EarlyAccessSignup were
 * `e2e…@example.com`, all with `source: account_signup`, still arriving as
 * recently as 2026-08-16. The real waitlist was 32 people.
 *
 * Domain reservation is the durable test instead. RFC 2606 and RFC 6761 set
 * these aside precisely so they can be used in documentation and testing and
 * are guaranteed never to resolve. An address at one of them is undeliverable
 * by definition, in every environment, forever — so writing it to a list whose
 * only purpose is sending mail is always a mistake.
 *
 * ⚠ THIS DOES NOT BLOCK REGISTRATION. A test account still registers and still
 * works; it simply does not get mirrored into the marketing list. Blocking
 * signup would break every e2e suite that depends on it.
 *
 * ⚠ AND IT IS NOT A DELIVERABILITY FILTER. Real-but-dead addresses still land
 * here and still bounce — that is a suppression-list problem, separate from
 * this. This only excludes what is reserved-by-standard.
 */

/** RFC 2606 §2 reserved second-level domains. */
const RESERVED_DOMAINS = new Set([
  'example.com',
  'example.net',
  'example.org',
])

/** RFC 2606 §2 and RFC 6761 reserved TLDs. */
const RESERVED_TLDS = ['.test', '.example', '.invalid', '.localhost']

/**
 * True when the address is at a standards-reserved domain and therefore cannot
 * receive mail. Malformed input returns true as well: something with no usable
 * domain is not a contactable address either, and a marketing list is the wrong
 * place to be lenient.
 */
export function isUndeliverableEmailDomain(email: string | null | undefined): boolean {
  const value = (email ?? '').trim().toLowerCase()
  const at = value.lastIndexOf('@')
  if (at <= 0 || at === value.length - 1) return true

  const domain = value.slice(at + 1)
  if (RESERVED_DOMAINS.has(domain)) return true
  // Subdomains count: mail.example.com is as undeliverable as example.com.
  for (const reserved of RESERVED_DOMAINS) {
    if (domain.endsWith(`.${reserved}`)) return true
  }
  for (const tld of RESERVED_TLDS) {
    if (domain === tld.slice(1) || domain.endsWith(tld)) return true
  }
  return false
}
