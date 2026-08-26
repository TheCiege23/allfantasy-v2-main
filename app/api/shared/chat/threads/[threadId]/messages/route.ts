import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import {
  createPlatformThreadMessage,
  createSystemMessage,
  getPlatformThreadMessages,
} from '@/lib/platform/chat-service'
import { generateChimmyPrivateReply } from '@/lib/chat-core/chimmyPrivateReply'
import type { PlatformChatMessage } from '@/types/platform-shared'
import {
  isLeagueVirtualRoom,
  getLeagueIdFromVirtualRoom,
  getMessageQueryOptions,
  parseCursor,
} from '@/lib/chat-core'
import { bracketMessagesToPlatform } from '@/lib/chat-core/league-message-proxy'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { getLeagueChatMessages } from '@/lib/league-chat/LeagueChatMessageService'
import { parseTribeIdFromSource } from '@/lib/survivor/constants'
import { getTribeChatMemberRosterIds } from '@/lib/survivor/SurvivorChatMembershipService'
import { processSurvivorOfficialCommand } from '@/lib/survivor/SurvivorOfficialCommandService'
import { resolveSurvivorCurrentWeek } from '@/lib/survivor/SurvivorTimelineResolver'
import { isMergeTriggered } from '@/lib/survivor/SurvivorMergeEngine'
import { prisma } from '@/lib/prisma'
import { getBlockedUserIds } from '@/lib/moderation'
import { filterMessagesByBlocked } from '@/lib/moderation'
import { publishDraftIntelState } from '@/lib/draft-intelligence'
import { DETERMINISTIC_SOURCE, tryDeterministicAnswer } from '@/lib/ai/deterministic'

const bracketMessageInclude = {
  user: {
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      avatarUrl: true,
      profile: { select: { avatarPreset: true } },
    },
  },
  reactions: {
    select: {
      emoji: true,
      userId: true,
    },
  },
}

function normalizeLeagueChatSource(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'league') return null
  return trimmed
}

async function canAccessSurvivorTribeSource(
  leagueId: string,
  userId: string,
  source: string | null | undefined
): Promise<boolean> {
  if (!source) return true
  const tribeId = parseTribeIdFromSource(source)
  if (!tribeId) return true
  const currentWeek = await resolveSurvivorCurrentWeek(leagueId).catch(() => 1)
  const merged = await isMergeTriggered(leagueId, currentWeek).catch(() => false)
  if (merged) return false
  const rosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  if (!rosterId) return false
  const memberRosterIds = await getTribeChatMemberRosterIds(tribeId)
  return memberRosterIds.includes(rosterId)
}

function applyBlockedVisibility(
  messages: PlatformChatMessage[],
  blockSet: Set<string>
): { messages: PlatformChatMessage[]; hiddenBlockedCount: number } {
  if (blockSet.size === 0) return { messages, hiddenBlockedCount: 0 }
  const filtered = filterMessagesByBlocked(messages, blockSet)
  return {
    messages: filtered,
    hiddenBlockedCount: Math.max(0, messages.length - filtered.length),
  }
}

