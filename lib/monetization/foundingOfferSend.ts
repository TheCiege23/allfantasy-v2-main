/**
 * The two decisions scripts/send-founding-offer.ts must get right before an irreversible mass send,
 * kept pure so they are unit-tested rather than verified by sending:
 *   - `foundingSendBlockers`: everything that makes `--apply` refuse.
 *   - `selectFoundingRecipients`: who receives the email, and why everyone else does not.
 */
import { isUndeliverableEmailDomain } from '@/lib/email/undeliverableDomains'
import { isFoundingMemberAccount } from '@/lib/monetization/foundingMember'

export const FOUNDING_TEST_DOMAINS = ['@example.com', '@example.org', '@example.net', '@allfantasy.local', '@test.com']

export type CouponCheck = {
  keyMode: 'LIVE' | 'TEST' | 'UNSET' | 'UNKNOWN'
  couponSet: boolean
  /** Null when no coupon could be read. */
  coupon: { valid: boolean; livemode: boolean } | null
  lookupError?: string | null
}

/** Every reason the send must not happen. Empty means it may. */
export function foundingSendBlockers(args: { coupon: CouponCheck; now: Date; startsAt: Date; baseUrl: string }): string[] {
  const { coupon, now, startsAt, baseUrl } = args
  const out: string[] = []
  if (coupon.keyMode !== 'LIVE') out.push('Stripe key is not LIVE')
  if (!coupon.couponSet) out.push('STRIPE_FOUNDING_COUPON_ID is not set')
  else if (coupon.lookupError) out.push(`coupon lookup failed: ${coupon.lookupError}`)
  else if (!coupon.coupon) out.push('coupon could not be read')
  else {
    if (!coupon.coupon.valid) out.push('coupon is not valid (expired, deleted or fully redeemed)')
    if (!coupon.coupon.livemode) out.push('coupon is not a LIVE coupon')
  }
  if (now.getTime() >= startsAt.getTime()) {
    out.push(`the paywall already started (${startsAt.toISOString()}) — the copy announces it as upcoming`)
  }
  if (!/^https:\/\//.test(baseUrl) || /localhost|127\.0\.0\.1/.test(baseUrl)) out.push(`base URL is ${baseUrl}, not production`)
  return out
}

export type FoundingCandidate = { id: string; email: string | null; emailVerified: Date | null; createdAt: Date }

export function selectFoundingRecipients(args: {
  users: readonly FoundingCandidate[]
  /** Lower-cased addresses that unsubscribed or switched product updates off. */
  optedOut: ReadonlySet<string>
  /** userId → `UserProfile.preferredLanguage`. */
  languages: ReadonlyMap<string, string | null>
  includeUnverified: boolean
  /** Restrict to one address (a test send). */
  only?: string | null
}): { recipients: Array<{ email: string; lang: 'en' | 'es' }>; skipped: Record<string, number> } {
  const skipped: Record<string, number> = {}
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1)
  const seen = new Set<string>()
  const recipients: Array<{ email: string; lang: 'en' | 'es' }> = []
  const only = args.only?.trim().toLowerCase() || null
  for (const u of args.users) {
    const email = u.email?.trim().toLowerCase() ?? ''
    if (!email || !email.includes('@')) { skip('no email'); continue }
    if (only && email !== only) continue
    if (!isFoundingMemberAccount(u.createdAt)) { skip('not a founding member'); continue }
    if (FOUNDING_TEST_DOMAINS.some((d) => email.endsWith(d))) { skip('test domain'); continue }
    if (isUndeliverableEmailDomain(email)) { skip('undeliverable domain'); continue }
    if (args.optedOut.has(email)) { skip('unsubscribed or product updates off'); continue }
    if (!u.emailVerified && !args.includeUnverified) { skip('email never verified'); continue }
    if (seen.has(email)) { skip('duplicate address'); continue }
    seen.add(email)
    const lang = String(args.languages.get(u.id) ?? 'en').toLowerCase().startsWith('es') ? 'es' : 'en'
    recipients.push({ email, lang })
  }
  return { recipients, skipped }
}
