import 'server-only'

import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { resolveNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import type { NotificationPreferences } from '@/lib/notification-settings/types'
import { getLeagueMemberUserIds } from '@/lib/league-chat/leagueMemberIds'
import { createEmailUnsubscribeToken } from '@/lib/email/marketing-email'
import { getBaseUrl } from '@/lib/get-base-url'
import { buildMessagePreview } from './messagePreview'
import { buildDirectMessageEmail } from './directMessageEmail'
import { decideChatAlert, nextChatAlertState, type ChatAlertDecision } from './alertThrottle'
import {
  chatAlertStateKey,
  claimChatAlertState,
  readStoredChatAlertState,
  type StoredChatAlertState,
} from './alertStateStore'
import { safeDisplayName } from './displayName'

/**
 * "You got a message" — bell, push, email and (once Twilio is live) a text — for DMs, huddles and,
 * opt-in, league chat. SERVER-SIDE, fired after the message is saved.
 *
 * 🛑 WHY THE SERVER. @mentions are dispatched from the BROWSER after a send (`/api/shared/chat/
 * mentions`), which means a closed tab, a failed follow-up request or a different client silently
 * sends nothing. A message alert that depends on the sender's browser behaving is not an alert.
 *
 * 🛑 THE SEND MUST NEVER PAY FOR THIS. `queue*` is fire-and-forget and catches everything; the
 * message is already committed when it runs, and a notification that throws, stalls or hits a
 * dead provider must not turn into a failed or slow send.
 *
 * Channels all go through `dispatchNotification`, so every rule the rest of the product obeys
 * holds here too: the category switch and its per-channel switches, the league mute, quiet hours
 * (push and SMS held, bell still written), the SMS daily cap, undeliverable addresses. SMS in
 * particular is the dispatcher's path unchanged: it needs a VERIFIED phone, the category's SMS
 * switch ON (off by default, like every category) and Twilio configured — until then `sendSms`
 * returns false and nothing is texted. Nothing here special-cases Twilio.
 *
 * ⚠ LOGS CARRY IDS ONLY. Never an address, a number, a message body, or a raw error object —
 * a Prisma error message can quote the query's arguments.
 */

export type ChatRecipientOutcome =
  | 'alerted'
  | 'muted'
  | 'blocked'
  | 'already_read'
  | 'viewing'
  | 'throttled'
  | 'lost_race'
  | 'not_opted_in'
  | 'failed'

export type ChatNotifyReport = {
  skipped?: string
  recipients: Array<{ userId: string; outcome: ChatRecipientOutcome; email?: boolean }>
}

export type DirectMessageNotifyInput = {
  threadId: string
  messageId: string
  senderUserId: string
  messageType?: string | null
  body?: string | null
  metadata?: Record<string, unknown> | null
  /** When the message was saved; defaults to now. */
  createdAt?: string | Date | null
  now?: Date
}

export type LeagueChatNotifyInput = {
  leagueId: string
  messageId: string
  senderUserId: string
  messageType?: string | null
  body?: string | null
  metadata?: Record<string, unknown> | null
  /**
   * The chat room inside the league. Anything but the main room (a Survivor tribe, a private
   * room) is skipped entirely — its membership is narrower than the league's, and alerting the
   * whole league about a tribe's chat would leak it.
   */
  source?: string | null
  createdAt?: string | Date | null
  now?: Date
}

function logSafe(e: unknown): Record<string, unknown> {
  if (e && typeof e === 'object') {
    const r = e as { name?: unknown; code?: unknown }
    return { name: typeof r.name === 'string' ? r.name : 'Error', code: typeof r.code === 'string' ? r.code : undefined }
  }
  return { name: typeof e }
}

function toDate(v: string | Date | null | undefined, fallback: Date): Date {
  if (!v) return fallback
  const d = v instanceof Date ? v : new Date(v)
  return Number.isFinite(d.getTime()) ? d : fallback
}

async function senderNameOf(senderUserId: string): Promise<string> {
  const sender = await prisma.appUser
    .findUnique({ where: { id: senderUserId }, select: { displayName: true, username: true } })
    .catch(() => null)
  return safeDisplayName([sender?.displayName, sender?.username], 'Someone')
}

/** Recipients who blocked the sender. */
async function blockersOf(senderUserId: string, recipientIds: string[]): Promise<Set<string>> {
  if (recipientIds.length === 0) return new Set()
  const rows = await prisma.platformBlockedUser
    .findMany({
      where: { blockedUserId: senderUserId, blockerUserId: { in: recipientIds } },
      select: { blockerUserId: true },
    })
    .catch(() => [] as Array<{ blockerUserId: string }>)
  return new Set(rows.map((r) => r.blockerUserId))
}

/** A mail-level unsubscribe (the link in every notification email) also stops these. */
async function emailUnsubscribed(email: string): Promise<boolean> {
  const row = await prisma.emailPreference
    .findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { unsubscribedAt: true },
    })
    .catch(() => null)
  return Boolean(row?.unsubscribedAt)
}