async function resolveDraftIntelThreadState(threadId: string): Promise<{
  isDraftIntel: boolean
  archived: boolean
  leagueId: string | null
}> {
  const messages = await (prisma as any).platformChatMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { metadata: true },
  })
  for (const message of messages) {
    const metadata =
      message.metadata && typeof message.metadata === 'object'
        ? (message.metadata as Record<string, unknown>)
        : null
    if (metadata?.draftIntelThread === true) {
      return {
        isDraftIntel: true,
        archived: metadata.archived === true,
        leagueId: typeof metadata.leagueId === 'string' ? metadata.leagueId : null,
      }
    }
  }
  return { isDraftIntel: false, archived: false, leagueId: null }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { threadId: string } },
) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const threadId = decodeURIComponent(params.threadId)
  const query = getMessageQueryOptions(req.nextUrl.searchParams)
  const limit = query.limit ?? 50
  const beforeDate = parseCursor(query.before ?? null)
  const source = normalizeLeagueChatSource(
    req.nextUrl.searchParams.has('source') ? req.nextUrl.searchParams?.get('source') : undefined
  )
  const blockedIds = await getBlockedUserIds(user.appUserId)
  const blockSet = blockedIds.length > 0 ? new Set(blockedIds) : new Set<string>()

  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    if (!leagueId) return NextResponse.json({ error: 'Invalid league room' }, { status: 400 })
    const member = await (prisma as any).bracketLeagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.appUserId } },
    })
    if (member) {
      const rows = await (prisma as any).bracketLeagueMessage.findMany({
        where: {
          leagueId,
          ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: bracketMessageInclude,
      })
      const messages = bracketMessagesToPlatform(rows.reverse(), threadId)
      const visible = applyBlockedVisibility(messages, blockSet)
      return NextResponse.json({
        status: 'ok',
        messages: visible.messages,
        hiddenBlockedCount: visible.hiddenBlockedCount,
      })
    }
    const mainLeagueAccess = await canAccessLeagueDraft(leagueId, user.appUserId)
    if (mainLeagueAccess) {
      const sourceAllowed = await canAccessSurvivorTribeSource(leagueId, user.appUserId, source)
      if (!sourceAllowed) {
        return NextResponse.json({ error: 'Not allowed to access this tribe chat' }, { status: 403 })
      }
      const messages = await getLeagueChatMessages(leagueId, {
        limit,
        before: beforeDate ?? undefined,
        source,
        requestingUserId: user.appUserId,
      })
      const visible = applyBlockedVisibility(messages, blockSet)
      return NextResponse.json({
        status: 'ok',
        messages: visible.messages,
        hiddenBlockedCount: visible.hiddenBlockedCount,
      })
    }
    return NextResponse.json({ error: 'Not a member' }, { status: 403 })
  }

  const messages = await getPlatformThreadMessages(user.appUserId, threadId, limit)
  const visible = applyBlockedVisibility(messages, blockSet)
  return NextResponse.json({
    status: 'ok',
    messages: visible.messages,
    hiddenBlockedCount: visible.hiddenBlockedCount,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { threadId: string } },
) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const threadId = decodeURIComponent(params.threadId)
  const body = await req.json().catch(() => ({}))
  const metadata =
    body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : undefined
  const rawMessage = String(body?.body || body?.message || '').trim()
  const messageType = String(body?.messageType || 'text')
  const message =
    messageType === 'poll' &&
    metadata &&
    typeof metadata.question === 'string' &&
    Array.isArray(metadata.options)
      ? JSON.stringify({
          question: String(metadata.question),
          options: (metadata.options as unknown[]).map((option) => String(option)).filter(Boolean),
          votes:
            metadata.votes && typeof metadata.votes === 'object'
              ? (metadata.votes as Record<string, string[]>)
              : {},
          closed: Boolean(metadata.closed),
        })
      : rawMessage
  const source = normalizeLeagueChatSource(body?.source)
  const isChimmyPrompt = /^@chimmy\b/i.test(message)
  const parentMessageId =
    typeof body?.parentMessageId === 'string' && body.parentMessageId.trim().length > 0
      ? body.parentMessageId.trim()
      : null
  const imageUrl =
    typeof body?.imageUrl === 'string' && body.imageUrl.trim().length > 0 ? body.imageUrl.trim() : null

  if (!message) {
    return NextResponse.json({ error: 'Message body required' }, { status: 400 })
  }
  const maxLength = ['image', 'gif', 'file'].includes(messageType) ? 2000 : 1000
  if (message.length > maxLength) {
    return NextResponse.json({ error: 'Message too long' }, { status: 400 })
  }

  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    if (!leagueId) return NextResponse.json({ error: 'Invalid league room' }, { status: 400 })
    const member = await (prisma as any).bracketLeagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.appUserId } },
    })
    if (member) {
      const created = await (prisma as any).bracketLeagueMessage.create({
        data: {
          leagueId,
          userId: user.appUserId,
          message,
          type: messageType,
          imageUrl,
          metadata,
          replyToId: parentMessageId,
        },
        include: bracketMessageInclude,
      })
      const mapped = bracketMessagesToPlatform([created], threadId)[0]
      return NextResponse.json({ status: 'ok', message: mapped })
    }
    const mainLeagueAccess = await canAccessLeagueDraft(leagueId, user.appUserId)
    if (mainLeagueAccess) {
      const sourceAllowed = await canAccessSurvivorTribeSource(leagueId, user.appUserId, source)
      if (!sourceAllowed) {
        return NextResponse.json({ error: 'Not allowed to post in this tribe chat' }, { status: 403 })
      }
      const { createLeagueChatMessage } = await import('@/lib/league-chat/LeagueChatMessageService')
      if (isChimmyPrompt) {
        const chimmyBody = message.replace(/^@chimmy\b\s*/i, '').trim()
        const created = await createLeagueChatMessage(leagueId, user.appUserId, chimmyBody || 'help', {
          type: messageType as 'text',
          imageUrl,
          metadata: {
            ...(metadata ?? {}),
            chimmyPrompt: true,
            originalCommand: message,
          },
          source,
          parentMessageId,
          isPrivate: true,
          visibleToUserId: user.appUserId,
          messageSubtype: 'chimmy_prompt',
        })
        const replyText =
          await tryDeterministicAnswer(chimmyBody || 'help', req.cookies?.get?.('af_lang')?.value)
            .catch(() => null) ??
          "I don't have reliable data for that yet. I can answer cached scores, schedules, news, weather, FantasyCalc values, and league context when those data sources are available."
        const reply = await createLeagueChatMessage(leagueId, user.appUserId, replyText, {
          type: 'text',
          metadata: {
            chimmyResponse: true,
            privateReplyToMessageId: created?.id ?? null,
            source: DETERMINISTIC_SOURCE,
            discordAuthorName: 'Chimmy',
          },
          source,
          parentMessageId: created?.id ?? parentMessageId,
          isPrivate: true,
          visibleToUserId: user.appUserId,
          messageSubtype: 'chimmy_private_response',
        })
        return NextResponse.json({
          status: 'ok',
          message: created,
          aiReply: reply,
          messages: [created, reply].filter(Boolean),
          commandResult: {
            ok: true,
            intent: 'chimmy_prompt',
            message: 'Private Chimmy reply added to this chat.',
          },
        })
      }
      const commandResult = await processSurvivorOfficialCommand({
        leagueId,
        userId: user.appUserId,
        command: message,
        source,
      })
      if (commandResult.handled && !commandResult.ok) {
        return NextResponse.json({ error: commandResult.error ?? 'Survivor command failed' }, { status: commandResult.status ?? 400 })
      }
      const messageMetadata =
        body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? (body.metadata as Record<string, unknown>)
          : undefined
      const created = await createLeagueChatMessage(leagueId, user.appUserId, message, {
        type: messageType as 'text',
        imageUrl,
        metadata: messageMetadata,
        source,
        parentMessageId,
      })
      return NextResponse.json({
        status: 'ok',
        message: created,
        commandResult: commandResult.handled
          ? {
              ok: commandResult.ok,
              intent: commandResult.intent,
              message: commandResult.message,
            }
          : null,
      })
    }
    return NextResponse.json({ error: 'Not a member' }, { status: 403 })
  }

  const myMembership = await (prisma as any).platformChatThreadMember.findFirst({
    where: { threadId, userId: user.appUserId, isBlocked: false },
    include: {
      thread: {
        select: {
          id: true,
          title: true,
          threadType: true,
          members: { select: { userId: true } },
        },
      },
    },
  })
  if (!myMembership?.thread) {
    return NextResponse.json({ error: "Thread not available" }, { status: 403 })
  }

  const draftIntelThread = myMembership.thread.threadType === 'ai'
    ? await resolveDraftIntelThreadState(threadId)
    : { isDraftIntel: false, archived: false, leagueId: null }
  if (draftIntelThread.isDraftIntel && draftIntelThread.archived) {
    return NextResponse.json({ error: 'This Chimmy draft thread is archived.' }, { status: 403 })
  }

  if (myMembership.thread.threadType === "dm") {
    const members = Array.isArray(myMembership.thread.members) ? myMembership.thread.members : []
    const otherUserId = members.find((member: { userId: string }) => member.userId !== user.appUserId)?.userId
    if (otherUserId) {
      const blockedRelation = await (prisma as any).platformBlockedUser.findFirst({
        where: {
          OR: [
            { blockerUserId: user.appUserId, blockedUserId: otherUserId },
            { blockerUserId: otherUserId, blockedUserId: user.appUserId },
          ],
        },
        select: { id: true },
      })
      if (blockedRelation) {
        return NextResponse.json(
          { error: "Direct messages are blocked between these users. Unblock to continue." },
          { status: 403 }
        )
      }
    }
  }

  /*
   * ⚠ @chimmy WORKED IN LEAGUE CHAT AND NOWHERE ELSE. `/api/league/chat` has
   * handled it since it was written; this route — the one DMs and huddles
   * actually post through — only ever produced an AI reply for draft-intel
   * threads, so asking Chimmy anything in a DM posted the words "@chimmy ..."
   * into the room and got silence back.
   *
   * Both halves are stored private to the asker, matching league chat. In a
   * huddle a visible question with a private answer reads as though Chimmy
   * ignored somebody.
   */
  const wantsPrivateChimmy = isChimmyPrompt && !draftIntelThread.isDraftIntel

  const created = await createPlatformThreadMessage(
    user.appUserId,
    threadId,
    message,
    messageType,
    metadata,
    wantsPrivateChimmy
      ? { visibleToUserId: user.appUserId, messageSubtype: 'chimmy_private' }
      : undefined,
  )

  if (!created) {
    return NextResponse.json({ error: 'Unable to send message' }, { status: 400 })
  }

  let aiReply: PlatformChatMessage | null = null

  if (wantsPrivateChimmy) {
    /*
     * A DM has no league, so this reply is ungrounded — and the generator is
     * told so rather than left to guess, because a model that does not know it
     * is missing the data is the one that fills the gap in confidently.
     */
    const replyText = await generateChimmyPrivateReply(message, {
      leagueId: draftIntelThread.leagueId ?? null,
      userId: user.appUserId,
    }).catch(
      () =>
        "I could not reach the AI just now. Try again in a moment, or open the Chimmy panel on a league page.",
    )

    aiReply = await createSystemMessage(
      threadId,
      'text',
      replyText,
      { chimmyResponse: true, chimmyPrivateReply: true, privateReplyToMessageId: created.id },
      { visibleToUserId: user.appUserId, messageSubtype: 'chimmy_private' },
    )

    return NextResponse.json({ status: 'ok', message: created, aiReply })
  }
  if (draftIntelThread.isDraftIntel && draftIntelThread.leagueId) {
    const state = await publishDraftIntelState({
      leagueId: draftIntelThread.leagueId,
      userId: user.appUserId,
      trigger: 'reply',
    }).catch(() => null)
    if (state) {
      aiReply = await createSystemMessage(
        threadId,
        'draft_intel_queue',
        state.status === 'on_clock' ? state.messages.onClock : state.messages.update,
        {
          draftIntelThread: true,
          verifiedBadge: true,
          leagueId: state.leagueId,
          leagueName: state.leagueName,
          sport: state.sport,
          archived: false,
          allowReplies: true,
          showInDmList: true,
          readOnlyFeed: true,
          messageKind: 'reply',
          question: message,
          headline: state.headline,
          queue: state.queue.slice(0, 3),
          actionHref: `/league/${state.leagueId}/draft`,
          actionLabel: 'Open draft',
        }
      )
    }
  }

  return NextResponse.json({ status: 'ok', message: created, aiReply })
}
