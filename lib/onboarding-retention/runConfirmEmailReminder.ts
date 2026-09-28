import 'server-only'

import { emailVerifyLinkExpiresAt } from '@/lib/auth/emailVerifyLink'
import { USER_FACING_SITE_ORIGIN } from '@/lib/auth/user-facing-site-origin'
import { prisma } from '@/lib/prisma'
import { getDeploymentLinkOrigin } from '@/lib/site-public-origin'
import { makeToken, sha256Hex } from '@/lib/tokens'
import { activationEmailEligible } from './activationReminder'
import {
  CONFIRM_FIRST_AFTER_SIGNUP_MS,
  CONFIRM_MAX_SIGNUP_AGE_MS,
  CONFIRM_SECOND_AFTER_FIRST_MS,
  confirmEmailReminderDue,
  confirmEmailReminderKey,
  renderConfirmEmailReminder,
} from './confirmEmailReminder'
import { activationReminderDeps, type ActivationCandidate, type ActivationReminderRun } from './runActivationReminder'

/**
 * Sends the "confirm your email" reminders (see confirmEmailReminder.ts for the rules). Rides the
 * daily morning-briefing cron beside the connect-your-league reminder, under the same opt-in:
 * nothing is sent until the deployment sets ACTIVATION_REMINDER_ENABLED=1.
 *
 * At most once per reminder: the reminder's row is CREATED by primary key before the send, so a
 * second replica or a retried cron fails the create and sends nothing. A send that fails after the
 * claim is not retried, and the link it would have carried is deleted, never left usable unsent.
 */

export interface ConfirmEmailReminderDeps {
  now: () => Date
  /** Unconfirmed accounts created in [after, before]. */
  loadCandidates: (after: Date, before: Date) => Promise<ActivationCandidate[]>
  /** When each reminder went, per user. */
  loadSent: (userIds: string[]) => Promise<Map<string, Partial<Record<1 | 2, Date>>>>
  /** Emails that unsubscribed from product email. Lowercased. */
  loadOptedOut: (emails: string[]) => Promise<Set<string>>
  claim: (key: string, sentAt: Date) => Promise<boolean>
  /** A fresh confirmation link for this account. `discard` deletes it if the email never went. */
  issueLink: (userId: string, now: Date) => Promise<{ url: string; discard: () => Promise<void> }>
  send: (args: { to: string; subject: string; html: string }) => Promise<{ ok: boolean; error?: string }>
  baseUrl: () => string
  unsubscribeUrl: (email: string) => string
}

export type ConfirmEmailReminderRun = ActivationReminderRun

/** Sign-ups old enough to be due the SECOND reminder after starting at the edge of the window. */
const LOOKBACK_MS = CONFIRM_MAX_SIGNUP_AGE_MS + CONFIRM_SECOND_AFTER_FIRST_MS + 30 * 24 * 60 * 60 * 1000

export const confirmEmailReminderDeps: ConfirmEmailReminderDeps = {
  now: () => new Date(),
  loadCandidates: async (after, before) => {
    const users = await prisma.appUser.findMany({
      where: { emailVerified: null, createdAt: { gte: after, lte: before } },
      select: { id: true, email: true, createdAt: true },
    })
    return users
      .filter((u) => typeof u.email === 'string' && u.email.length > 0)
      .map((u) => ({ userId: u.id, email: u.email, createdAt: u.createdAt }))
  },
  loadSent: async (userIds) => {
    const keys = userIds.flatMap((id) => [confirmEmailReminderKey(id, 1), confirmEmailReminderKey(id, 2)])
    const out = new Map<string, Partial<Record<1 | 2, Date>>>()
    if (keys.length === 0) return out
    const rows = await prisma.sportsDataCache.findMany({ where: { cacheKey: { in: keys } }, select: { cacheKey: true, data: true } })
    for (const r of rows) {
      const m = /^confirm-email-reminder:v1:(.+):([12])$/.exec(r.cacheKey)
      if (!m) continue
      const at = new Date(String((r.data as { sentAt?: unknown } | null)?.sentAt ?? ''))
      const entry = out.get(m[1]!) ?? {}
      // A row whose timestamp cannot be read still counts as sent — never send twice on a bad read.
      entry[Number(m[2]) as 1 | 2] = Number.isFinite(at.getTime()) ? at : new Date(0)
      out.set(m[1]!, entry)
    }
    return out
  },
  loadOptedOut: activationReminderDeps.loadOptedOut,
  claim: activationReminderDeps.claim,
  issueLink: async (userId, now) => {
    const rawToken = makeToken(32)
    const row = await prisma.emailVerifyToken.create({
      data: { userId, tokenHash: sha256Hex(rawToken), expiresAt: emailVerifyLinkExpiresAt(now.getTime()) },
      select: { id: true },
    })
    // Same origin rule as the sign-up email: the configured canonical site, never a request header.
    const origin = getDeploymentLinkOrigin() || USER_FACING_SITE_ORIGIN
    // /onboarding, like the sign-up email: these accounts still hold an auto-generated username,
    // and /onboarding bounces a finished profile onward.
    const url = `${origin}/verify/email?token=${encodeURIComponent(rawToken)}&returnTo=${encodeURIComponent('/onboarding')}`
    return {
      url,
      discard: async () => {
        await prisma.emailVerifyToken.delete({ where: { id: row.id } }).catch(() => {})
      },
    }
  },
  send: activationReminderDeps.send,
  baseUrl: activationReminderDeps.baseUrl,
  unsubscribeUrl: activationReminderDeps.unsubscribeUrl,
}