type ThrottleResult =
  | { go: false; outcome: ChatRecipientOutcome }
  | { go: true; email: boolean }

/**
 * Decide and CLAIM. A store that cannot be read or written fails OPEN for the bell and push —
 * a database blip must not silence a message — but CLOSED for email, which is the one channel
 * where an unthrottled burst lands in an inbox and stays there.
 */
async function throttle(args: {
  scope: string
  userId: string
  now: Date
  messageAt: Date
  lastReadAt: Date | null
  trackReads: boolean
}): Promise<ThrottleResult> {
  const key = chatAlertStateKey(args.scope, args.userId)
  let stored: StoredChatAlertState
  try {
    stored = await readStoredChatAlertState(key)
  } catch (e) {
    console.warn('[chat-notifications] alert state unavailable; sending without email', { scope: args.scope, userId: args.userId, ...logSafe(e) })
    return { go: true, email: false }
  }
  const decision: ChatAlertDecision = decideChatAlert({
    now: args.now,
    messageAt: args.messageAt,
    lastReadAt: args.lastReadAt,
    state: stored.state,
    trackReads: args.trackReads,
  })
  if (!decision.alert) return { go: false, outcome: decision.reason }
  try {
    const won = await claimChatAlertState(stored, nextChatAlertState(stored.state, args.now, decision.email), args.now)
    return won ? { go: true, email: decision.email } : { go: false, outcome: 'lost_race' }
  } catch (e) {
    console.warn('[chat-notifications] alert state write failed; sending without email', { scope: args.scope, userId: args.userId, ...logSafe(e) })
    return { go: true, email: false }
  }
}

export function conversationHref(threadId: string, messageId?: string | null): string {
  const base = `/messages?thread=${encodeURIComponent(threadId)}`
  return messageId ? `${base}&message=${encodeURIComponent(messageId)}` : base
}

/**
 * Alert the other members of a DM or huddle about one saved message.
 *
 * Skipped, per recipient: the sender; anyone who muted the conversation; anyone blocked in it or
 * who blocked the sender; anyone who has already read past it or is reading it right now; and
 * anyone already alerted about this conversation in the last 10 minutes who has not read since.
 * See alertThrottle.ts for the window rules.
 */
