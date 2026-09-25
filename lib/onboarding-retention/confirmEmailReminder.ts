import { EMAIL_VERIFY_LINK_LIFETIME } from '@/lib/auth/emailVerifyLink'
import { renderDigestEmail } from '@/lib/notifications/designedEmail'

/**
 * THE "CONFIRM YOUR EMAIL" REMINDER — for people who signed up and never confirmed their address
 * (owner's call 2026-09-25: "start on 1": get stuck sign-ups confirmed).
 *
 * Measured that day: 44 of 110 accounts had never confirmed, and a confirmed address is the door to
 * everything else. The league import refuses an unconfirmed account, and the "connect your league"
 * reminder (activationReminder.ts) only writes to confirmed addresses, so nothing reached these 44.
 * Their links had expired an hour after sending (see lib/auth/emailVerifyLink.ts), and nothing ever
 * followed up.
 *
 * ── 🛑 TWO, EVER ──────────────────────────────────────────────────────────────────────────────────
 * The first a day after signup, the second four days after the first, then never again. The second
 * says it is the last. Each carries a FRESH link (7 days), so the reminder always works when opened.
 *
 * ── WHO ──────────────────────────────────────────────────────────────────────────────────────────
 * Unconfirmed accounts that signed up in the last 60 days. An address nobody has confirmed may be
 * mistyped or not theirs, and every bounce costs the sender reputation the lineup checks ride on, so
 * the sequence is short and does not reach back to spring sign-ups. The second reminder still goes
 * to anyone who got the first. Never a Sleeper placeholder or test domain, never anyone who
 * unsubscribed, and every email says what to do if it wasn't you.
 *
 * Once someone confirms, they leave this sequence and the connect-your-league one takes over.
 *
 * Pure: the runner (runConfirmEmailReminder.ts) reads and sends; this decides and renders.
 */

export const CONFIRM_FIRST_AFTER_SIGNUP_MS = 24 * 60 * 60 * 1000
export const CONFIRM_SECOND_AFTER_FIRST_MS = 4 * 24 * 60 * 60 * 1000
/** Only sign-ups this recent START the sequence. */
export const CONFIRM_MAX_SIGNUP_AGE_MS = 60 * 24 * 60 * 60 * 1000

/** Which reminder is due now, or null. `sent` maps reminder number → when it went. */
export function confirmEmailReminderDue(args: {
  createdAt: Date
  now: Date
  sent: Partial<Record<1 | 2, Date>>
}): 1 | 2 | null {
  const now = args.now.getTime()
  if (args.sent[2]) return null
  const first = args.sent[1]
  if (!first) {
    const age = now - args.createdAt.getTime()
    return age >= CONFIRM_FIRST_AFTER_SIGNUP_MS && age <= CONFIRM_MAX_SIGNUP_AGE_MS ? 1 : null
  }
  return now - first.getTime() >= CONFIRM_SECOND_AFTER_FIRST_MS ? 2 : null
}

/** `confirm-email-reminder:v1:<userId>:<n>` — one row per reminder, created before the send. */
export function confirmEmailReminderKey(userId: string, n: 1 | 2): string {
  return `confirm-email-reminder:v1:${userId}:${n}`
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export type ConfirmEmailReminderEmail = { subject: string; html: string }

export function renderConfirmEmailReminder(
  n: 1 | 2,
  opts: { verifyUrl: string; baseUrl: string; unsubscribeUrl: string },
): ConfirmEmailReminderEmail {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const li = (text: string) => `<li style="margin:0 0 8px 0">${esc(text)}</li>`
  const next = [
    'Connect your league in about a minute: Sleeper, ESPN, Fantrax, MFL or Fleaflicker. Read-only, so nothing changes on your platform.',
    'Before kickoff, Chimmy checks your lineup for byes, injured starters and better starts sitting on your bench.',
    'Every Tuesday, Chimmy names the best pickup on your wire.',
  ]
  const body = `<div style="margin:0 0 10px 0;color:#d4d4d8">Once you confirm:</div>
<ul style="margin:0 0 16px 0;padding-left:18px;color:#d4d4d8">${next.map(li).join('')}</ul>
<div style="margin:0 0 4px 0;color:#a1a1aa">This link works for ${esc(EMAIL_VERIFY_LINK_LIFETIME)}.</div>
<div style="margin:22px 0 0 0;padding-top:12px;border-top:1px solid #27272a;color:#71717a;font-size:12px">${
    n === 2 ? "This is the last reminder we'll send about it. " : ''
  }You're getting this because this address was used to sign up for AllFantasy. Not you? Ignore this email and nothing happens. <a href="${esc(opts.unsubscribeUrl)}" style="color:#a1a1aa;text-decoration:underline">Unsubscribe</a></div>`

  const copy =
    n === 1
      ? {
          subject: "Confirm your email and you're in",
          title: 'One tap to finish signing up',
          sub: "You started an AllFantasy account, but your email isn't confirmed yet. Until it is, you can't bring your league in.",
        }
      : {
          subject: 'Your AllFantasy account is still waiting',
          title: 'Still want in? Confirm your email',
          sub: 'One tap confirms this address is yours. Then connect your league and Chimmy gets to work on your lineup.',
        }

  const html = renderDigestEmail({
    eyebrow: 'AllFantasy · Getting started',
    title: copy.title,
    sub: copy.sub,
    bodyHtml: body,
    cta: { href: opts.verifyUrl, label: 'Confirm my email' },
    baseUrl: base,
  })
  return { subject: copy.subject, html }
}
