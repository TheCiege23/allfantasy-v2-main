/**
 * Email FREE users about the Black Friday → Cyber Monday sale (lib/monetization/holidaySale.ts).
 * DRY RUN BY DEFAULT: it lists who would receive it and why others would not, and writes both
 * language versions to a preview file. Nothing is sent without `--apply`.
 *
 *   --kind=launch    Friday's announcement (default)
 *   --kind=lastday   Monday's "ends tonight" reminder
 *
 * SCHEDULED BY DEFAULT, through Resend: launch for Fri Nov 27 9:30 AM ET, lastday for Mon Nov 30
 * 5:00 PM ET (HOLIDAY_EMAIL_DEFAULT_SEND_AT). Run it any time before then and Resend delivers on
 * time, whether or not this machine is on. `--send-at=<ISO>` picks another instant; `--now` sends
 * immediately. A scheduled email can be cancelled in Resend until it goes out.
 *
 * 🛑 `--apply` REFUSES unless the sale is running at the delivery time and the base URL is production
 * (`holidaySendBlockers`, lib/monetization/holidaySaleSend.ts) — an email cannot re-check the sale
 * when it is opened, so it must not promise a price checkout will not apply.
 *
 * WHO: `selectHolidaySaleRecipients` — accounts with an email whose plan is none or expired (read
 * strictly; a failed read skips the person), minus test and undeliverable domains, anyone
 * unsubscribed or with product updates off, and, unless `--include-unverified`, unverified emails.
 *
 * ONCE PER ADDRESS PER EMAIL: each send first claims a `SportsDataCache` key; a re-run skips everyone
 * already claimed, and a failed send releases its claim so a retry can reach that person.
 *
 * Run inside the production environment so the live keys and base URL apply — `railway run` puts
 * them in the process environment and nothing is printed:
 *
 *   railway run --service allfantasy-v2-main node --require ./scripts/_audit-preload.cjs --import tsx scripts/send-holiday-sale.ts
 *   … add --only=<your email> --apply for a single test, then --apply for everyone
 *
 * Options: --apply · --kind=launch|lastday · --send-at=<ISO> · --now · --only=<email>
 *          --include-unverified · --preview-out=<file> · --max=<n>
 */
import crypto from 'node:crypto'
import { writeFileSync } from 'node:fs'

import { prisma } from '../lib/prisma'
import { getBaseUrl } from '../lib/get-base-url'
import { sendMarketingEmail } from '../lib/email/marketing-email'
import { EntitlementResolver } from '../lib/subscription/EntitlementResolver'
import { buildHolidaySaleEmail, type HolidaySaleEmailKind } from '../lib/monetization/holidaySaleEmail'
import {
  HOLIDAY_EMAIL_DEFAULT_SEND_AT,
  holidaySendBlockers,
  selectHolidaySaleRecipients,
  type PlanStatus,
} from '../lib/monetization/holidaySaleSend'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
const APPLY = process.argv.includes('--apply')
const NOW = process.argv.includes('--now')
const INCLUDE_UNVERIFIED = process.argv.includes('--include-unverified')
const KIND = (arg('kind') ?? 'launch') as HolidaySaleEmailKind
const PREVIEW_OUT = arg('preview-out')
const ONLY = arg('only')
const SEND_AT_ARG = arg('send-at')
/** A far larger match than expected is a bug; a mass mailing deserves a human look first. */
const MAX_RECIPIENTS = Number(arg('max') ?? 5000)
/** Resend's default limit is 2 requests a second. */
const SEND_GAP_MS = 600
const LEDGER_TTL_MS = 60 * 24 * 60 * 60 * 1000

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24)
const ledgerKey = (email: string) => `holiday-sale-email:bf2026:${KIND}:v1:${sha(email)}`
const mask = (email: string) => email.replace(/^(.).*(@.*)$/, '$1***$2')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const scrub = (s: string) => s.replace(/(sk|re|rk)_(live|test)?_?[A-Za-z0-9]{8,}/g, '***')

