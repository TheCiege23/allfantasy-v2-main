import { prisma } from '@/lib/prisma'
import type { PlatformChatMessage, PlatformChatThread } from '@/types/platform-shared'
import { getDefaultChatSport, resolveSportForChatRoom } from '@/lib/chat-core'

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString()
  return new Date(value).toISOString()
}

function toMessagePreview(messageType: string | null | undefined, body: string | null | undefined): string | null {
  const normalizedType = String(messageType || "text").toLowerCase()
  if (normalizedType === "image") return "Image"
  if (normalizedType === "gif") return "GIF"
  if (normalizedType === "video") return "Video"
  if (normalizedType === "meme") return "Meme"
  if (normalizedType === "poll") return "Poll"
  if (normalizedType === "pin") return "Pinned a message"
  if (normalizedType === "broadcast") return "Commissioner announcement"
  if (normalizedType === "draft_intel_intro") return "Chimmy draft intel connected"
  if (normalizedType === "draft_intel_queue") return "Chimmy updated your AI queue"
  if (normalizedType === "draft_intel_on_clock") return "Chimmy says you're on the clock"
  if (normalizedType === "draft_intel_recap") return "Chimmy posted your draft recap"
  const text = String(body || "").trim()
  if (!text) return null
  return text.length > 90 ? `${text.slice(0, 90)}…` : text
}

function isDraftIntelMetadata(metadata: unknown): metadata is Record<string, unknown> {
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      (metadata as Record<string, unknown>).draftIntelThread === true
  )
}

function resolveSystemSenderName(messageType: string | null | undefined, metadata?: unknown): string {
  const normalizedType = String(messageType || "text").toLowerCase()
  if (normalizedType.startsWith("draft_intel") || isDraftIntelMetadata(metadata)) {
    return "Chimmy AI"
  }
  return "System"
}

async function resolveUnreadCountForMember(
  appUserId: string,
  threadId: string,
  lastReadAt: Date | null | undefined,
  lastMessageAt: Date | null | undefined,
): Promise<number> {
  if (!lastMessageAt) return 0
  if (lastReadAt && new Date(lastReadAt).getTime() >= new Date(lastMessageAt).getTime()) return 0
  try {
    const count = await (prisma as any).platformChatMessage.count({
      where: {
        threadId,
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        NOT: { senderUserId: appUserId },
      },
    })
    return Math.max(0, Number(count || 0))
  } catch {
    return 0
  }
}

async function normalizeThread(row: any, memberRow: any, appUserId: string): Promise<PlatformChatThread> {
  const latestMessage = Array.isArray(row?.messages) ? row.messages[0] : null
  const latestMetadata =
    latestMessage?.metadata && typeof latestMessage.metadata === "object"
      ? (latestMessage.metadata as Record<string, unknown>)
      : null
  const isDraftIntelThread = row?.threadType === "ai" && isDraftIntelMetadata(latestMetadata)
  const otherDmMember =
    row?.threadType === "dm" && Array.isArray(row?.members)
      ? row.members.find((m: any) => m.userId !== appUserId && m.user)
      : null
  const dmTitle =
    otherDmMember?.user?.displayName ||
    otherDmMember?.user?.username ||
    otherDmMember?.user?.email ||
    "Direct message"
  const unreadCount = await resolveUnreadCountForMember(
    appUserId,
    row.id,
    memberRow?.lastReadAt ?? null,
    latestMessage?.createdAt ?? row?.lastMessageAt ?? null,
  )
  return {
    id: row.id,
    threadType: row.threadType,
    productType: row.productType,
    title:
      row.title ||
      (isDraftIntelThread
        ? "Chimmy Draft Intel"
        : row.threadType === "dm"
          ? dmTitle
          : row.threadType === "ai"
            ? "Chimmy AI"
            : "Chat Thread"),
    lastMessageAt: toIso(row.lastMessageAt),
    unreadCount,
    memberCount: Number(row?._count?.members || 0),
    context: {
      createdByUserId: row.createdByUserId || null,
      isMuted: Boolean(memberRow?.isMuted),
      lastReadAt: memberRow?.lastReadAt ? toIso(memberRow.lastReadAt) : null,
      lastMessagePreview: toMessagePreview(latestMessage?.messageType, latestMessage?.body),
      lastMessageType: latestMessage?.messageType || null,
      otherUserId: otherDmMember?.user?.id || null,
      otherUsername: otherDmMember?.user?.username || null,
      otherDisplayName: otherDmMember?.user?.displayName || null,
      showInDmList: isDraftIntelThread,
      verifiedBadge: isDraftIntelThread || latestMetadata?.verifiedBadge === true,
      botLabel:
        typeof latestMetadata?.botLabel === "string"
          ? latestMetadata.botLabel
          : isDraftIntelThread
            ? "Chimmy AI"
            : null,
      archived: latestMetadata?.archived === true,
      allowReplies: latestMetadata?.allowReplies !== false,
      readOnlyFeed: latestMetadata?.readOnlyFeed === true,
      leagueId: typeof latestMetadata?.leagueId === "string" ? latestMetadata.leagueId : null,
      leagueName: typeof latestMetadata?.leagueName === "string" ? latestMetadata.leagueName : null,
      sport: typeof latestMetadata?.sport === "string" ? latestMetadata.sport : null,
    },
  }
}