export async function runConfirmEmailReminder(
  opts: { dryRun?: boolean; limit?: number; budgetMs?: number } = {},
  overrides: Partial<ConfirmEmailReminderDeps> = {},
): Promise<ConfirmEmailReminderRun> {
  const deps: ConfirmEmailReminderDeps = { ...confirmEmailReminderDeps, ...overrides }
  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? 45_000
  const limit = opts.limit ?? 50
  const dryRun = Boolean(opts.dryRun)
  const now = deps.now()

  const run: ConfirmEmailReminderRun = {
    dryRun,
    candidates: 0,
    sent: 0,
    due: { first: 0, second: 0 },
    skipped: { ineligibleEmail: 0, optedOut: 0, notDue: 0, alreadyClaimed: 0 },
    failed: 0,
    notReached: 0,
    errors: [],
  }

  const candidates = await deps.loadCandidates(
    new Date(now.getTime() - LOOKBACK_MS),
    new Date(now.getTime() - CONFIRM_FIRST_AFTER_SIGNUP_MS),
  )
  run.candidates = candidates.length
  const eligible = candidates.filter((c) => {
    if (activationEmailEligible(c.email)) return true
    run.skipped.ineligibleEmail += 1
    return false
  })
  const [sentMap, optedOut] = await Promise.all([
    deps.loadSent(eligible.map((c) => c.userId)),
    deps.loadOptedOut(eligible.map((c) => c.email)),
  ])

  const queue: Array<{ c: ActivationCandidate; n: 1 | 2 }> = []
  for (const c of eligible) {
    if (optedOut.has(c.email.toLowerCase())) {
      run.skipped.optedOut += 1
      continue
    }
    const n = confirmEmailReminderDue({ createdAt: c.createdAt, now, sent: sentMap.get(c.userId) ?? {} })
    if (!n) {
      run.skipped.notDue += 1
      continue
    }
    queue.push({ c, n })
  }
  // Newest signups first: they are the likeliest to still want in.
  queue.sort((a, b) => b.c.createdAt.getTime() - a.c.createdAt.getTime())

  for (const [i, { c, n }] of queue.entries()) {
    if (i >= limit || Date.now() - startedAt >= budgetMs) {
      run.notReached = queue.length - i
      break
    }
    if (n === 1) run.due.first += 1
    else run.due.second += 1
    if (dryRun) continue
    let link: { url: string; discard: () => Promise<void> } | null = null
    try {
      if (!(await deps.claim(confirmEmailReminderKey(c.userId, n), now))) {
        run.skipped.alreadyClaimed += 1
        continue
      }
      link = await deps.issueLink(c.userId, now)
      const email = renderConfirmEmailReminder(n, {
        verifyUrl: link.url,
        baseUrl: deps.baseUrl(),
        unsubscribeUrl: deps.unsubscribeUrl(c.email),
      })
      const res = await deps.send({ to: c.email, subject: email.subject, html: email.html })
      if (res.ok) run.sent += 1
      else {
        await link.discard()
        run.failed += 1
        // The provider's message, never the address.
        run.errors.push(`${c.userId}: ${(res.error ?? 'send failed').slice(0, 120)}`)
      }
    } catch (e) {
      // Same rule as the sign-up route: a link whose email did not go out is not left usable.
      if (link) await link.discard().catch(() => {})
      run.failed += 1
      run.errors.push(`${c.userId}: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`)
    }
  }
  run.errors = run.errors.slice(0, 10)
  return run
}
