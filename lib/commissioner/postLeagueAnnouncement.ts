import { prisma } from '@/lib/prisma'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { getLeagueChatThreadId } from '@/lib/commissioner-settings/CommissionerAnnouncementService'
import { createSystemMessage } from '@/lib/platform/chat-service'
import { getLeagueMemberAppUserIds } from '@/lib/draft-notifications/DraftNotificationService'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { isLeaguePrefEnabled, parseLeagueNotificationPrefs } from '@/lib/league/league-notification-prefs'

/**
 * Post one commissioner @everyone announcement to one league and notify its members — the send
 * itself, shared by `POST /api/commissioner/broadcast` (send now) and the scheduled-announcement
 * sweep (./scheduledAnnouncementService), so a scheduled post is exactly what pressing Send would
 * have done. Permission is the CALLER's job: `broadcastRefusal` (./broadcastAccess) first, always.
 *
 * Returns whether the chat post was written. Notifications are fire-and-forget, as before.
 */
export async function postLeagueAnnouncement(leagueId: string, userId: string, message: string): Promise<boolean> {
  const text = `@everyone ${message}`
  const threadId = await getLeagueChatThreadId(leagueId)
  let sent: boolean
  if (threadId && !threadId.startsWith('league:')) {
    sent = !!(await createSystemMessage(threadId, 'broadcast', text))
  } else {
    sent = !!(await createLeagueChatMessage(leagueId, userId, text, { type: 'broadcast' }))
  }
  const memberIds = await getLeagueMemberAppUserIds(leagueId)
  const leagueRow = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, leagueVariant: true },
  })
  if (sent && leagueRow?.leagueVariant === 'survivor') {
    await prisma.survivorCommissionerAction.create({
      data: {
        leagueId,
        commissionerId: userId,
        actionType: 'league_announcement',
        description: 'Universal league announcement sent',
        newState: { characterCount: message.length },
      },
    })
  }
  const prefs = parseLeagueNotificationPrefs(leagueRow?.settings)
  if (memberIds.length > 0 && isLeaguePrefEnabled(prefs, 'commissionerBroadcasts')) {
    dispatchNotification({
      userIds: memberIds,
      category: 'commissioner_alerts',
      productType: 'app',
      type: 'commissioner_broadcast',
      title: 'Commissioner announcement',
      body: message,
      // The text says THAT there is a message; the words stay in-app (no user-written text over SMS).
      smsBody: 'New commissioner announcement in your league. Open AllFantasy to read it.',
      actionHref: `/league/${leagueId}`,
      actionLabel: 'Open league',
      meta: { leagueId },
      severity: 'medium',
    }).catch((e) => console.error('[commissioner broadcast] notify', e))
  }
  return sent
}
