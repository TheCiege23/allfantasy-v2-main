/**
 * Sends tournament moments through the app's single notification entry point
 * (`dispatchNotification` — in-app, push and email, behind every user preference,
 * quiet hours and category switch) and posts the league-chat line where the
 * moment's defaults say so.
 *
 * Failures are logged and swallowed: a notification must never undo a committed
 * seeding or round. Nothing here logs payload text, user ids or URLs.
 */
import 'server-only'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { momentById, skipChannelsFor, type MomentContext, type MomentId } from './moments'

export type MomentRecipient = { userId: string; ctx: MomentContext; href: string }

export async function sendMoment(tournamentId: string, momentId: MomentId, recipients: MomentRecipient[]): Promise<{ sent: number; failed: number }> {
  const moment = momentById(momentId)
  let sent = 0, failed = 0
  for (const r of recipients) {
    try {
      await dispatchNotification({
        userIds: [r.userId], category: moment.category, productType: 'app', type: `tournament_${moment.id}`,
        title: moment.title(r.ctx), body: moment.body(r.ctx), actionHref: r.href, actionLabel: 'Open',
        meta: { tournamentId, moment: moment.id }, dedupePrefix: `tournament:${tournamentId}:${moment.id}:${r.ctx.round ?? r.ctx.week ?? ''}`,
        skipChannels: skipChannelsFor(moment.id),
      })
      sent++
    } catch {
      failed++
    }
  }
  if (failed) console.warn(`[tournament/divisions] ${failed} ${moment.id} notification(s) failed`)
  return { sent, failed }
}

/** One league-chat line per app league, when the moment posts to chat and the league exists. */
export async function postMomentToLeagueChats(momentId: MomentId, posts: Array<{ leagueId: string; postedBy: string; ctx: MomentContext; key: string }>) {
  const moment = momentById(momentId)
  if (!moment.defaults.leagueChat || !moment.chat) return 0
  let posted = 0
  for (const p of posts) {
    try {
      const row = await createLeagueChatMessage(p.leagueId, p.postedBy, moment.chat(p.ctx), { type: 'system', idempotencyKey: `tmoment_${momentId}_${p.key}`.slice(0, 190), metadata: { moment: momentId } })
      if (row) posted++
    } catch {
      console.warn(`[tournament/divisions] league chat post failed for ${momentId}`)
    }
  }
  return posted
}
