/**
 * Send the founding-member offer (checklist §5 "Tell existing users", due Oct 8) to every account
 * created before launch. DRY RUN BY DEFAULT: it lists who would receive it and why others would not,
 * and writes both language versions to a preview file. Nothing is sent without `--apply`.
 *
 * 🛑 `--apply` REFUSES unless the offer is actually live — the draft's own rule
 * (docs/FOUNDING_OFFER_EMAIL_DRAFT.md): an email cannot check the coupon at render time the way the
 * pages do, so sending while `STRIPE_FOUNDING_COUPON_ID` is unset makes every founding line false the
 * moment someone clicks through. The rules are `foundingSendBlockers`
 * (lib/monetization/foundingOfferSend.ts), read live at send time: a LIVE key, the coupon set and
 * valid in live Stripe, the paywall not yet started, and a production base URL. "Your founding
 * pricing doesn't expire" is printed only if the coupon's duration is `forever`.
 *
 * WHO RECEIVES IT: `selectFoundingRecipients` — accounts created before launch with an email, minus
 * test and undeliverable domains, anyone unsubscribed or with product updates off (`emailPreference`,
 * the table the unsubscribe link writes), and, unless `--include-unverified`, anyone whose email was
 * never verified (bounces are charged against sender reputation).
 *
 * ONCE PER ADDRESS: each send first claims a `SportsDataCache` key; a re-run skips everyone already
 * claimed, and a failed send releases its claim so a retry can reach that person.
 *
 * Run inside the production environment, from the linked primary checkout, so the live keys and base
 * URL apply — `railway run` puts them in the process environment and nothing is printed:
 *
 *   railway run --service allfantasy-v2-main node --require ./scripts/_audit-preload.cjs --import tsx scripts/send-founding-offer.ts
 *   … add --only=<your email> --apply for a single test send, then --apply for everyone
 *
 * Options: --apply · --include-unverified · --preview-out=<file> · --only=<email>
 */
import crypto from 'node:crypto'
import { writeFileSync } from 'node:fs'
import Stripe from 'stripe'

import { prisma } from '../lib/prisma'
import { getBaseUrl } from '../lib/get-base-url'
import { sendMarketingEmail } from '../lib/email/marketing-email'
import { getFoundingCouponId, getFoundingOfferLabel } from '../lib/monetization/foundingMember'
import { getPaywallStartsAt } from '../lib/monetization/paywallLaunch'
import { buildFoundingOfferEmail } from '../lib/monetization/foundingOfferEmail'
import { foundingSendBlockers, selectFoundingRecipients, type CouponCheck } from '../lib/monetization/foundingOfferSend'

const APPLY = process.argv.includes('--apply')
const INCLUDE_UNVERIFIED = process.argv.includes('--include-unverified')
const PREVIEW_OUT = process.argv.find((a) => a.startsWith('--preview-out='))?.slice('--preview-out='.length) ?? null
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null

/** About 135 accounts exist; a far larger match is a bug, and a mass mailing deserves a human look first. */
const MAX_RECIPIENTS = 1000
/** Resend's default limit is 2 requests a second. */
const SEND_GAP_MS = 600
const LEDGER_TTL_MS = 120 * 24 * 60 * 60 * 1000

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24)
const ledgerKey = (email: string) => `founding-offer-email:v1:${sha(email)}`
const mask = (email: string) => email.replace(/^(.).*(@.*)$/, '$1***$2')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const scrub = (s: string) => s.replace(/sk_(live|test)_\S+/g, 'sk_***')

async function readCoupon(): Promise<{ check: CouponCheck; forever: boolean; terms: string }> {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? ''
  const keyMode = key.startsWith('sk_live') ? 'LIVE' : key.startsWith('sk_test') ? 'TEST' : key ? 'UNKNOWN' : 'UNSET'
  const couponId = getFoundingCouponId()
  const check: CouponCheck = { keyMode, couponSet: Boolean(couponId), coupon: null }
  if (!couponId || !key) return { check, forever: false, terms: 'no coupon' }
  try {
    const c = await new Stripe(key, { apiVersion: '2026-02-25.clover' }).coupons.retrieve(couponId)
    check.coupon = { valid: c.valid, livemode: c.livemode }
    const off = c.percent_off != null ? `${c.percent_off}% off` : c.amount_off != null ? `${c.amount_off / 100} ${c.currency} off` : '?'
    return { check, forever: c.duration === 'forever', terms: `${off}, duration ${c.duration}${c.duration_in_months ? ` (${c.duration_in_months} months)` : ''}` }
  } catch (e) {
    check.lookupError = scrub(e instanceof Error ? e.message : 'error')
    return { check, forever: false, terms: 'unreadable' }
  }
}