async function getUnifiedThreads(appUserId: string): Promise<PlatformChatThread[] | null> {
  try {
    const rows = await (prisma as any).platformChatThreadMember.findMany({
      where: { userId: appUserId, isBlocked: false },
      include: {
        thread: {
          include: {
            _count: { select: { members: true } },
            members: {
              select: {
                userId: true,
                user: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    email: true,
                  },
                },
              },
            },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                createdAt: true,
                messageType: true,
                body: true,
                metadata: true,
              },
            },
          },
        },
      },
      orderBy: { thread: { lastMessageAt: 'desc' } },
      take: 100,
    })

    return Promise.all(rows.map((m: any) => normalizeThread(m.thread, m, appUserId)))
  } catch {
    return null
  }
}

async function getLegacyFallbackThreads(appUserId: string): Promise<PlatformChatThread[]> {
  const [leagueMemberships, aiConversations] = await Promise.all([
    (prisma as any).bracketLeagueMember
      .findMany({
        where: { userId: appUserId },
        include: {
          league: {
            select: {
              id: true,
              name: true,
              updatedAt: true,
              tournament: {
                select: {
                  sport: true,
                },
              },
              _count: { select: { members: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      .catch(() => []),
    (prisma as any).chatConversation
      .findMany({
        where: { userId: appUserId },
        orderBy: { lastMessageAt: 'desc' },
        take: 40,
        select: {
          id: true,
          title: true,
          messageCount: true,
          lastMessageAt: true,
        },
      })
      .catch(() => []),
  ])

  const leagueThreads: PlatformChatThread[] = leagueMemberships.map((m: any) => {
    const sport =
      resolveSportForChatRoom({ sport: m?.league?.tournament?.sport ?? null }) ?? getDefaultChatSport()
    return {
      id: `league:${m.league.id}`,
      threadType: 'league',
      productType: 'app',
      title: m.league.name || 'League Chat',
      lastMessageAt: toIso(m.league.updatedAt),
      unreadCount: 0,
      memberCount: Number(m.league?._count?.members || 0),
      context: { leagueId: m.league.id, sport },
    }
  })

  const aiThreads: PlatformChatThread[] = aiConversations.map((c: any) => ({
    id: `ai:${c.id}`,
    threadType: 'ai',
    productType: 'legacy',
    title: c.title || 'AI Chat Session',
    lastMessageAt: toIso(c.lastMessageAt),
    unreadCount: 0,
    memberCount: 1,
    context: {
      conversationId: c.id,
      messageCount: Number(c.messageCount || 0),
      sport: getDefaultChatSport(),
    },
  }))

  return [...leagueThreads, ...aiThreads].sort(
    (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
  )
}

export async function getPlatformChatThreads(appUserId: string): Promise<PlatformChatThread[]> {
  const unified = await getUnifiedThreads(appUserId)
  if (unified) return unified
  return getLegacyFallbackThreads(appUserId)
}

export async function getPlatformThreadById(appUserId: string, threadId: string): Promise<PlatformChatThread | null> {
  try {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { userId: appUserId, threadId, isBlocked: false },
      include: {
        thread: {
          include: {
            _count: { select: { members: true } },
            members: {
              select: {
                userId: true,
                user: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    email: true,
                  },
                },
              },
            },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                createdAt: true,
                messageType: true,
                body: true,
                metadata: true,
              },
            },
          },
        },
      },
    })
    if (!member) return null
    return normalizeThread(member.thread, member, appUserId)
  } catch {
    return null
  }
}

export async function createPlatformThread(params: {
  creatorUserId: string
  threadType: 'dm' | 'group' | 'ai'
  productType?: 'shared' | 'app' | 'bracket' | 'legacy'
  title?: string
  memberUserIds?: string[]
}): Promise<PlatformChatThread | null> {
  const memberSet = new Set<string>([params.creatorUserId, ...((params.memberUserIds || []).filter(Boolean))])
  const members = Array.from(memberSet)

  if (params.threadType === 'dm') {
    if (members.length !== 2) return null

    try {
      const existing = await (prisma as any).platformChatThread.findFirst({
        where: {
          threadType: 'dm',
          members: {
            every: { userId: { in: members } },
          },
        },
        include: { _count: { select: { members: true } } },
      })

      if (existing && Number(existing?._count?.members || 0) === 2) {
        const found = await getPlatformThreadById(params.creatorUserId, existing.id)
        if (found) return found
      }
    } catch {
    }
  }

  try {
    const created = await (prisma as any).platformChatThread.create({
      data: {
        threadType: params.threadType,
        productType: params.productType || 'shared',
        title: (params.title || '').trim() || null,
        createdByUserId: params.creatorUserId,
        members: {
          create: members.map((userId) => ({
            userId,
            role: userId === params.creatorUserId ? 'owner' : 'member',
            joinedAt: new Date(),
          })),
        },
      },
      include: { _count: { select: { members: true } } },
    })

    const hydrated = await getPlatformThreadById(params.creatorUserId, created.id)
    if (hydrated) return hydrated
    return {
      id: created.id,
      threadType: created.threadType,
      productType: created.productType,
      title: created.title || "Chat Thread",
      lastMessageAt: toIso(created.lastMessageAt),
      unreadCount: 0,
      memberCount: Number(created?._count?.members || 0),
      context: { createdByUserId: created.createdByUserId || null },
    }
  } catch {
    return null
  }
}

export async function getPlatformThreadMessages(
  appUserId: string,
  threadId: string,
  limit = 50,
): Promise<PlatformChatMessage[]> {
  const take = Math.max(1, Math.min(limit, 100))

  try {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { threadId, userId: appUserId, isBlocked: false },
      select: { id: true },
    })

    if (!member) return []

    const rows = await (prisma as any).platformChatMessage.findMany({
      where: {
        threadId,
        OR: [{ isPrivate: false }, { isPrivate: true, visibleToUserId: appUserId }],
      },
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
            username: true,
            email: true,
            avatarUrl: true,
            profile: { select: { avatarPreset: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take,
    })

    await (prisma as any).platformChatThreadMember.updateMany({
      where: { threadId, userId: appUserId },
      data: { lastReadAt: new Date() },
    })

    const visible = rows.filter((r: any) => !(r.metadata as Record<string, unknown>)?.hiddenByMod)
    return visible.reverse().map((msg: any) => {
      const baseMeta =
        msg.metadata && typeof msg.metadata === 'object' && !Array.isArray(msg.metadata)
          ? { ...(msg.metadata as Record<string, unknown>) }
          : {}
      const isDeleted = Boolean(baseMeta.deletedAt)
      if (msg.isPrivate) baseMeta.isPrivate = true
      if (msg.visibleToUserId) baseMeta.visibleToUserId = msg.visibleToUserId
      if (msg.messageSubtype) baseMeta.messageSubtype = msg.messageSubtype
      return {
        id: msg.id,
        threadId,
        senderUserId: msg.senderUserId || null,
        senderName:
          msg.sender?.displayName ||
          msg.sender?.username ||
          msg.sender?.email ||
          resolveSystemSenderName(msg.messageType, msg.metadata),
        senderUsername: msg.sender?.username || null,
        senderAvatarUrl: msg.sender?.avatarUrl ?? null,
        senderAvatarPreset: msg.sender?.profile?.avatarPreset ?? null,
        messageType: msg.messageType || 'text',
        body: isDeleted ? '[message deleted]' : msg.body || '',
        createdAt: toIso(msg.createdAt),
        metadata: Object.keys(baseMeta).length ? baseMeta : undefined,
      }
    })
  } catch {
    return []
  }
}

export async function searchPlatformThreadMessages(
  appUserId: string,
  threadId: string,
  query: string,
  limit = 25,
): Promise<PlatformChatMessage[]> {
  const q = String(query || '').trim()
  if (!q) return []
  const take = Math.max(1, Math.min(limit, 50))
  try {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { threadId, userId: appUserId, isBlocked: false },
      select: { id: true },
    })
    if (!member) return []

    const rows = await (prisma as any).platformChatMessage.findMany({
      where: {
        threadId,
        body: { contains: q, mode: 'insensitive' },
        OR: [{ isPrivate: false }, { isPrivate: true, visibleToUserId: appUserId }],
      },
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
            username: true,
            email: true,
            avatarUrl: true,
            profile: { select: { avatarPreset: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take,
    })

    return rows.reverse().map((msg: any) => {
      const baseMeta =
        msg.metadata && typeof msg.metadata === 'object' && !Array.isArray(msg.metadata)
          ? { ...(msg.metadata as Record<string, unknown>) }
          : {}
      const isDeleted = Boolean(baseMeta.deletedAt)
      if (msg.isPrivate) baseMeta.isPrivate = true
      if (msg.visibleToUserId) baseMeta.visibleToUserId = msg.visibleToUserId
      if (msg.messageSubtype) baseMeta.messageSubtype = msg.messageSubtype
      return {
        id: msg.id,
        threadId,
        senderUserId: msg.senderUserId || null,
        senderName:
          msg.sender?.displayName ||
          msg.sender?.username ||
          msg.sender?.email ||
          resolveSystemSenderName(msg.messageType, msg.metadata),
        senderUsername: msg.sender?.username || null,
        senderAvatarUrl: msg.sender?.avatarUrl ?? null,
        senderAvatarPreset: msg.sender?.profile?.avatarPreset ?? null,
        messageType: msg.messageType || 'text',
        body: isDeleted ? '[message deleted]' : msg.body || '',
        createdAt: toIso(msg.createdAt),
        metadata: Object.keys(baseMeta).length ? baseMeta : undefined,
      }
    })
  } catch {
    return []
  }
}

export async function getThreadReadReceipts(
  appUserId: string,
  threadId: string,
): Promise<Array<{ userId: string; username: string | null; displayName: string | null; lastReadAt: string | null }>> {
  try {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { threadId, userId: appUserId, isBlocked: false },
      select: { id: true },
    })
    if (!member) return []

    const rows = await (prisma as any).platformChatThreadMember.findMany({
      where: { threadId, isBlocked: false },
      include: {
        user: { select: { id: true, username: true, displayName: true } },
      },
      orderBy: { joinedAt: 'asc' },
      take: 100,
    })

    return rows
      .filter((row: any) => Boolean(row?.user?.id))
      .map((row: any) => ({
        userId: row.user.id,
        username: row.user.username ?? null,
        displayName: row.user.displayName ?? null,
        lastReadAt: row.lastReadAt ? toIso(row.lastReadAt) : null,
      }))
  } catch {
    return []
  }
}

