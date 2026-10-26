/**
 * Commissioner alerts: the only time the system contacts the commissioner is when it cannot carry
 * on by itself. Everything else runs unattended.
 *
 * Each alert is one `SurvivorNotification` addressed to the league owner with `recipientRole:
 * 'commissioner'`, which the dispatcher files under their Commissioner alerts preferences (in-app,
 * email, push). An alert is sent ONCE per (league, kind, dedupe key): the dedupe is an audit row,
 * so it survives retries, restarts and a rolled-back tick. Nothing here names a ballot, an idol
 * holder or a tally — the copy is always spoiler-safe.
 */

import type { Prisma, PrismaClient } from '@prisma/client'

import { prisma as defaultPrisma } from '@/lib/prisma'

export type SurvivorCommissionerAlertKind =
  | 'automation_error'
  | 'scores_overdue'
  | 'seats_unclaimed_before_draft'
  | 'tie_unresolved'
  | 'jury_overdue'
  | 'exile_setup_failed'
  | 'tribes_rebalanced'

export const SURVIVOR_COMMISSIONER_ALERT_AUDIT_ACTION = 'commissioner_alert_sent'

export type SurvivorCommissionerAlertInput = {
  /** Same kind + key never sends twice (a week number, a council id, a deadline, a date). */
  dedupeKey: string
  title: string
  body: string
  deepLinkPath?: string
  urgency?: 'critical' | 'high' | 'medium'
  week?: number | null
}

export type SurvivorCommissionerAlertOutcome = { sent: true; notificationId: string } | { sent: false; reason: 'duplicate' | 'no_commissioner' }

type Db = Prisma.TransactionClient | PrismaClient

export function survivorCommissionerAlertKey(kind: SurvivorCommissionerAlertKind, dedupeKey: string): string {
  return `${kind}:${dedupeKey}`
}

export async function notifySurvivorCommissionerOnce(
  leagueId: string,
  kind: SurvivorCommissionerAlertKind,
  input: SurvivorCommissionerAlertInput,
  db: Db = defaultPrisma,
): Promise<SurvivorCommissionerAlertOutcome> {
  const key = survivorCommissionerAlertKey(kind, input.dedupeKey)
  const already = await db.survivorAuditEntry.findFirst({
    where: { leagueId, action: SURVIVOR_COMMISSIONER_ALERT_AUDIT_ACTION, relatedEntityId: key },
    select: { id: true },
  })
  if (already) return { sent: false, reason: 'duplicate' }
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { userId: true } })
  if (!league?.userId) return { sent: false, reason: 'no_commissioner' }
  const row = await db.survivorNotification.create({
    data: {
      leagueId,
      type: `commissioner_${kind}`,
      recipientUserId: league.userId,
      recipientRole: 'commissioner',
      title: input.title,
      body: input.body,
      deepLinkPath: input.deepLinkPath ?? `/league/${leagueId}?guide=settings`,
      urgency: input.urgency ?? 'high',
      isSpoilerSafe: true,
      scheduledFor: new Date(),
      status: 'pending',
    },
    select: { id: true },
  })
  await db.survivorAuditEntry.create({
    data: {
      leagueId,
      week: input.week ?? null,
      category: 'commissioner',
      action: SURVIVOR_COMMISSIONER_ALERT_AUDIT_ACTION,
      relatedEntityId: key,
      relatedEntityType: 'commissioner_alert',
      data: { kind, dedupeKey: input.dedupeKey, notificationId: row.id, title: input.title },
      isVisibleToCommissioner: true,
      isVisibleToPublic: false,
    },
  })
  return { sent: true, notificationId: row.id }
}

/** Scores are overdue once the week's window has closed by this much and nothing is final yet. */
export const SURVIVOR_SCORES_OVERDUE_MS = 6 * 60 * 60 * 1000
/** A jury that has not produced a winner this long after its deadline needs a human. */
export const SURVIVOR_JURY_OVERDUE_MS = 24 * 60 * 60 * 1000
/** Unclaimed seats are flagged this long before a scheduled draft. */
export const SURVIVOR_SEATS_ALERT_LEAD_MS = 24 * 60 * 60 * 1000
