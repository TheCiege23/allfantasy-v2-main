import 'server-only'

import { createHash } from 'node:crypto'

import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { OWNER_EMAIL } from '@/lib/notifications/notifyOwnerOfNewSignup'
import { prisma } from '@/lib/prisma'
import { consumeDailyLimit } from '@/lib/rate-limit-daily'
import { sendNotificationEmail } from '@/lib/resend-client'
import {
  SUPPORT_MESSAGES_PER_DAY,
  SUPPORT_STAFF_NAME,
  SUPPORT_THREAD_TYPE,
  SUPPORT_THREADS_PER_DAY,
  SUPPORT_TOPIC_LABELS,
  readSupportMeta,
  supportStatus,
  supportThreadTitle,
  type SupportEvent,
  type SupportFrom,
  type SupportMeta,
  type SupportStatus,
  type SupportTopic,
} from './supportInboxCore'

/**
 * The support inbox's reads and writes (rules in ./supportInboxCore.ts).
 *
 * 🛑 EVERY READ IS SCOPED. A member reaches a thread only when they created it (`createdByUserId`) and it
 * is a support thread; anything else answers "not found", never "forbidden", so ids cannot be probed.
 * Admin routes pass `asStaff`, and only after `requireAdmin`.
 *
 * Alerts: a member's message tells the owner (email to the owner address, the same one new signups go
 * to) and every signed-in admin account (bell); a staff reply tells the member through the dispatcher,
 * `system_account` — a reply to their own request is account mail, so it reaches them even if they
 * unsubscribed from marketing. Both best-effort: a failed alert never fails the message.
 */

export type SupportMessageView = { id: string; from: SupportFrom; event?: SupportEvent; body: string; createdAt: string; authorName: string }
export type SupportThreadView = {
  id: string
  title: string
  topic: SupportTopic | null
  status: SupportStatus
  createdAt: string
  lastMessageAt: string
  pagePath?: string
  member?: { userId: string; name: string; email: string | null }
  messages?: SupportMessageView[]
}

type ThreadRow = { id: string; title: string | null; createdAt: Date; lastMessageAt: Date; createdByUserId: string | null }
type MessageRow = { id: string; senderUserId: string | null; body: string; metadata: unknown; createdAt: Date }

const hash = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 24)

async function withinDailyLimit(kind: 'thread' | 'message', userId: string): Promise<boolean> {
  try {
    const r = await consumeDailyLimit({
      provider: kind === 'thread' ? 'support_thread' : 'support_message',
      endpoint: `user:${hash(userId)}`,
      callsLimit: kind === 'thread' ? SUPPORT_THREADS_PER_DAY : SUPPORT_MESSAGES_PER_DAY,
    })
    return r.success
  } catch {
    // A counter we cannot read must not lock someone out of asking for help.
    return true
  }
}

function view(thread: ThreadRow, messages: MessageRow[] | null, member?: SupportThreadView['member']): SupportThreadView {
  const metas = (messages ?? []).map((m) => readSupportMeta(m.metadata))
  const opened = metas.find((m) => m?.event === 'opened') ?? null
  return {
    id: thread.id,
    title: thread.title ?? 'Support',
    topic: opened?.topic ?? null,
    status: messages ? supportStatus(messages) : 'needs_reply',
    createdAt: thread.createdAt.toISOString(),
    lastMessageAt: thread.lastMessageAt.toISOString(),
    ...(opened?.pagePath ? { pagePath: opened.pagePath } : {}),
    ...(member ? { member } : {}),
    ...(messages
      ? {
          messages: messages.flatMap((m, i) => {
            const meta = metas[i]
            if (!meta) return []
            const name = meta.from === 'staff' ? SUPPORT_STAFF_NAME : member?.name ?? 'You'
            return [{ id: m.id, from: meta.from, ...(meta.event ? { event: meta.event } : {}), body: m.body, createdAt: m.createdAt.toISOString(), authorName: name }]
          }),
        }
      : {}),
  }
}

async function messagesOf(threadId: string): Promise<MessageRow[]> {
  return prisma.platformChatMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, senderUserId: true, body: true, metadata: true, createdAt: true },
    take: 500,
  })
}

