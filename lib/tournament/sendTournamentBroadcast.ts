/**
 * Send one message to a slice of a tournament.
 *
 * 🛑 IT REPORTS WHAT IT COULD NOT DO. `/api/commissioner/broadcast` fans out per
 * league and answers `{ ok: true }`; that is fine when every member has an
 * account, and misleading here, where most of a 240-manager imported field does
 * not. This returns the delivered count AND the paste blocks for everyone else,
 * so "sent" never overstates its reach.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { getTournamentStandingsBoard } from '@/lib/tournament/standingsBoard'
import {
  buildPasteBlocks,
  describeAudience,
  resolveAudience,
  serializeAudience,
  type AudienceFilter,
} from '@/lib/tournament/broadcastAudience'

/** Long enough for a redraft brief; short enough to survive a chat paste. */
export const MAX_BROADCAST_LENGTH = 1500

export type BroadcastResult =
  | {
      ok: true
      announcementId: string
      audience: string
      audienceLabel: string
      selectedCount: number
      /** Distinct AllFantasy accounts a notification was dispatched to. */
      deliveredCount: number
      /** Managers with no account — the commissioner posts to these by hand. */
      unreachableCount: number
      pasteBlocks: Array<{ leagueName: string; text: string; handleCount: number }>
      scheduledFor: string | null
    }
  | { ok: false; error: string; status: 400 | 404 }

export async function sendTournamentBroadcast(args: {
  tournamentId: string
  commissionerUserId: string
  filter: AudienceFilter
  title: string
  message: string
  /** When set and in the future, the announcement is stored unposted. */
  scheduledFor?: Date | null
}): Promise<BroadcastResult> {
  const message = args.message?.trim() ?? ''
  const title = args.title?.trim() || 'Tournament update'
  if (!message) return { ok: false, error: 'The message is empty.', status: 400 }
  if (message.length > MAX_BROADCAST_LENGTH) {
    return {
      ok: false,
      error: `Keep it under ${MAX_BROADCAST_LENGTH} characters.`,
      status: 400,
    }
  }

  /* Owner-gated inside, and returns null for both "not found" and "not yours". */
  const board = await getTournamentStandingsBoard(args.tournamentId, args.commissionerUserId)
  if (!board) return { ok: false, error: 'Tournament not found', status: 404 }

  const audience = resolveAudience(board, args.filter)
  if (audience.members.length === 0) {
    /*
     * ⚠ AN EMPTY AUDIENCE IS REFUSED RATHER THAN "SENT TO 0". A commissioner who
     * picks the wrong conference and is told the send succeeded will not send it
     * again, and nobody ever gets the message.
     */
    return { ok: false, error: 'That selection matches nobody right now.', status: 400 }
  }

  const audienceKey = serializeAudience(args.filter)
  const audienceLabel = describeAudience(board, args.filter)
  const pasteBlocks = buildPasteBlocks(message, audience.unreachable)

  /*
   * ⚠ SCHEDULING IS A STORED ROW, NOT A TIMER. Nothing here holds a message in
   * memory until Tuesday — a scheduled announcement is written unposted with its
   * time, and `/api/cron/tournament-announcements` sweeps due rows hourly
   * (declared in `cron-schedule.json`, fired from the slow-tier workflow).
   * The caller is still told `scheduledFor` so a screen can state the cadence
   * rather than implying the message goes out on the minute.
   */
  const scheduled = args.scheduledFor && args.scheduledFor.getTime() > Date.now()
    ? args.scheduledFor
    : null

  const announcement = await prisma.tournamentAnnouncement.create({
    data: {
      tournamentId: args.tournamentId,
      roundNumber: board.roundNumber || null,
      conferenceId: args.filter.kind === 'conference' ? args.filter.conferenceId : null,
      type: 'commissioner_broadcast',
      title,
      content: message,
      targetAudience: audienceKey,
      isPosted: scheduled == null,
      postedAt: scheduled == null ? new Date() : null,
      scheduledFor: scheduled,
    },
    select: { id: true },
  })

  if (scheduled == null && audience.reachableUserIds.length > 0) {
    /*
     * ⚠ NOT AWAITED, AND THE SEND IS NOT CONDITIONAL ON IT. A notification
     * channel being slow or down must not fail the whole broadcast — the
     * announcement is recorded and the paste blocks are still the commissioner's
     * fallback either way.
     */
    dispatchNotification({
      userIds: audience.reachableUserIds,
      category: 'commissioner_alerts',
      productType: 'app',
      type: 'commissioner_broadcast',
      title,
      body: message,
      actionHref: `/tournament-hub/${args.tournamentId}`,
      actionLabel: 'Open tournament',
      meta: { tournamentId: args.tournamentId, audience: audienceKey },
      severity: 'medium',
    }).catch((e) => console.error('[tournament broadcast] notify', e))
  }

  await prisma.tournamentAuditLog
    .create({
      data: {
        tournamentId: args.tournamentId,
        roundNumber: board.roundNumber || null,
        action: scheduled ? 'broadcast.scheduled' : 'broadcast.sent',
        actorType: 'commissioner',
        actorId: args.commissionerUserId,
        targetType: 'announcement',
        targetId: announcement.id,
        data: {
          audience: audienceKey,
          selectedCount: audience.members.length,
          deliveredCount: audience.reachableUserIds.length,
          unreachableCount: audience.unreachable.length,
          scheduledFor: scheduled?.toISOString() ?? null,
        },
      },
    })
    .catch(() => {})

  return {
    ok: true,
    announcementId: announcement.id,
    audience: audienceKey,
    audienceLabel,
    selectedCount: audience.members.length,
    deliveredCount: scheduled == null ? audience.reachableUserIds.length : 0,
    unreachableCount: audience.unreachable.length,
    pasteBlocks,
    scheduledFor: scheduled?.toISOString() ?? null,
  }
}