export async function markPlatformThreadRead(appUserId: string, threadId: string): Promise<boolean> {
  try {
    const result = await (prisma as any).platformChatThreadMember.updateMany({
      where: { threadId, userId: appUserId, isBlocked: false },
      data: { lastReadAt: new Date() },
    })
    return Number(result?.count ?? 0) > 0
  } catch {
    return false
  }
}

export async function editPlatformThreadMessage(
  appUserId: string,
  threadId: string,
  messageId: string,
  body: string,
): Promise<PlatformChatMessage | null> {
  const content = String(body || '').trim()
  if (!content) return null
  try {
    const existing = await (prisma as any).platformChatMessage.findFirst({
      where: { id: messageId, threadId, senderUserId: appUserId },
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
            username: true,
            email: true,
            avatarUrl: true,
            profile: { select: { avatarPreset: true } },
          },
        },
      },
    })
    if (!existing) return null
    const meta =
      existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
        ? { ...(existing.metadata as Record<string, unknown>) }
        : {}
    if (meta.deletedAt) return null

    const updated = await (prisma as any).platformChatMessage.update({
      where: { id: messageId },
      data: {
        body: content,
        metadata: {
          ...meta,
          editedAt: new Date().toISOString(),
          editedByUserId: appUserId,
        },
        updatedAt: new Date(),
      },
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
            username: true,
            email: true,
            avatarUrl: true,
            profile: { select: { avatarPreset: true } },
          },
        },
      },
    })

    return {
      id: updated.id,
      threadId,
      senderUserId: updated.senderUserId || null,
      senderName: updated.sender?.displayName || updated.sender?.username || updated.sender?.email || 'User',
      senderUsername: updated.sender?.username || null,
      senderAvatarUrl: updated.sender?.avatarUrl ?? null,
      senderAvatarPreset: updated.sender?.profile?.avatarPreset ?? null,
      messageType: updated.messageType || 'text',
      body: updated.body || '',
      createdAt: toIso(updated.createdAt),
      metadata: updated.metadata || undefined,
    }
  } catch {
    return null
  }
}

