/**
 * The decisions scripts/send-holiday-sale.ts must get right before an irreversible mass send, kept
 * pure so they are unit-tested rather than verified by sending (same shape as foundingOfferSend.ts):
 *   - `holidaySendBlockers`: everything that makes `--apply` refuse.
 *   - `selectHolidaySaleRecipients`: who receives the email, and why everyone else does not.
 *
 * WHO: free users — no plan that is active, in grace or past due. A paying customer cannot get the
 * sale price (it is for new subscriptions), so emailing them "50% off" is a promise checkout breaks.
 * A user whose plan could not be read is SKIPPED, never assumed free.
 */
import { isUndeliverableEmailDomain } from '@/lib/email/undeliverableDomains'
import { getHolidaySale } from '@/lib/monetization/holidaySale'
import type { HolidaySaleEmailKind } from '@/lib/monetization/holidaySaleEmail'

type Env = Record<string, string | undefined>

const TEST_DOMAINS = ['@example.com', '@example.org', '@example.net', '@allfantasy.local', '@test.com']

/** Friday 9:30 AM ET and Monday 5:00 PM ET — the defaults the script schedules for. */
export const HOLIDAY_EMAIL_DEFAULT_SEND_AT: Record<HolidaySaleEmailKind, string> = {
  launch: '2026-11-27T14:30:00.000Z',
  lastday: '2026-11-30T22:00:00.000Z',
}

/** Entitlement status from EntitlementResolver; null = the read failed. */
export type PlanStatus = 'active' | 'grace' | 'past_due' | 'expired' | 'none' | null

/** Free for this email: never had a plan, or one that has lapsed. */
export function isFreeForSale(status: PlanStatus): boolean {
  return status === 'none' || status === 'expired'
}

/** Every reason the send must not happen. Empty means it may. */
export function holidaySendBlockers(args: {
  kind: HolidaySaleEmailKind
  /** When the email will be delivered: the scheduled instant, or now. */
  sendAt: Date
  now: Date
  baseUrl: string
  env: Env
}): string[] {
  const { kind, sendAt, now, baseUrl, env } = args
  const out: string[] = []
  if (Number.isNaN(sendAt.getTime())) out.push('the send time is not a date')
  else {
    if (!getHolidaySale(sendAt, env)) out.push(`the sale is not running at ${sendAt.toISOString()} — the email would promise a price checkout will not apply`)
    if (sendAt.getTime() < now.getTime() - 60_000) out.push('the send time is in the past')
    if (sendAt.getTime() > now.getTime() + 30 * 24 * 3600 * 1000) out.push('the send time is more than 30 days out (Resend will not schedule it)')
    // "Ends tonight" must be said on the last day, Eastern: Monday Nov 30 ET = 05:00Z Nov 30 → 05:00Z Dec 1.
    if (kind === 'lastday' && !(sendAt.getTime() >= Date.parse('2026-11-30T05:00:00.000Z'))) {
      out.push('the last-day email says "ends tonight" — it must be delivered on Monday Nov 30 ET')
    }
  }
  if (!/^https:\/\//.test(baseUrl) || /localhost|127\.0\.0\.1/.test(baseUrl)) out.push(`base URL is ${baseUrl}, not production`)
  return out
}

type Candidate = { id: string; email: string | null; emailVerified: Date | null }

export function selectHolidaySaleRecipients(args: {
  users: readonly Candidate[]
  /** userId → entitlement status; missing or null = the read failed. */
  planStatus: ReadonlyMap<string, PlanStatus>
  /** Lower-cased addresses that unsubscribed or switched product updates off. */
  optedOut: ReadonlySet<string>
  /** userId → `UserProfile.preferredLanguage`. */
  languages: ReadonlyMap<string, string | null>
  includeUnverified: boolean
  /** Restrict to one address (a test send). */
  only?: string | null
}): { recipients: Array<{ userId: string; email: string; lang: 'en' | 'es' }>; skipped: Record<string, number> } {
  const skipped: Record<string, number> = {}
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1)
  const seen = new Set<string>()
  const recipients: Array<{ userId: string; email: string; lang: 'en' | 'es' }> = []
  const only = args.only?.trim().toLowerCase() || null
  for (const u of args.users) {
    const email = u.email?.trim().toLowerCase() ?? ''
    if (!email || !email.includes('@')) { skip('no email'); continue }
    if (only && email !== only) continue
    if (TEST_DOMAINS.some((d) => email.endsWith(d))) { skip('test domain'); continue }
    if (isUndeliverableEmailDomain(email)) { skip('undeliverable domain'); continue }
    if (args.optedOut.has(email)) { skip('unsubscribed or product updates off'); continue }
    if (!u.emailVerified && !args.includeUnverified) { skip('email never verified'); continue }
    const status = args.planStatus.get(u.id) ?? null
    if (status === null) { skip('plan could not be read'); continue }
    if (!isFreeForSale(status)) { skip('already pays'); continue }
    if (seen.has(email)) { skip('duplicate address'); continue }
    seen.add(email)
    const lang = String(args.languages.get(u.id) ?? 'en').toLowerCase().startsWith('es') ? 'es' : 'en'
    recipients.push({ userId: u.id, email, lang })
  }
  return { recipients, skipped }
}