async function findThread(threadId: string, scope: { memberUserId: string } | { asStaff: true }): Promise<ThreadRow | null> {
  const row = await prisma.platformChatThread.findFirst({
    where: {
      id: threadId,
      threadType: SUPPORT_THREAD_TYPE,
      ...('memberUserId' in scope ? { createdByUserId: scope.memberUserId } : {}),
    },
    select: { id: true, title: true, createdAt: true, lastMessageAt: true, createdByUserId: true },
  })
  return row
}

async function memberOf(userId: string | null): Promise<SupportThreadView['member'] | undefined> {
  if (!userId) return undefined
  const u = await prisma.appUser
    .findUnique({ where: { id: userId }, select: { id: true, email: true, displayName: true, username: true } })
    .catch(() => null)
  return { userId, name: u?.displayName?.trim() || u?.username?.trim() || 'A member', email: u?.email ?? null }
}

async function write(threadId: string, senderUserId: string | null, body: string, meta: SupportMeta, now: Date): Promise<string> {
  const msg = await prisma.platformChatMessage.create({
    data: { threadId, senderUserId, messageType: meta.event && meta.event !== 'opened' ? 'system' : 'text', body, metadata: { support: meta } },
    select: { id: true },
  })
  await prisma.platformChatThread.update({ where: { id: threadId }, data: { lastMessageAt: now } })
  return msg.id
}

/* ── Member side ─────────────────────────────────────────────────────────────────────────────── */

export async function openSupportThread(input: {
  userId: string
  topic: SupportTopic
  text: string
  pagePath?: string
  now?: Date
}): Promise<{ ok: true; threadId: string } | { ok: false; error: 'rate_limited' }> {
  const now = input.now ?? new Date()
  if (!(await withinDailyLimit('thread', input.userId))) return { ok: false, error: 'rate_limited' }
  const thread = await prisma.platformChatThread.create({
    data: { threadType: SUPPORT_THREAD_TYPE, productType: 'shared', title: supportThreadTitle(input.topic, input.text), createdByUserId: input.userId, lastMessageAt: now },
    select: { id: true },
  })
  await write(thread.id, input.userId, input.text, { from: 'member', event: 'opened', topic: input.topic, ...(input.pagePath ? { pagePath: input.pagePath } : {}) }, now)
  void alertStaff({ threadId: thread.id, userId: input.userId, topic: input.topic, text: input.text, isNew: true })
  return { ok: true, threadId: thread.id }
}

export async function memberReply(input: { userId: string; threadId: string; text: string; now?: Date }): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'rate_limited' }> {
  const thread = await findThread(input.threadId, { memberUserId: input.userId })
  if (!thread) return { ok: false, error: 'not_found' }
  if (!(await withinDailyLimit('message', input.userId))) return { ok: false, error: 'rate_limited' }
  await write(thread.id, input.userId, input.text, { from: 'member' }, input.now ?? new Date())
  void alertStaff({ threadId: thread.id, userId: input.userId, topic: null, text: input.text, isNew: false })
  return { ok: true }
}

export async function listMemberThreads(userId: string): Promise<SupportThreadView[]> {
  const threads = await prisma.platformChatThread.findMany({
    where: { threadType: SUPPORT_THREAD_TYPE, createdByUserId: userId },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true, title: true, createdAt: true, lastMessageAt: true, createdByUserId: true },
    take: 50,
  })
  return Promise.all(threads.map(async (t) => {
    const v = view(t, await messagesOf(t.id))
    delete v.messages
    return v
  }))
}

export async function getMemberThread(userId: string, threadId: string): Promise<SupportThreadView | null> {
  const thread = await findThread(threadId, { memberUserId: userId })
  if (!thread) return null
  return view(thread, await messagesOf(thread.id))
}

/* ── Staff side (callers have passed requireAdmin) ─────────────────────────────────────────────── */

export async function listStaffThreads(filter: { status?: SupportStatus | 'all' } = {}): Promise<SupportThreadView[]> {
  const threads = await prisma.platformChatThread.findMany({
    where: { threadType: SUPPORT_THREAD_TYPE },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true, title: true, createdAt: true, lastMessageAt: true, createdByUserId: true },
    take: 200,
  })
  const views = await Promise.all(threads.map(async (t) => {
    const v = view(t, await messagesOf(t.id), await memberOf(t.createdByUserId))
    delete v.messages
    return v
  }))
  const want = filter.status ?? 'all'
  return want === 'all' ? views : views.filter((v) => v.status === want)
}

