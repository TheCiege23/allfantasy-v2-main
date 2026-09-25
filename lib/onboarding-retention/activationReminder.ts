import { isUndeliverableEmailDomain } from '@/lib/email/undeliverableDomains'
import { renderDigestEmail } from '@/lib/notifications/designedEmail'

/**
 * THE "CONNECT YOUR LEAGUE" REMINDER — email to people who signed up and never brought a team in
 * (owner's call 2026-09-25: "start on 1": get people connected).
 *
 * Measured that day: 77 of 110 users had no claimed team in a 2026 league; 75 had imported nothing.
 * Nothing had ever emailed them about it — no welcome, no drip, no reminder existed anywhere.
 *
 * ── 🛑 TWO, EVER ──────────────────────────────────────────────────────────────────────────────────
 * The first a day after signup, the second a week after the first, then never again. The second says
 * it is the last, because it is. A reminder that keeps coming is how a product teaches its users to
 * mark it as spam — which costs the lineup-check emails their inbox too.
 *
 * ── WHO ──────────────────────────────────────────────────────────────────────────────────────────
 * A VERIFIED email only: an unverified address may not be theirs, and the import refuses an
 * unverified account anyway (the in-app card handles "verify first"). Never the placeholder address a
 * Sleeper-login account is given (`<id>@sleeper.allfantasy.ai`), never a test domain, never anyone
 * who unsubscribed from product email. Every email carries an unsubscribe link.
 *
 * Pure: the runner (runActivationReminder.ts) reads and sends; this decides and renders.
 */

export const FIRST_REMINDER_AFTER_SIGNUP_MS = 24 * 60 * 60 * 1000
export const SECOND_REMINDER_AFTER_FIRST_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_ACTIVATION_REMINDERS = 2

/** Sleeper sign-in gives an account this placeholder; it is not a mailbox. */
const PLACEHOLDER_DOMAINS = ['sleeper.allfantasy.ai']

export function activationEmailEligible(email: string | null | undefined): email is string {
  if (typeof email !== 'string' || !email.includes('@')) return false
  const domain = email.trim().toLowerCase().split('@').pop() ?? ''
  if (PLACEHOLDER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false
  return !isUndeliverableEmailDomain(email)
}

/** Which reminder is due now, or null. `sent` maps reminder number → when it went. */
export function activationReminderDue(args: {
  createdAt: Date
  now: Date
  sent: Partial<Record<1 | 2, Date>>
}): 1 | 2 | null {
  const now = args.now.getTime()
  if (args.sent[2]) return null
  const first = args.sent[1]
  if (!first) return now - args.createdAt.getTime() >= FIRST_REMINDER_AFTER_SIGNUP_MS ? 1 : null
  return now - first.getTime() >= SECOND_REMINDER_AFTER_FIRST_MS ? 2 : null
}

/** `activation-reminder:v1:<userId>:<n>` — one row per reminder, created before the send. */
export function activationReminderKey(userId: string, n: 1 | 2): string {
  return `activation-reminder:v1:${userId}:${n}`
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export type ActivationReminderEmail = { subject: string; html: string }

export function renderActivationReminder(
  n: 1 | 2,
  opts: { baseUrl: string; unsubscribeUrl: string },
): ActivationReminderEmail {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const importHref = `${base}/import?from=activation_email_${n}`
  const li = (text: string) => `<li style="margin:0 0 8px 0">${esc(text)}</li>`
  const perks = [
    'Before kickoff, Chimmy checks your lineup: byes, injured starters, empty slots, and better starts sitting on your bench.',
    "Every Tuesday, the best pickup on your wire, with who to drop and what it's worth in points.",
    "Ask Chimmy anything about your team, scored under your league's own rules.",
  ]
  const body = `<ul style="margin:0 0 16px 0;padding-left:18px;color:#d4d4d8">${perks.map(li).join('')}</ul>
<div style="margin:0 0 4px 0;color:#a1a1aa">Sleeper, ESPN, Fantrax, MFL and Fleaflicker. Read-only: nothing changes on your platform.</div>
<div style="margin:22px 0 0 0;padding-top:12px;border-top:1px solid #27272a;color:#71717a;font-size:12px">${
    n === 2 ? "This is the last reminder we'll send about it. " : ''
  }You're getting this because you signed up for AllFantasy. <a href="${esc(opts.unsubscribeUrl)}" style="color:#a1a1aa;text-decoration:underline">Unsubscribe</a></div>`

  const copy =
    n === 1
      ? {
          subject: "Chimmy can't see your team yet",
          title: 'Connect your league. It takes about a minute.',
          sub: "You're signed up, but there's no team on your account yet, and your team is the one thing Chimmy needs.",
        }
      : {
          subject: 'Still want Chimmy on your lineup?',
          title: 'One minute, and Chimmy starts checking your lineup',
          sub: "Connect the league you play in and your first lineup check lands before this week's kickoff.",
        }

  const html = renderDigestEmail({
    eyebrow: 'AllFantasy · Getting started',
    title: copy.title,
    sub: copy.sub,
    bodyHtml: body,
    cta: { href: importHref, label: 'Connect your league' },
    baseUrl: base,
  })
  return { subject: copy.subject, html }
}
