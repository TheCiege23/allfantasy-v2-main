// TEST HELPERS FOR THREADED CHAT
/**
 * Create a message for testing (wrapper for createLeagueChatMessage)
 */
export async function createMessage({ threadId, body, senderId, parentMessageId, ...options }: { threadId: string, body: string, senderId: string, parentMessageId?: string, isPrivate?: boolean, visibleToUserId?: string | null, messageSubtype?: string | null, mentionedUserIds?: string[], globalBroadcastId?: string | null, imageUrl?: string | null, metadata?: Record<string, unknown>, type?: string, source?: string | null, discordMessageId?: string | null, sourceDiscord?: boolean }) {
  // threadId format: league:leagueId
  const leagueId = threadId.replace(/^league:/, "")
  return createLeagueChatMessage(leagueId, senderId, body, { parentMessageId, ...options })
}

/**
 * Get all messages in a thread (wrapper for getLeagueChatMessages)
 */
export async function getMessagesByThread(threadId: string, requestingUserId?: string, source?: string | null) {
  const leagueId = threadId.replace(/^league:/, "")
  return getLeagueChatMessages(leagueId, { limit: 100, requestingUserId, source })
}

/**
 * Get replies for a message (filter by parentMessageId)
 */
export async function getRepliesForMessage(parentMessageId: string) {
  // Find all messages in all leagues (for test, just get a lot)
  const all = await prisma.leagueChatMessage.findMany({ take: 200 })
  return all.filter((m) => m.parentMessageId === parentMessageId)
}
/**
 * League chat messages for main app League (LeagueChatMessage).
 * Used by shared chat when threadId = league:leagueId and league is main League (not BracketLeague).
 */

import { prisma } from '@/lib/prisma'
import { toPrismaNullableJsonInput } from '@/lib/prisma-json'
import type { PlatformChatMessage } from '@/types/platform-shared'

const includeUser = {
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
}

