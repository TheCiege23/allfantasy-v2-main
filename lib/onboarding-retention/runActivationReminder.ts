import 'server-only'

import type { Prisma } from '@prisma/client'

import { currentFantasySeason } from '@/lib/core-app/connectLeague'
import { createEmailUnsubscribeToken } from '@/lib/email/marketing-email'
import { getBaseUrl } from '@/lib/get-base-url'
import { prisma } from '@/lib/prisma'
import { sendTemplatedEmail } from '@/lib/resend-client'
import {
  activationEmailEligible,
  activationReminderDue,
  activationReminderKey,
  renderActivationReminder,
} from './activationReminder'

/**
 * Sends the "connect your league" reminders (see activationReminder.ts for the rules). Rides the
 * daily morning-briefing cron — the cron registry is at its ceiling, and this is a daily job — and,
 * like the briefing, only runs when the deployment opts in: ACTIVATION_REMINDER_ENABLED=1.
 *
 * At most once per reminder: the reminder's row is CREATED by primary key before the send, so a
 * second replica or a retried cron fails the create and sends nothing. A send that fails after the
 * claim is not retried — a missed reminder costs less than a doubled one.
 */

export type ActivationCandidate = { userId: string; email: string; createdAt: Date }

export interface ActivationReminderDeps {
  now: () => Date
  /** Email-verified users with no claimed team in the current season, signed up before `before`. */
  loadCandidates: (season: number, before: Date) => Promise<ActivationCandidate[]>
  /** When each reminder went, per user. */
  loadSent: (userIds: string[]) => Promise<Map<string, Partial<Record<1 | 2, Date>>>>
  /** Emails that unsubscribed from product email. Lowercased. */
  loadOptedOut: (emails: string[]) => Promise<Set<string>>
  claim: (key: string, sentAt: Date) => Promise<boolean>
  send: (args: { to: string; subject: string; html: string }) => Promise<{ ok: boolean; error?: string }>
  baseUrl: () => string
  unsubscribeUrl: (email: string) => string
}

export type ActivationReminderRun = {
  dryRun: boolean
  candidates: number
  sent: number
  due: { first: number; second: number }
  skipped: { ineligibleEmail: number; optedOut: number; notDue: number; alreadyClaimed: number }
  failed: number
  notReached: number
  errors: string[]
}

const CLAIM_TTL_MS = 400 * 24 * 60 * 60 * 1000

function prismaCode(e: unknown): string | null {
  return e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : null
}

