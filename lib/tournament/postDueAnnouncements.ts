/**
 * Deliver tournament announcements whose scheduled time has passed.
 *
 * 🛑 THE HALF THAT MAKES "SCHEDULE" TRUE. A scheduled broadcast is stored as an
 * unposted `TournamentAnnouncement` with a `scheduledFor` — a row, not a timer.
 * This is what turns the row into a delivery, and until it runs on a schedule a
 * commissioner who schedules Tuesday's redraft notice gets nothing on Tuesday.
 *
 * ⚠ IT RE-RESOLVES THE AUDIENCE AT SEND TIME RATHER THAN REPLAYING A LIST.
 * A message scheduled on Sunday for Tuesday is aimed at a GROUP — "everyone
 * advancing", "the bubble" — and that group changes when Monday night's games
 * finish. Freezing the recipient list at compose time would send "you advanced"
 * to people who no longer have, which is the worst possible message to get
 * wrong.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { getTournamentStandingsBoard } from '@/lib/tournament/standingsBoard'
import { parseAudience, resolveAudience } from '@/lib/tournament/broadcastAudience'

export type SweepOutcome = {
  /** Announcements whose time had come. */
  due: number
  posted: number
  skipped: Array<{ announcementId: string; reason: string }>
  /** Distinct accounts notified across the whole sweep. */
  delivered: number
  dryRun: boolean
}

const DEFAULT_LIMIT = 50

export async function postDueTournamentAnnouncements(
  opts: { dryRun?: boolean; limit?: number; now?: Date } = {},
): Promise<SweepOutcome> {
  const now = opts.now ?? new Date()
  const dryRun = Boolean(opts.dryRun)

  const due = await prisma.tournamentAnnouncement.findMany({
    where: { isPosted: false, scheduledFor: { not: null, lte: now } },
    orderBy: { scheduledFor: 'asc' },
    take: opts.limit ?? DEFAULT_LIMIT,
    select: {
      id: true,
      tournamentId: true,
      title: true,
      content: true,
      targetAudience: true,
      tournament: { select: { commissionerId: true } },
    },
  })

  const outcome: SweepOutcome = {
    due: due.length,
    posted: 0,
    skipped: [],
    delivered: 0,
    dryRun,
  }

  for (const row of due) {
    const filter = parseAudience(row.targetAudience)
    if (!filter) {
      /*
       * ⚠ AN UNREADABLE AUDIENCE IS SKIPPED, NOT BROADENED. Falling back to
       * "everyone" would send a message written for eight eliminated managers to
       * the whole field — and a scheduled send has nobody watching when it fires.
       * It stays unposted so a human can look at it.
       */
      outcome.skipped.push({ announcementId: row.id, reason: 'unrecognised audience' })
      continue
    }

    const commissionerId = row.tournament?.commissionerId
    if (!commissionerId) {
      outcome.skipped.push({ announcementId: row.id, reason: 'tournament has no commissioner' })
      continue
    }

    /* Read as the commissioner — the board is owner-gated, and this sweep acts
       on their behalf rather than as an unscoped system reader. */
    const board = await getTournamentStandingsBoard(row.tournamentId, commissionerId)
    if (!board) {
      outcome.skipped.push({ announcementId: row.id, reason: 'tournament not readable' })
      continue
    }

    const audience = resolveAudience(board, filter)
    if (audience.members.length === 0) {
      /*
       * ⚠ NOT MARKED POSTED. An empty audience at send time usually means the
       * standings moved rather than that the message was pointless — leaving it
       * unposted lets a commissioner see it did not go and decide.
       */
      outcome.skipped.push({ announcementId: row.id, reason: 'audience is empty now' })
      continue
    }

    if (dryRun) {
      outcome.posted += 1
      outcome.delivered += audience.reachableUserIds.length
      continue
    }

    /*
     * ⚠ MARKED POSTED BEFORE DISPATCH, ON PURPOSE. `dispatchNotification` fans
     * out to email and push; if it throws after delivering to half the list, a
     * still-unposted row is picked up by the next sweep and those people are
     * messaged twice. A missed notification is recoverable — the announcement is
     * on record and the commissioner can resend. A duplicate "your season is
     * over" is not.
     */
    await prisma.tournamentAnnouncement.update({
      where: { id: row.id },
      data: { isPosted: true, postedAt: now },
    })
    outcome.posted += 1

    if (audience.reachableUserIds.length > 0) {
      outcome.delivered += audience.reachableUserIds.length
      await dispatchNotification({
        userIds: audience.reachableUserIds,
        category: 'commissioner_alerts',
        productType: 'app',
        type: 'commissioner_broadcast',
        title: row.title,
        body: row.content,
        actionHref: `/tournament-hub/${row.tournamentId}`,
        actionLabel: 'Open tournament',
        meta: { tournamentId: row.tournamentId, audience: row.targetAudience, scheduled: true },
        severity: 'medium',
      }).catch((e) => console.error('[tournament announcements] notify', e))
    }

    await prisma.tournamentAuditLog
      .create({
        data: {
          tournamentId: row.tournamentId,
          action: 'broadcast.posted_scheduled',
          actorType: 'system',
          targetType: 'announcement',
          targetId: row.id,
          data: {
            audience: row.targetAudience,
            selectedCount: audience.members.length,
            deliveredCount: audience.reachableUserIds.length,
            unreachableCount: audience.unreachable.length,
          },
        },
      })
      .catch(() => {})
  }

  return outcome
}
