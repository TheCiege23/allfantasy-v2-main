import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { prisma } from '@/lib/prisma'
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from '@/lib/chat-core'
import { getLeagueMemberUserIds } from '@/lib/league-chat/leagueMemberIds'
import { resolveMentionedMemberIds } from '@/lib/chat-core/resolveMentionTargets'

export async function GET() {
  return NextResponse.json({ status: 'ok', mentions: [] })
}

/**
 * POST: record @mentions for a message so mentioned users receive a notification.
 * Body: { threadId, messageId, mentionedUsernames: string[] }
 */
export async function POST(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const threadId = body?.threadId as string | undefined
  const messageId = body?.messageId as string | undefined
  const mentionedUsernames = Array.isArray(body?.mentionedUsernames)
    ? Array.from(
        new Set(
          (body.mentionedUsernames as string[])
            .map((u) => String(u).trim().replace(/^@+/, ''))
            .filter(Boolean)
        )
      )
    : []
  if (!threadId || !messageId || mentionedUsernames.length === 0) {
    return NextResponse.json({ status: 'ok' })
  }

  const lowerMentioned = mentionedUsernames.map((u) => u.toLowerCase())
  const hasAllMention = lowerMentioned.includes('all')
  const userMentionTokens = mentionedUsernames.filter((u) => {
    const lower = u.toLowerCase()
    return lower !== 'all' && lower !== 'global' && lower !== 'chimmy'
  })

  /*
   * 🛑 WHO A MENTION CAN REACH: the members of the room the message was posted in, never the whole
   * platform. This route used to look each @name up across every AllFantasy account, so "@mike" in
   * any chat notified — and emailed — every account called mike (owner's call 2026-09-25: "fix both
   * security holes now"). The room's members are resolved once and every target must be one of them.
   */
  const isLeague = isLeagueVirtualRoom(threadId)
  const leagueId = isLeague ? getLeagueIdFromVirtualRoom(threadId) : null
  let memberIds: string[] = []
  /** The league chat route already announced @all for this message (as a league announcement). */
  let allAlreadyAnnounced = false

  if (isLeague) {
    if (!leagueId) return NextResponse.json({ error: 'Invalid league room' }, { status: 400 })
    const leagueMessage = await (prisma as any).leagueChatMessage.findFirst({
      where: { id: messageId, leagueId, userId: user.appUserId },
      select: { id: true, messageSubtype: true },
    })
    if (!leagueMessage) {
      return NextResponse.json({ error: 'Message not found or not owned by user' }, { status: 403 })
    }
    allAlreadyAnnounced = leagueMessage.messageSubtype === 'at_all'
    const bracketMember = await (prisma as any).bracketLeagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.appUserId } },
      select: { id: true },
    })
    if (bracketMember) {
      const rows = await (prisma as any).bracketLeagueMember.findMany({
        where: { leagueId },
        select: { userId: true },
      })
      memberIds = (rows as Array<{ userId: string }>).map((r) => r.userId)
    } else {
      memberIds = await getLeagueMemberUserIds(leagueId)
    }
  } else {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { threadId, userId: user.appUserId, isBlocked: false },
      select: { id: true },
    })
    if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 })
    const ownMessage = await (prisma as any).platformChatMessage.findFirst({
      where: { id: messageId, threadId, senderUserId: user.appUserId },
      select: { id: true },
    })
    if (!ownMessage) {
      return NextResponse.json({ error: 'Message not found or not owned by user' }, { status: 403 })
    }
    const rows = await (prisma as any).platformChatThreadMember.findMany({
      where: { threadId, isBlocked: false },
      select: { userId: true },
    })
    memberIds = (rows as Array<{ userId: string }>).map((r) => r.userId)
  }

  const sender = await (prisma as any).appUser.findUnique({
    where: { id: user.appUserId },
    select: { displayName: true, username: true },
  })
  // Never the sender's email: this text goes into other people's bell, push and inbox.
  const senderName = sender?.displayName || sender?.username || 'Someone'

  const named = await resolveMentionedMemberIds({
    tokens: userMentionTokens,
    memberIds,
    senderUserId: user.appUserId,
  })
  const userIds = new Set<string>(named)

  /*
   * @all. In a league room the league chat route has already told every member (a "League
   * announcements" notification, when it stored the message as `at_all`); adding a "Chat mentions"
   * notification here sent everyone two of each — two emails, two pushes. Only rooms nothing else
   * announced (DMs, huddles, bracket pools) are expanded here.
   */
  if (hasAllMention && !allAlreadyAnnounced) {
    for (const id of memberIds) {
      if (id !== user.appUserId) userIds.add(id)
    }
  }

  /*
   * Record who the message named, so the launcher's "@" badge can count it: getChatUnread counts
   * DM/huddle mentions from `mentionedUserIds`, which nothing ever wrote — so the "@" never lit.
   * League messages are stored with ids by the league chat route itself.
   */
  if (!isLeague && userIds.size > 0) {
    await (prisma as any).platformChatMessage
      .update({ where: { id: messageId }, data: { mentionedUserIds: Array.from(userIds) } })
      .catch(() => {})
  }

  const targetIds = Array.from(userIds)
  if (targetIds.length > 0) {
    const actionHref = isLeague && leagueId
      ? `/league/${encodeURIComponent(leagueId)}`
      : `/messages?thread=${encodeURIComponent(threadId)}&message=${encodeURIComponent(messageId)}`
    const bodyText = isLeague
      ? `${senderName} mentioned you in a league chat.`
      : `${senderName} mentioned you in a chat.`
    await dispatchNotification({
      userIds: targetIds,
      category: 'chat_mentions',
      productType: 'app',
      type: 'mention',
      title: 'You were mentioned',
      body: bodyText,
      severity: 'low',
      actionHref,
      actionLabel: isLeague ? 'Open league chat' : 'Open mention',
      meta: { threadId, messageId, chatThreadId: threadId, leagueId: leagueId ?? undefined },
      // A retried request must not stack a second bell row per person.
      dedupePrefix: `mention:${messageId}`,
    })
  }

  return NextResponse.json({ status: 'ok', notified: targetIds.length })
}