export async function getStaffThread(threadId: string): Promise<SupportThreadView | null> {
  const thread = await findThread(threadId, { asStaff: true })
  if (!thread) return null
  return view(thread, await messagesOf(thread.id), await memberOf(thread.createdByUserId))
}

export async function staffReply(input: { adminUserId: string | null; threadId: string; text: string; now?: Date }): Promise<{ ok: true } | { ok: false; error: 'not_found' }> {
  const thread = await findThread(input.threadId, { asStaff: true })
  if (!thread) return { ok: false, error: 'not_found' }
  const messageId = await write(thread.id, input.adminUserId, input.text, { from: 'staff' }, input.now ?? new Date())
  if (thread.createdByUserId) void alertMember({ userId: thread.createdByUserId, threadId: thread.id, messageId, text: input.text })
  return { ok: true }
}

export async function setSupportStatus(input: { adminUserId: string | null; threadId: string; to: 'closed' | 'open'; now?: Date }): Promise<{ ok: true } | { ok: false; error: 'not_found' }> {
  const thread = await findThread(input.threadId, { asStaff: true })
  if (!thread) return { ok: false, error: 'not_found' }
  const event: SupportEvent = input.to === 'closed' ? 'closed' : 'reopened'
  await write(thread.id, input.adminUserId, input.to === 'closed' ? 'Conversation closed.' : 'Conversation reopened.', { from: 'staff', event }, input.now ?? new Date())
  return { ok: true }
}

/* ── Alerts ───────────────────────────────────────────────────────────────────────────────────── */

/** Signed-in admin accounts: allowlisted (`ADMIN_EMAILS`) addresses their owners have proven. */
async function adminUserIds(): Promise<string[]> {
  const emails = (process.env.ADMIN_EMAILS || '').split(/[\n\r,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (emails.length === 0) return []
  const rows = await prisma.appUser.findMany({
    where: { emailVerified: { not: null }, OR: emails.map((e) => ({ email: { equals: e, mode: 'insensitive' as const } })) },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

async function alertStaff(input: { threadId: string; userId: string; topic: SupportTopic | null; text: string; isNew: boolean }): Promise<void> {
  try {
    const member = await memberOf(input.userId)
    const href = `/admin/support?thread=${encodeURIComponent(input.threadId)}`
    const who = member?.name ?? 'A member'
    const subject = input.isNew
      ? `Support: ${input.topic ? SUPPORT_TOPIC_LABELS.en[input.topic] : 'new message'} from ${who}`
      : `Support: ${who} replied`
    await sendNotificationEmail({ to: OWNER_EMAIL, subject, bodyHtml: input.text.slice(0, 2000), actionHref: href, actionLabel: 'Open the support inbox' }).catch(() => null)
    const admins = (await adminUserIds().catch(() => [])).filter((id) => id !== input.userId)
    if (admins.length > 0) {
      await dispatchNotification({
        userIds: admins,
        category: 'system_account',
        productType: 'app',
        type: 'support_message',
        title: subject,
        body: input.text.slice(0, 300),
        actionHref: href,
        actionLabel: 'Open the support inbox',
        severity: 'medium',
        // Email goes once, to the owner address above; this is the bell and the phone.
        skipChannels: { email: true, sms: true },
        dedupePrefix: `support-staff:${input.threadId}:${hash(input.text)}`,
        meta: { supportThreadId: input.threadId },
      }).catch(() => null)
    }
  } catch (e) {
    console.error('[support] staff alert failed', { threadId: input.threadId, error: e instanceof Error ? e.message : String(e) })
  }
}

async function alertMember(input: { userId: string; threadId: string; messageId: string; text: string }): Promise<void> {
  try {
    await dispatchNotification({
      userIds: [input.userId],
      category: 'system_account',
      productType: 'app',
      type: 'support_reply',
      title: `${SUPPORT_STAFF_NAME} replied`,
      body: input.text.slice(0, 300),
      actionHref: `/help?thread=${encodeURIComponent(input.threadId)}`,
      actionLabel: 'Read the reply',
      severity: 'medium',
      skipChannels: { sms: true },
      dedupePrefix: `support-reply:${input.messageId}`,
      meta: { supportThreadId: input.threadId },
    })
  } catch (e) {
    console.error('[support] member alert failed', { threadId: input.threadId, error: e instanceof Error ? e.message : String(e) })
  }
}