async function main() {
  const now = new Date()
  const startsAt = getPaywallStartsAt()
  const baseUrl = getBaseUrl().replace(/\/+$/, '')
  const label = getFoundingOfferLabel()
  const coupon = await readCoupon()
  const blockers = foundingSendBlockers({ coupon: coupon.check, now, startsAt, baseUrl })

  const users = await prisma.appUser.findMany({
    where: { createdAt: { lt: startsAt } },
    select: { id: true, email: true, emailVerified: true, createdAt: true },
  })
  const optedOut = new Set(
    (
      await prisma.emailPreference.findMany({
        where: { OR: [{ unsubscribedAt: { not: null } }, { productUpdates: false }] },
        select: { email: true },
      })
    ).map((r) => r.email.trim().toLowerCase()),
  )
  const languages = new Map(
    (
      await prisma.userProfile.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
        select: { userId: true, preferredLanguage: true },
      })
    ).map((p) => [p.userId, p.preferredLanguage] as const),
  )
  const { recipients, skipped } = selectFoundingRecipients({ users, optedOut, languages, includeUnverified: INCLUDE_UNVERIFIED, only: ONLY })
  const alreadySent = new Set(
    (
      await prisma.sportsDataCache.findMany({
        where: { cacheKey: { in: recipients.map((r) => ledgerKey(r.email)) } },
        select: { cacheKey: true },
      })
    ).map((r) => r.cacheKey),
  )
  const pending = recipients.filter((r) => !alreadySent.has(ledgerKey(r.email)))

  const en = buildFoundingOfferEmail({ lang: 'en', label, couponForever: coupon.forever, baseUrl })
  const es = buildFoundingOfferEmail({ lang: 'es', label, couponForever: coupon.forever, baseUrl })
  if (PREVIEW_OUT) {
    writeFileSync(PREVIEW_OUT, `SUBJECT: ${en.subject}\n\n${en.bodyText}\n\n${'='.repeat(72)}\n\nSUBJECT: ${es.subject}\n\n${es.bodyText}\n`)
  }

  console.log(JSON.stringify({
    mode: APPLY ? 'APPLY' : 'DRY RUN',
    launch: startsAt.toISOString(),
    baseUrl,
    coupon: coupon.terms,
    offerLabel: label,
    doesntExpireClause: coupon.forever,
    accountsBeforeLaunch: users.length,
    recipients: recipients.length,
    byLanguage: { en: recipients.filter((r) => r.lang === 'en').length, es: recipients.filter((r) => r.lang === 'es').length },
    alreadySent: recipients.length - pending.length,
    toSendNow: pending.length,
    skipped,
    blockers,
    preview: PREVIEW_OUT,
  }, null, 1))

  if (!APPLY) return
  if (blockers.length) {
    console.error(`\nREFUSING TO SEND — ${blockers.length} blocker(s) above. Nothing was sent.`)
    process.exitCode = 2
    return
  }
  if (pending.length > MAX_RECIPIENTS) {
    console.error(`\nREFUSING TO SEND — ${pending.length} recipients exceeds the ${MAX_RECIPIENTS} sanity cap.`)
    process.exitCode = 2
    return
  }

  let sent = 0, failed = 0, raced = 0
  for (const r of pending) {
    try {
      await prisma.sportsDataCache.create({
        data: { cacheKey: ledgerKey(r.email), expiresAt: new Date(Date.now() + LEDGER_TTL_MS), data: { claimedAt: new Date().toISOString(), lang: r.lang } },
      })
    } catch {
      raced++ // another run claimed it first
      continue
    }
    const msg = r.lang === 'es' ? es : en
    const res = await sendMarketingEmail({ to: r.email, subject: msg.subject, bodyText: msg.bodyText })
    if (res.ok) {
      sent++
      console.log(`sent    ${mask(r.email)} (${r.lang})`)
    } else {
      failed++
      await prisma.sportsDataCache.delete({ where: { cacheKey: ledgerKey(r.email) } }).catch(() => {})
      console.log(`FAILED  ${mask(r.email)} — ${scrub(String(res.error)).slice(0, 120)} (claim released, safe to retry)`)
    }
    await sleep(SEND_GAP_MS)
  }
  console.log(`\nDONE sent=${sent} failed=${failed} skipped-already-claimed=${raced}`)
  if (failed) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error('FAILED', scrub(e instanceof Error ? e.message : String(e)))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