export async function deletePlatformThreadMessage(
  appUserId: string,
  threadId: string,
  messageId: string,
): Promise<boolean> {
  try {
    const existing = await (prisma as any).platformChatMessage.findFirst({
      where: { id: messageId, threadId, senderUserId: appUserId },
      select: { id: true, metadata: true },
    })
    if (!existing) return false
    const meta =
      existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
        ? { ...(existing.metadata as Record<string, unknown>) }
        : {}
    if (meta.deletedAt) return true

    await (prisma as any).platformChatMessage.update({
      where: { id: messageId },
      data: {
        body: '[message deleted]',
        metadata: {
          ...meta,
          deletedAt: new Date().toISOString(),
          deletedByUserId: appUserId,
        },
        updatedAt: new Date(),
      },
    })
    return true
  } catch {
    return false
  }
}

/** Soft-hide a message for moderation (commissioner). */
export async function setMessageHiddenByMod(
  threadId: string,
  messageId: string,
  hidden: boolean,
): Promise<boolean> {
  try {
    const msg = await (prisma as any).platformChatMessage.findFirst({
      where: { id: messageId, threadId },
      select: { id: true, metadata: true },
    })
    if (!msg) return false
    const meta = (msg.metadata as Record<string, unknown>) || {}
    await (prisma as any).platformChatMessage.update({
      where: { id: messageId },
      data: { metadata: { ...meta, hiddenByMod: hidden }, updatedAt: new Date() },
    })
    return true
  } catch {
    return false
  }
}