export const activationReminderDeps: ActivationReminderDeps = {
  now: () => new Date(),
  loadCandidates: async (season, before) => {
    const users = await prisma.appUser.findMany({
      where: { emailVerified: { not: null }, createdAt: { lte: before } },
      select: { id: true, email: true, createdAt: true },
    })
    if (users.length === 0) return []
    const claimed = await prisma.leagueTeam.findMany({
      where: { claimedByUserId: { in: users.map((u) => u.id) }, league: { season: { gte: season } } },
      select: { claimedByUserId: true },
      distinct: ['claimedByUserId'],
    })
    const hasTeam = new Set(claimed.map((c) => c.claimedByUserId))
    return users
      .filter((u) => !hasTeam.has(u.id) && typeof u.email === 'string')
      .map((u) => ({ userId: u.id, email: u.email as string, createdAt: u.createdAt }))
  },
  loadSent: async (userIds) => {
    const keys = userIds.flatMap((id) => [activationReminderKey(id, 1), activationReminderKey(id, 2)])
    const out = new Map<string, Partial<Record<1 | 2, Date>>>()
    if (keys.length === 0) return out
    const rows = await prisma.sportsDataCache.findMany({ where: { cacheKey: { in: keys } }, select: { cacheKey: true, data: true } })
    for (const r of rows) {
      const m = /^activation-reminder:v1:(.+):([12])$/.exec(r.cacheKey)
      if (!m) continue
      const at = new Date(String((r.data as { sentAt?: unknown } | null)?.sentAt ?? ''))
      const entry = out.get(m[1]!) ?? {}
      // A row whose timestamp cannot be read still counts as sent — never send twice on a bad read.
      entry[Number(m[2]) as 1 | 2] = Number.isFinite(at.getTime()) ? at : new Date(0)
      out.set(m[1]!, entry)
    }
    return out
  },
  loadOptedOut: async (emails) => {
    if (emails.length === 0) return new Set()
    // Case-insensitive per address: preference rows come from several writers, not all of which lowercase.
    const rows = await prisma.emailPreference.findMany({
      where: {
        AND: [
          { OR: emails.map((e) => ({ email: { equals: e, mode: 'insensitive' as const } })) },
          { OR: [{ unsubscribedAt: { not: null } }, { productUpdates: false }] },
        ],
      },
      select: { email: true },
    })
    return new Set(rows.map((r) => r.email.toLowerCase()))
  },
  claim: async (key, sentAt) => {
    try {
      await prisma.sportsDataCache.create({
        data: {
          cacheKey: key,
          expiresAt: new Date(sentAt.getTime() + CLAIM_TTL_MS),
          data: { sentAt: sentAt.toISOString() } as Prisma.InputJsonValue,
        },
      })
      return true
    } catch (e) {
      if (prismaCode(e) === 'P2002') return false
      throw e
    }
  },
  send: sendTemplatedEmail,
  baseUrl: getBaseUrl,
  unsubscribeUrl: (email) => `${getBaseUrl()}/api/email/unsubscribe?token=${encodeURIComponent(createEmailUnsubscribeToken(email))}`,
}

export async function runActivationReminder(
  opts: { dryRun?: boolean; limit?: number; budgetMs?: number } = {},
  overrides: Partial<ActivationReminderDeps> = {},
): Promise<ActivationReminderRun> {
  const deps: ActivationReminderDeps = { ...activationReminderDeps, ...overrides }
  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? 60_000
  const limit = opts.limit ?? 50
  const dryRun = Boolean(opts.dryRun)
  const now = deps.now()

  const run: ActivationReminderRun = {
    dryRun,
    candidates: 0,
    sent: 0,
    due: { first: 0, second: 0 },
    skipped: { ineligibleEmail: 0, optedOut: 0, notDue: 0, alreadyClaimed: 0 },
    failed: 0,
    notReached: 0,
    errors: [],
  }

  const candidates = await deps.loadCandidates(currentFantasySeason(now), new Date(now.getTime() - 60 * 60 * 1000))
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
    const n = activationReminderDue({ createdAt: c.createdAt, now, sent: sentMap.get(c.userId) ?? {} })
    if (!n) {
      run.skipped.notDue += 1
      continue
    }
    queue.push({ c, n })
  }
  // Oldest signups first: they have waited longest.
  queue.sort((a, b) => a.c.createdAt.getTime() - b.c.createdAt.getTime())

  for (const [i, { c, n }] of queue.entries()) {
    if (i >= limit || Date.now() - startedAt >= budgetMs) {
      run.notReached = queue.length - i
      break
    }
    if (n === 1) run.due.first += 1
    else run.due.second += 1
    if (dryRun) continue
    try {
      if (!(await deps.claim(activationReminderKey(c.userId, n), now))) {
        run.skipped.alreadyClaimed += 1
        continue
      }
      const email = renderActivationReminder(n, { baseUrl: deps.baseUrl(), unsubscribeUrl: deps.unsubscribeUrl(c.email) })
      const res = await deps.send({ to: c.email, subject: email.subject, html: email.html })
      if (res.ok) run.sent += 1
      else {
        run.failed += 1
        // The provider's message, never the address.
        run.errors.push(`${c.userId}: ${(res.error ?? 'send failed').slice(0, 120)}`)
      }
    } catch (e) {
      run.failed += 1
      run.errors.push(`${c.userId}: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`)
    }
  }
  run.errors = run.errors.slice(0, 10)
  return run
}