async function main() {
  if (KIND !== 'launch' && KIND !== 'lastday') throw new Error(`--kind must be launch or lastday, not ${KIND}`)
  const now = new Date()
  const sendAt = NOW ? now : new Date(SEND_AT_ARG ?? HOLIDAY_EMAIL_DEFAULT_SEND_AT[KIND])
  const baseUrl = getBaseUrl().replace(/\/+$/, '')
  const blockers = holidaySendBlockers({ kind: KIND, sendAt, now, baseUrl, env: { ...process.env, VITEST: undefined } })

  const users = await prisma.appUser.findMany({
    where: { email: { not: null } },
    select: { id: true, email: true, emailVerified: true },
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

  // Plans, read strictly: a failed read is null, and null is skipped rather than assumed free.
  const resolver = new EntitlementResolver()
  const planStatus = new Map<string, PlanStatus>()
  const only = ONLY?.trim().toLowerCase() || null
  for (const u of users) {
    if (only && u.email?.trim().toLowerCase() !== only) continue
    try {
      const snap = await resolver.resolveSnapshot(u.id, u.email, { strictReads: true })
      planStatus.set(u.id, snap.status)
    } catch {
      planStatus.set(u.id, null)
    }
  }

  const { recipients, skipped } = selectHolidaySaleRecipients({
    users, planStatus, optedOut, languages, includeUnverified: INCLUDE_UNVERIFIED, only: ONLY,
  })
  const alreadySent = new Set(
    (
      await prisma.sportsDataCache.findMany({
        where: { cacheKey: { in: recipients.map((r) => ledgerKey(r.email)) } },
        select: { cacheKey: true },
      })
    ).map((r) => r.cacheKey),
  )
  const pending = recipients.filter((r) => !alreadySent.has(ledgerKey(r.email)))

  const en = buildHolidaySaleEmail({ kind: KIND, lang: 'en', baseUrl })
  const es = buildHolidaySaleEmail({ kind: KIND, lang: 'es', baseUrl })
  if (PREVIEW_OUT) {
    writeFileSync(PREVIEW_OUT, `SUBJECT: ${en.subject}\n\n${en.bodyText}\n\n${'='.repeat(72)}\n\nSUBJECT: ${es.subject}\n\n${es.bodyText}\n`)
  }

  console.log(JSON.stringify({
    mode: APPLY ? 'APPLY' : 'DRY RUN',
    kind: KIND,
    deliverAt: NOW ? 'now' : sendAt.toISOString(),
    baseUrl,
    accountsWithEmail: users.length,
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
    console.error(`\nREFUSING TO SEND — ${pending.length} recipients exceeds the ${MAX_RECIPIENTS} sanity cap (--max=<n> to raise it after a look).`)
    process.exitCode = 2
    return
  }

  let sent = 0, failed = 0, raced = 0
  for (const r of pending) {
    try {
      await prisma.sportsDataCache.create({
        data: { cacheKey: ledgerKey(r.email), expiresAt: new Date(Date.now() + LEDGER_TTL_MS), data: { claimedAt: new Date().toISOString(), lang: r.lang, deliverAt: NOW ? null : sendAt.toISOString() } },
      })
    } catch {
      raced++ // another run claimed it first
      continue
    }
    const msg = r.lang === 'es' ? es : en
    const res = await sendMarketingEmail({
      to: r.email,
      subject: msg.subject,
      bodyText: msg.bodyText,
      ...(NOW ? {} : { scheduledAt: sendAt.toISOString() }),
    })
    if (res.ok) {
      sent++
      console.log(`${NOW ? 'sent     ' : 'scheduled'} ${mask(r.email)} (${r.lang}) ${res.id ?? ''}`)
    } else {
      failed++
      await prisma.sportsDataCache.delete({ where: { cacheKey: ledgerKey(r.email) } }).catch(() => {})
      console.log(`FAILED    ${mask(r.email)} — ${scrub(String(res.error)).slice(0, 160)} (claim released, safe to retry)`)
    }
    await sleep(SEND_GAP_MS)
  }
  console.log(`\nDONE ${NOW ? 'sent' : 'scheduled'}=${sent} failed=${failed} skipped-already-claimed=${raced}`)
  if (failed) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error('FAILED', scrub(e instanceof Error ? e.message : String(e)))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