export async function createPlatformThreadMessage(
  appUserId: string,
  threadId: string,
  body: string,
  messageType = 'text',
  metadata?: Record<string, unknown> | null,
  /*
   * Set to hide the row from everyone but one member. The columns have always
   * existed and the read path has always honoured them
   * (`isPrivate: false OR visibleToUserId = me`); nothing had ever written
   * them on a platform thread, so a private @chimmy exchange in a huddle had
   * no way to stay private.
   */
  visibility?: { visibleToUserId?: string | null; messageSubtype?: string | null },
): Promise<PlatformChatMessage | null> {
  const content = String(body || '').trim()
  if (!content) return null

  try {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { threadId, userId: appUserId, isBlocked: false },
      include: { thread: { select: { id: true } } },
    })

    if (!member?.thread?.id) return null

    const created = await (prisma as any).$transaction(async (tx: any) => {
      const msg = await tx.platformChatMessage.create({
        data: {
          threadId,
          senderUserId: appUserId,
          messageType,
          body: content,
          metadata: metadata ?? undefined,
          ...(visibility?.visibleToUserId
            ? {
                isPrivate: true,
                visibleToUserId: visibility.visibleToUserId,
                messageSubtype: visibility.messageSubtype ?? null,
              }
            : {}),
        },
        include: {
          sender: {
            select: {
              id: true,
              displayName: true,
              username: true,
              email: true,
              avatarUrl: true,
              profile: { select: { avatarPreset: true } },
            },
          },
        },
      })

      await tx.platformChatThread.update({
        where: { id: threadId },
        data: { lastMessageAt: new Date() },
      })

      await tx.platformChatThreadMember.updateMany({
        where: { threadId, userId: appUserId },
        data: { lastReadAt: new Date() },
      })

      return msg
    })

    return {
      id: created.id,
      threadId,
      senderUserId: created.senderUserId || null,
      senderName: created.sender?.displayName || created.sender?.username || created.sender?.email || 'User',
      senderUsername: created.sender?.username || null,
      senderAvatarUrl: created.sender?.avatarUrl ?? null,
      senderAvatarPreset: created.sender?.profile?.avatarPreset ?? null,
      messageType: created.messageType || 'text',
      body: created.body || '',
      createdAt: toIso(created.createdAt),
      metadata: created.metadata || undefined,
    }
  } catch {
    return null
  }
}

export async function createPlatformThreadTypedMessage(
  appUserId: string,
  threadId: string,
  messageType: string,
  payload: unknown,
  metadata?: Record<string, unknown> | null,
): Promise<PlatformChatMessage | null> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return createPlatformThreadMessage(appUserId, threadId, body, messageType, metadata)
}

export async function addReactionToMessage(
  appUserId: string,
  threadId: string,
  messageId: string,
  emoji: string,
): Promise<boolean> {
  const emojiTrim = String(emoji || '').trim().slice(0, 10)
  if (!emojiTrim) return false
  try {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { threadId, userId: appUserId, isBlocked: false },
      select: { id: true },
    })
    if (!member) return false

    const msg = await (prisma as any).platformChatMessage.findFirst({
      where: { id: messageId, threadId },
      select: { id: true, metadata: true },
    })
    if (!msg) return false

    const meta = (msg.metadata as Record<string, unknown> | null) || {}
    const reactions: Array<{ emoji: string; count: number; userIds?: string[] }> = Array.isArray(meta.reactions)
      ? (meta.reactions as Array<{ emoji: string; count: number; userIds?: string[] }>)
      : []
    let found = false
    for (const r of reactions) {
      if (r.emoji === emojiTrim) {
        const ids = Array.isArray(r.userIds) ? r.userIds : []
        if (!ids.includes(appUserId)) {
          ids.push(appUserId)
          r.count = ids.length
          r.userIds = ids
        }
        found = true
        break
      }
    }
    if (!found) reactions.push({ emoji: emojiTrim, count: 1, userIds: [appUserId] })

    await (prisma as any).platformChatMessage.update({
      where: { id: messageId },
      data: { metadata: { ...meta, reactions }, updatedAt: new Date() },
    })
    return true
  } catch {
    return false
  }
}