export async function notifyDirectMessageRecipients(input: DirectMessageNotifyInput): Promise<ChatNotifyReport> {
  const now = input.now ?? new Date()
  const messageAt = toDate(input.createdAt, now)

  const thread = await prisma.platformChatThread.findUnique({
    where: { id: input.threadId },
    select: {
      id: true,
      threadType: true,
      title: true,
      members: {
        select: {
          userId: true,
          isMuted: true,
          isBlocked: true,
          lastReadAt: true,
          user: { select: { email: true } },
        },
      },
    },
  })
  if (!thread) return { skipped: 'thread_not_found', recipients: [] }
  // An AI thread is a private Chimmy conversation; there is nobody else in it to tell.
  if (thread.threadType !== 'dm' && thread.threadType !== 'group') {
    return { skipped: 'not_a_conversation', recipients: [] }
  }

  const others = thread.members.filter((m) => m.userId && m.userId !== input.senderUserId)
  if (others.length === 0) return { recipients: [] }

  const blockers = await blockersOf(input.senderUserId, others.map((m) => m.userId))
  const senderName = await senderNameOf(input.senderUserId)
  const isGroup = thread.threadType === 'group'
  const threadTitle = isGroup ? safeDisplayName([thread.title], 'your huddle', 60) : null
  const preview = buildMessagePreview({
    messageType: input.messageType,
    body: input.body,
    metadata: input.metadata ?? null,
  })
  const href = conversationHref(thread.id, input.messageId)
  const baseUrl = getBaseUrl()
  const report: ChatNotifyReport = { recipients: [] }

  for (const member of others) {
    const userId = member.userId
    try {
      if (member.isBlocked || blockers.has(userId)) {
        report.recipients.push({ userId, outcome: 'blocked' })
        continue
      }
      if (member.isMuted) {
        report.recipients.push({ userId, outcome: 'muted' })
        continue
      }

      const gate = await throttle({
        scope: `dm:${thread.id}`,
        userId,
        now,
        messageAt,
        lastReadAt: member.lastReadAt ?? null,
        trackReads: true,
      })
      if (!gate.go) {
        report.recipients.push({ userId, outcome: gate.outcome })
        continue
      }

      const email = member.user?.email?.trim() || null
      const sendEmail = gate.email && Boolean(email) && !(await emailUnsubscribed(email!))
      const emailOverride = sendEmail
        ? buildDirectMessageEmail({
            senderName,
            preview,
            threadTitle,
            isGroup,
            conversationUrl: `${baseUrl}${href}`,
            baseUrl,
            unsubscribeUrl: `${baseUrl}/api/email/unsubscribe?token=${encodeURIComponent(createEmailUnsubscribeToken(email!))}`,
          })
        : undefined

      await dispatchNotification({
        userIds: [userId],
        category: 'direct_messages',
        productType: 'app',
        type: isGroup ? 'huddle_message' : 'direct_message',
        // Push shows this as the notification's title: the sender, as the owner asked.
        title: isGroup ? `${senderName} · ${threadTitle}` : senderName,
        body: preview,
        actionHref: href,
        actionLabel: 'Open conversation',
        severity: 'low',
        // One bell row per message per person, however many times this runs.
        dedupePrefix: `chat-msg:${input.messageId}`,
        meta: {
          threadId: thread.id,
          chatThreadId: thread.id,
          messageId: input.messageId,
          senderUserId: input.senderUserId,
          // One device notification per conversation: a burst replaces itself instead of stacking.
          pushTag: `dm-${thread.id}`,
        },
        skipChannels: sendEmail ? undefined : { email: true },
        emailOverride,
      })
      report.recipients.push({ userId, outcome: 'alerted', email: sendEmail })
    } catch (e) {
      console.error('[chat-notifications] dm alert failed', { threadId: thread.id, userId, ...logSafe(e) })
      report.recipients.push({ userId, outcome: 'failed' })
    }
  }
  return report
}

/**
 * League chat — OPT-IN, default off on every channel (`league_chat`).
 *
 * ⚠ PRE-FILTERED ON THE SAVED SETTING, NOT LEFT TO THE DISPATCHER. The dispatcher would drop an
 * opted-out member itself, but only after loading their settings profile — one profile read per
 * league member per message, for a switch almost nobody has turned on. One `findMany` over the
 * member ids answers it for the whole league.
 */