export async function getLeagueChatMessages(
  leagueId: string,
  options: {
    limit?: number
    before?: Date
    source?: string | null /** when undefined, league channel = exclude draft-only + tribe-only */
    /** Required for private @chimmy rows — omit only for internal jobs (avoid leaking). */
    requestingUserId?: string
    /** When set, restrict to these `LeagueChatMessage.type` values (e.g. draft_pick overlay during sync). */
    messageTypeIn?: string[]
  }
): Promise<PlatformChatMessage[]> {
  const limit = Math.min(options.limit ?? 50, 100)
  const where: Record<string, unknown> = { leagueId }
  if (Array.isArray(options.messageTypeIn) && options.messageTypeIn.length > 0) {
    where.type = { in: options.messageTypeIn }
  }
  if (typeof options.source === 'string' && options.source.trim()) {
    where.source = options.source.trim()
  } else if (options.source === null) {
    where.source = null
  } else if (options.source === undefined) {
    where.NOT = [{ source: 'draft' }, { source: { startsWith: 'tribe_' } }]
  }
  const requestingUserId = options.requestingUserId
  if (requestingUserId) {
    where.OR = [{ isPrivate: false }, { isPrivate: true, visibleToUserId: requestingUserId }]
  } else {
    where.isPrivate = false
  }
  const rows = await prisma.leagueChatMessage.findMany({
    where: {
      ...where,
      ...(options.before ? { createdAt: { lt: options.before } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: includeUser,
  })
  return rows.reverse().map((m) => {
    const rowPriv = m as {
      isPrivate?: boolean
      visibleToUserId?: string | null
      messageSubtype?: string | null
      mentionedUserIds?: string[]
      globalBroadcastId?: string | null
    }
    const rawMeta = ((m as { metadata?: Record<string, unknown> }).metadata ?? null) as Record<
      string,
      unknown
    > | null
    const discordAuthorName =
      typeof rawMeta?.discordAuthorName === 'string' ? rawMeta.discordAuthorName : null
    const discordAuthorAvatarUrl =
      typeof rawMeta?.discordAuthorAvatarUrl === 'string' ? rawMeta.discordAuthorAvatarUrl : null
    const src = (m as { source?: string | null }).source ?? null
    const base = {
      id: m.id,
      threadId: `league:${leagueId}`,
      channelSource: src,
      senderUserId: m.user?.id ?? null,
      senderName: discordAuthorName || m.user?.displayName || m.user?.email || 'User',
      senderUsername: m.user?.username ?? null,
      senderAvatarUrl: discordAuthorAvatarUrl ?? m.user?.avatarUrl ?? null,
      senderAvatarPreset: m.user?.profile?.avatarPreset ?? null,
      messageType: m.type || 'text',
      body: m.message || '',
      createdAt: m.createdAt.toISOString(),
    }
    const baseMeta = ((m as { metadata?: Record<string, unknown> }).metadata ?? {}) as Record<string, unknown>
    const withImage = (m as { imageUrl?: string | null }).imageUrl
      ? { ...baseMeta, imageUrl: (m as { imageUrl?: string | null }).imageUrl }
      : baseMeta
    const privacy =
      rowPriv.isPrivate || rowPriv.messageSubtype || rowPriv.globalBroadcastId
        ? {
            isPrivate: Boolean(rowPriv.isPrivate),
            visibleToUserId: rowPriv.visibleToUserId ?? undefined,
            messageSubtype: rowPriv.messageSubtype ?? undefined,
            mentionedUserIds: rowPriv.mentionedUserIds ?? undefined,
            globalBroadcastId: rowPriv.globalBroadcastId ?? undefined,
          }
        : {}
    const withPresence = {
      ...withImage,
      lastActiveAt: m.createdAt.toISOString(),
      ...privacy,
    }
    const meta = Object.keys(withPresence).length > 0 ? withPresence : undefined
    return meta ? { ...base, metadata: meta } : base
  }).map((message) => {
    const metadata =
      'metadata' in message
        ? (message.metadata as Record<string, unknown> | undefined)
        : undefined
    const deleted = Boolean(metadata?.deletedAt)
    return deleted ? { ...message, body: '[message deleted]' } : message
  })
}

export async function createLeagueChatMessage(
  leagueId: string,
  userId: string,
  message: string,
  options: {
    type?: string
    imageUrl?: string | null
    metadata?: Record<string, unknown>
    source?: string | null
    discordMessageId?: string | null
    sourceDiscord?: boolean
    isPrivate?: boolean
    visibleToUserId?: string | null
    messageSubtype?: string | null
    mentionedUserIds?: string[]
    globalBroadcastId?: string | null
    parentMessageId?: string | null
  }
): Promise<PlatformChatMessage | null> {
  const source =
    typeof options.source === 'string' && options.source.trim()
      ? options.source.trim()
      : options.source === null
        ? null
        : null
  const created = await prisma.leagueChatMessage.create({
    data: {
      leagueId,
      userId,
      message,
      type: options.type ?? 'text',
      imageUrl: options.imageUrl ?? null,
      metadata: toPrismaNullableJsonInput(options.metadata),
      source,
      discordMessageId: options.discordMessageId ?? null,
      sourceDiscord: options.sourceDiscord ?? false,
      isPrivate: options.isPrivate ?? false,
      visibleToUserId: options.visibleToUserId ?? null,
      messageSubtype: options.messageSubtype ?? null,
      mentionedUserIds: options.mentionedUserIds ?? [],
      globalBroadcastId: options.globalBroadcastId ?? null,
      parentMessageId: options.parentMessageId ?? null,
    },
    include: includeUser,
  })
  const withUser = created as typeof created & {
    user?: {
      id: string
      username: string | null
      displayName: string | null
      email: string | null
      avatarUrl: string | null
      profile?: { avatarPreset?: string | null } | null
    }
  }
  const cm = (created as { metadata?: Record<string, unknown> }).metadata
  const inboundName = typeof cm?.discordAuthorName === 'string' ? cm.discordAuthorName : null
  const inboundAvatar =
    typeof cm?.discordAuthorAvatarUrl === 'string' ? cm.discordAuthorAvatarUrl : null
  const out: PlatformChatMessage = {
    id: created.id,
    threadId: `league:${leagueId}`,
    parentMessageId: created.parentMessageId ?? null,
    channelSource: created.source ?? null,
    senderUserId: withUser.user?.id ?? created.userId,
    senderName: inboundName || withUser.user?.displayName || withUser.user?.email || 'User',
    senderUsername: withUser.user?.username ?? null,
    senderAvatarUrl: inboundAvatar ?? withUser.user?.avatarUrl ?? null,
    senderAvatarPreset: withUser.user?.profile?.avatarPreset ?? null,
    messageType: created.type || 'text',
    body: created.message || '',
    createdAt: created.createdAt.toISOString(),
  }
  const cr = created as {
    imageUrl?: string | null
    metadata?: Record<string, unknown>
    isPrivate?: boolean
    visibleToUserId?: string | null
    messageSubtype?: string | null
    mentionedUserIds?: string[]
    globalBroadcastId?: string | null
  }
  if (
    created.imageUrl ||
    cr.metadata ||
    cr.isPrivate ||
    cr.messageSubtype ||
    cr.globalBroadcastId
  ) {
    const baseMeta = (cr.metadata ?? {}) as Record<string, unknown>
    out.metadata = {
      ...baseMeta,
      ...(created.imageUrl && { imageUrl: created.imageUrl }),
      lastActiveAt: created.createdAt.toISOString(),
      ...(cr.isPrivate ? { isPrivate: true } : {}),
      ...(cr.visibleToUserId ? { visibleToUserId: cr.visibleToUserId } : {}),
      ...(cr.messageSubtype ? { messageSubtype: cr.messageSubtype } : {}),
      ...(cr.mentionedUserIds?.length ? { mentionedUserIds: cr.mentionedUserIds } : {}),
      ...(cr.globalBroadcastId ? { globalBroadcastId: cr.globalBroadcastId } : {}),
    }
  }
  return out
}

export async function updateLeagueChatMessage(
  messageId: string,
  updates: { message?: string; metadata?: Record<string, unknown> }
): Promise<{ id: string } | null> {
  const data: { message?: string; metadata?: ReturnType<typeof toPrismaNullableJsonInput> } = {}
  if (typeof updates.message === 'string') data.message = updates.message
  if (updates.metadata && typeof updates.metadata === 'object') {
    data.metadata = toPrismaNullableJsonInput(updates.metadata)
  }
  if (!Object.keys(data).length) return null
  try {
    const row = await prisma.leagueChatMessage.update({
      where: { id: messageId },
      data,
      select: { id: true },
    })
    return row
  } catch {
    return null
  }
}