export async function removeReactionFromMessage(
  appUserId: string,
  threadId: string,
  messageId: string,
  emoji: string,
): Promise<boolean> {
  const emojiTrim = String(emoji || '').trim().slice(0, 10)
  if (!emojiTrim) return false
  try {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { threadId, userId: appUserId, isBlocked: false },
      select: { id: true },
    })
    if (!member) return false

    const msg = await (prisma as any).platformChatMessage.findFirst({
      where: { id: messageId, threadId },
      select: { id: true, metadata: true },
    })
    if (!msg) return false

    const meta = (msg.metadata as Record<string, unknown> | null) || {}
    let reactions: Array<{ emoji: string; count: number; userIds?: string[] }> = Array.isArray(meta.reactions)
      ? (meta.reactions as Array<{ emoji: string; count: number; userIds?: string[] }>)
      : []
    reactions = reactions
      .map((r) => {
        if (r.emoji !== emojiTrim) return r
        const ids = Array.isArray(r.userIds) ? r.userIds.filter((id) => id !== appUserId) : []
        if (ids.length === 0) return null
        return { ...r, userIds: ids, count: ids.length }
      })
      .filter((r): r is { emoji: string; count: number; userIds?: string[] } => r !== null)

    await (prisma as any).platformChatMessage.update({
      where: { id: messageId },
      data: { metadata: { ...meta, reactions }, updatedAt: new Date() },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Create a system message (no sender). Used for waiver_bot, broadcast, etc. Internal/cron only.
 */
export async function createSystemMessage(
  threadId: string,
  messageType: string,
  body: string,
  metadata?: Record<string, unknown> | null,
  /** As above: set to keep a system reply visible to one member only. */
  visibility?: { visibleToUserId?: string | null; messageSubtype?: string | null },
): Promise<PlatformChatMessage | null> {
  const content = String(body || '').trim()
  if (!content) return null
  try {
    const created = await (prisma as any).platformChatMessage.create({
      data: {
        threadId,
        senderUserId: null,
        messageType: messageType || 'text',
        body: content,
        metadata: metadata ?? undefined,
        ...(visibility?.visibleToUserId
          ? {
              isPrivate: true,
              visibleToUserId: visibility.visibleToUserId,
              messageSubtype: visibility.messageSubtype ?? null,
            }
          : {}),
      },
    })
    await (prisma as any).platformChatThread.update({
      where: { id: threadId },
      data: { lastMessageAt: new Date() },
    })
    return {
      id: created.id,
      threadId,
      senderUserId: null,
      senderName: resolveSystemSenderName(created.messageType, created.metadata),
      messageType: created.messageType || 'text',
      body: created.body || '',
      createdAt: toIso(created.createdAt),
      metadata: created.metadata || undefined,
    }
  } catch {
    return null
  }
}

/**
 * Record a poll vote. One vote per user; voting again overwrites.
 * Body must be JSON { question, options, votes?: { [optionIndex]: userId[] } }.
 */
export async function votePollMessage(
  appUserId: string,
  threadId: string,
  messageId: string,
  optionIndex: number,
): Promise<boolean> {
  try {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { threadId, userId: appUserId, isBlocked: false },
      select: { id: true },
    })
    if (!member) return false

    const msg = await (prisma as any).platformChatMessage.findFirst({
      where: { id: messageId, threadId, messageType: 'poll' },
      select: { id: true, body: true },
    })
    if (!msg?.body) return false

    let payload: { question?: string; options?: string[]; votes?: Record<string, string[]>; closed?: boolean } = {}
    try {
      payload = typeof msg.body === 'string' ? JSON.parse(msg.body) : msg.body
    } catch {
      return false
    }
    if (payload.closed) return false
    const options = Array.isArray(payload.options) ? payload.options : []
    if (optionIndex < 0 || optionIndex >= options.length) return false

    const votes: Record<string, string[]> = typeof payload.votes === 'object' && payload.votes !== null
      ? { ...payload.votes }
      : {}
    const key = String(optionIndex)
    for (const k of Object.keys(votes)) {
      votes[k] = (votes[k] || []).filter((id) => id !== appUserId)
    }
    if (!votes[key]) votes[key] = []
    if (!votes[key].includes(appUserId)) votes[key].push(appUserId)

    const newBody = JSON.stringify({ ...payload, votes })
    await (prisma as any).platformChatMessage.update({
      where: { id: messageId },
      data: { body: newBody, updatedAt: new Date() },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Close (resolve) a poll so no more votes can be cast. Caller must be thread member.
 */
export async function closePollMessage(
  appUserId: string,
  threadId: string,
  messageId: string,
): Promise<boolean> {
  try {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { threadId, userId: appUserId, isBlocked: false },
      select: { id: true },
    })
    if (!member) return false

    const msg = await (prisma as any).platformChatMessage.findFirst({
      where: { id: messageId, threadId, messageType: 'poll' },
      select: { id: true, body: true },
    })
    if (!msg?.body) return false

    let payload: Record<string, unknown> = {}
    try {
      payload = typeof msg.body === 'string' ? JSON.parse(msg.body) : msg.body
    } catch {
      return false
    }
    const newBody = JSON.stringify({ ...payload, closed: true })
    await (prisma as any).platformChatMessage.update({
      where: { id: messageId },
      data: { body: newBody, updatedAt: new Date() },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Delete a pin-type message (unpin). Caller must be thread member. Only messageType 'pin' can be deleted.
 */
export async function deletePinMessage(
  appUserId: string,
  threadId: string,
  pinMessageId: string,
): Promise<boolean> {
  try {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { threadId, userId: appUserId, isBlocked: false },
      select: { id: true },
    })
    if (!member) return false
    const msg = await (prisma as any).platformChatMessage.findFirst({
      where: { id: pinMessageId, threadId, messageType: 'pin' },
      select: { id: true },
    })
    if (!msg) return false
    await (prisma as any).platformChatMessage.delete({
      where: { id: pinMessageId },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Leave a thread (remove membership). Returns true if left.
 */
export async function leaveThread(appUserId: string, threadId: string): Promise<boolean> {
  try {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { threadId, userId: appUserId },
      select: { id: true },
    })
    if (!member) return false
    await (prisma as any).platformChatThreadMember.delete({
      where: { id: member.id },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Add participants to an existing group thread. Caller must be a member.
 */
export async function addThreadParticipants(
  appUserId: string,
  threadId: string,
  userIds: string[],
): Promise<boolean> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean))).filter((id) => id !== appUserId)
  if (uniqueIds.length === 0) return false

  try {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { threadId, userId: appUserId, isBlocked: false },
      include: { thread: { select: { id: true, threadType: true } } },
    })
    if (!member?.thread?.id || member.thread.threadType !== "group") return false

    const existing = await (prisma as any).platformChatThreadMember.findMany({
      where: { threadId, userId: { in: uniqueIds } },
      select: { userId: true, isBlocked: true },
    })
    const existingMap = new Map<string, { isBlocked: boolean }>(
      existing.map((entry: any) => [entry.userId as string, { isBlocked: Boolean(entry.isBlocked) }]),
    )

    for (const userId of uniqueIds) {
      const found = existingMap.get(userId)
      if (found) {
        if (found.isBlocked) {
          await (prisma as any).platformChatThreadMember.updateMany({
            where: { threadId, userId },
            data: { isBlocked: false, joinedAt: new Date() },
          })
        }
        continue
      }
      await (prisma as any).platformChatThreadMember.create({
        data: {
          threadId,
          userId,
          role: "member",
          joinedAt: new Date(),
        },
      })
    }

    await (prisma as any).platformChatThread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    })

    return true
  } catch {
    return false
  }
}

/**
 * Get thread members for mention suggestions. Caller must be a member. Returns id, username, displayName.
 */
export async function getThreadMembers(
  appUserId: string,
  threadId: string,
): Promise<Array<{ id: string; username: string; displayName: string | null }>> {
  try {
    const myMember = await prisma.platformChatThreadMember.findFirst({
      where: { threadId, userId: appUserId, isBlocked: false },
      select: { id: true },
    })
    if (!myMember) return []

    const rows = await prisma.platformChatThreadMember.findMany({
      where: { threadId, isBlocked: false },
      include: {
        user: { select: { id: true, username: true, displayName: true } },
      },
    })
    return rows
      .filter((m) => m.user?.id)
      .map((m) => ({
        id: m.user!.id,
        username: m.user!.username || m.user!.id,
        displayName: m.user!.displayName ?? null,
      }))
  } catch {
    return []
  }
}

/**
 * Update thread title (rename). Caller must be member. Only group threads typically allow rename.
 */
export async function updateThreadTitle(
  appUserId: string,
  threadId: string,
  title: string,
): Promise<boolean> {
  try {
    const member = await (prisma as any).platformChatThreadMember.findFirst({
      where: { threadId, userId: appUserId, isBlocked: false },
      include: { thread: { select: { threadType: true } } },
    })
    if (!member || member.thread?.threadType !== "group") return false
    await (prisma as any).platformChatThread.update({
      where: { id: threadId },
      data: { title: title.trim().slice(0, 100) || null, updatedAt: new Date() },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Create a system stats_bot message (no sender). Call from cron or internal only.
 */
export async function createStatsBotMessage(
  threadId: string,
  payload: {
    weekLabel: string
    bestTeam: string
    worstTeam: string
    bestPlayer: string
    winStreak: string
    lossStreak: string
  },
): Promise<PlatformChatMessage | null> {
  const body = JSON.stringify(payload)
  try {
    const created = await (prisma as any).platformChatMessage.create({
      data: {
        threadId,
        senderUserId: null,
        messageType: 'stats_bot',
        body,
      },
    })
    await (prisma as any).platformChatThread.update({
      where: { id: threadId },
      data: { lastMessageAt: new Date() },
    })
    return {
      id: created.id,
      threadId,
      senderUserId: null,
      senderName: 'Chat Stats Bot',
      messageType: 'stats_bot',
      body: created.body || '',
      createdAt: toIso(created.createdAt),
      metadata: created.metadata || undefined,
    }
  } catch {
    return null
  }
}

export async function blockUserInSharedThreads(
  requesterUserId: string,
  blockedUserId: string,
): Promise<number> {
  if (!requesterUserId || !blockedUserId || requesterUserId === blockedUserId) return 0

  try {
    const shared = await (prisma as any).platformChatThread.findMany({
      where: {
        threadType: "dm",
        members: {
          some: { userId: requesterUserId },
        },
        AND: [
          {
            members: {
              some: { userId: blockedUserId },
            },
          },
        ],
      },
      select: { id: true },
      take: 200,
    })

    if (!shared.length) return 0
    const threadIds = shared.map((t: { id: string }) => t.id)

    const result = await (prisma as any).platformChatThreadMember.updateMany({
      where: {
        threadId: { in: threadIds },
        userId: blockedUserId,
      },
      data: { isBlocked: true },
    })

    return Number(result?.count || 0)
  } catch {
    return 0
  }
}

export async function unblockUserInSharedThreads(
  requesterUserId: string,
  blockedUserId: string,
): Promise<number> {
  if (!requesterUserId || !blockedUserId || requesterUserId === blockedUserId) return 0

  try {
    const shared = await (prisma as any).platformChatThread.findMany({
      where: {
        threadType: "dm",
        members: {
          some: { userId: requesterUserId },
        },
        AND: [
          {
            members: {
              some: { userId: blockedUserId },
            },
          },
        ],
      },
      select: { id: true },
      take: 200,
    })

    if (!shared.length) return 0
    const threadIds = shared.map((t: { id: string }) => t.id)

    const result = await (prisma as any).platformChatThreadMember.updateMany({
      where: {
        threadId: { in: threadIds },
        userId: blockedUserId,
      },
      data: { isBlocked: false },
    })

    return Number(result?.count || 0)
  } catch {
    return 0
  }
}

export async function setThreadMuted(
  appUserId: string,
  threadId: string,
  muted: boolean,
): Promise<boolean> {
  try {
    const result = await (prisma as any).platformChatThreadMember.updateMany({
      where: { threadId, userId: appUserId },
      data: { isMuted: muted },
    })
    return Number(result?.count ?? 0) > 0
  } catch {
    return false
  }
}

export async function getBlockedUsers(requesterUserId: string): Promise<Array<{ userId: string; username: string | null; displayName: string | null }>> {
  if (!requesterUserId) return []

  try {
    const members = await (prisma as any).platformChatThreadMember.findMany({
      where: {
        isBlocked: true,
        thread: {
          members: {
            some: { userId: requesterUserId },
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
      take: 500,
    })

    const dedup = new Map<string, { userId: string; username: string | null; displayName: string | null }>()
    for (const member of members) {
      if (!member?.user?.id || member.user.id === requesterUserId) continue
      dedup.set(member.user.id, {
        userId: member.user.id,
        username: member.user.username || null,
        displayName: member.user.displayName || null,
      })
    }

    return Array.from(dedup.values())
  } catch {
    return []
  }
}