export async function notifyLeagueChatRecipients(input: LeagueChatNotifyInput): Promise<ChatNotifyReport> {
  const now = input.now ?? new Date()
  const room = typeof input.source === 'string' ? input.source.trim() : ''
  if (room && room !== 'league') return { skipped: 'not_main_room', recipients: [] }

  const memberIds = (await getLeagueMemberUserIds(input.leagueId)).filter((id) => id && id !== input.senderUserId)
  if (memberIds.length === 0) return { recipients: [] }

  const profiles = await prisma.userProfile.findMany({
    where: { userId: { in: memberIds } },
    select: { userId: true, notificationPreferences: true },
  })
  const optedIn = new Set<string>()
  for (const p of profiles) {
    const saved = p.notificationPreferences as NotificationPreferences | null
    if (saved?.globalEnabled === false) continue
    const cat = resolveNotificationPreferences(saved).categories?.league_chat
    if (cat?.enabled && (cat.inApp || cat.email || cat.sms || (cat.push ?? cat.inApp))) optedIn.add(p.userId)
  }
  const report: ChatNotifyReport = {
    recipients: memberIds.filter((id) => !optedIn.has(id)).map((userId) => ({ userId, outcome: 'not_opted_in' as const })),
  }
  if (optedIn.size === 0) return report

  const recipients = [...optedIn]
  const blockers = await blockersOf(input.senderUserId, recipients)
  const [senderName, league, users] = await Promise.all([
    senderNameOf(input.senderUserId),
    prisma.league.findUnique({ where: { id: input.leagueId }, select: { name: true } }).catch(() => null),
    prisma.appUser
      .findMany({ where: { id: { in: recipients } }, select: { id: true, email: true } })
      .catch(() => [] as Array<{ id: string; email: string | null }>),
  ])
  const leagueName = safeDisplayName([league?.name], 'League chat', 60)
  const emailOf = new Map(users.map((u) => [u.id, u.email?.trim() || null]))
  const preview = buildMessagePreview({
    messageType: input.messageType,
    body: input.body,
    metadata: input.metadata ?? null,
  })
  const href = `/league/${encodeURIComponent(input.leagueId)}`
  const baseUrl = getBaseUrl()
  const messageAt = toDate(input.createdAt, now)

  for (const userId of recipients) {
    try {
      if (blockers.has(userId)) {
        report.recipients.push({ userId, outcome: 'blocked' })
        continue
      }
      const gate = await throttle({
        scope: `league:${input.leagueId}`,
        userId,
        now,
        messageAt,
        lastReadAt: null,
        trackReads: false,
      })
      if (!gate.go) {
        report.recipients.push({ userId, outcome: gate.outcome })
        continue
      }
      const email = emailOf.get(userId) ?? null
      const sendEmail = gate.email && Boolean(email) && !(await emailUnsubscribed(email!))
      await dispatchNotification({
        userIds: [userId],
        category: 'league_chat',
        productType: 'app',
        type: 'league_chat_message',
        title: `${senderName} · ${leagueName}`,
        body: preview,
        actionHref: href,
        actionLabel: 'Open league chat',
        leagueId: input.leagueId,
        severity: 'low',
        dedupePrefix: `league-chat-msg:${input.messageId}`,
        meta: {
          leagueId: input.leagueId,
          messageId: input.messageId,
          senderUserId: input.senderUserId,
          pushTag: `league-chat-${input.leagueId}`,
        },
        skipChannels: sendEmail ? undefined : { email: true },
        emailOverride: sendEmail
          ? buildDirectMessageEmail({
              senderName,
              preview,
              threadTitle: leagueName,
              isGroup: true,
              conversationUrl: `${baseUrl}${href}`,
              baseUrl,
              unsubscribeUrl: `${baseUrl}/api/email/unsubscribe?token=${encodeURIComponent(createEmailUnsubscribeToken(email!))}`,
            })
          : undefined,
      })
      report.recipients.push({ userId, outcome: 'alerted', email: sendEmail })
    } catch (e) {
      console.error('[chat-notifications] league chat alert failed', { leagueId: input.leagueId, userId, ...logSafe(e) })
      report.recipients.push({ userId, outcome: 'failed' })
    }
  }
  return report
}

/**
 * Fire-and-forget entry points for send routes. They return immediately, never throw, and never
 * reject — call them AFTER the message is saved, and do not await them.
 */
export function queueDirectMessageNotifications(input: DirectMessageNotifyInput): void {
  try {
    void notifyDirectMessageRecipients(input).catch((e) => {
      console.error('[chat-notifications] dm notify failed', { threadId: input.threadId, ...logSafe(e) })
    })
  } catch (e) {
    console.error('[chat-notifications] dm notify failed to start', { threadId: input.threadId, ...logSafe(e) })
  }
}

export function queueLeagueChatNotifications(input: LeagueChatNotifyInput): void {
  try {
    void notifyLeagueChatRecipients(input).catch((e) => {
      console.error('[chat-notifications] league chat notify failed', { leagueId: input.leagueId, ...logSafe(e) })
    })
  } catch (e) {
    console.error('[chat-notifications] league chat notify failed to start', { leagueId: input.leagueId, ...logSafe(e) })
  }
}
