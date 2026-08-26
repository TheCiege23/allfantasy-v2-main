import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import {
  createLeagueChatMessage,
  getLeagueChatMessages,
} from '@/lib/league-chat/LeagueChatMessageService'
import { syncOutboundLeagueChat } from '@/lib/discord/sync-outbound'
import { isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { getAccessibleBbChannels, type BigBrotherChannelKey } from '@/lib/big-brother/BigBrotherChatChannels'
import { processBigBrotherLeagueChatInput } from '@/lib/big-brother/chimmyCommandHandler'
import { processIdpLeagueChatInput } from '@/lib/idp/idpChimmyLeagueChat'
import { processDevyLeagueChatInput } from '@/lib/devy/devyChimmyLeagueChat'
import { processC2cLeagueChatInput } from '@/lib/c2c/c2cChimmyLeagueChat'
import { isChimmyPrivateMessage, parseAtMentions } from '@/lib/chat-core/mentionPrivacyFilter'
import { markViewingChat, readChatPresence } from '@/lib/chat-core/chatPresence'
import { generateChimmyPrivateReply } from '@/lib/chat-core/chimmyPrivateReply'
import { getLeagueMemberUserIds } from '@/lib/league-chat/leagueMemberIds'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'

function toStringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function gifUrlFromMetadata(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null
  const g = meta.gifUrl ?? meta.previewUrl ?? meta.imageUrl
  return typeof g === 'string' ? g : null
}

function readBbChannelKeyFromMetadata(metadata: Record<string, unknown> | undefined): BigBrotherChannelKey | null {
  const raw = metadata?.bbChannel
  if (raw === 'main' || raw === 'hoh_room' || raw === 'have_nots' || raw === 'jury' || raw === 'nominees') {
    return raw
  }
  return null
}

/*
 * Membership via lib/league-access — THE canonical predicate (owner,
 * RedraftLeagueMember, Roster.platformUserId, LeagueTeam.claimedByUserId).
 * The inline check this replaces accepted only owner + claimed teams, which
 * 403'd roster-backed members of imported leagues — the largest membership
 * population (see lib/league-access.ts). Strict superset of the old check:
 * non-members still get 403.
 */
async function canAccessLeague(leagueId: string, userId: string) {
  return (await resolveLeagueAccess(leagueId, userId)) != null
}

function createdAtToUnixMs(createdAt: string): number {
  const t = new Date(createdAt).getTime()
  return Number.isFinite(t) ? t : Date.now()
}

function toClientMessage(message: {
  id: string
  parentMessageId?: string | null
  senderUserId?: string | null
  senderName: string | null
  senderAvatarUrl: string | null
  body: string
  createdAt: string
  messageType?: string | null
  metadata?: Record<string, unknown> | null
}) {
  const authorName = message.senderName ?? 'Manager'
  const authorAvatarUrl = message.senderAvatarUrl ?? null
  const createdMs = createdAtToUnixMs(message.createdAt)
  return {
    id: message.id,
    parentMessageId: message.parentMessageId ?? null,
    authorId: message.senderUserId ?? '',
    authorName,
    authorAvatarUrl,
    /** Sleeper-style field names — pass through to clients */
    author_display_name: authorName,
    author_avatar: authorAvatarUrl,
    text: message.body,
    createdAt: message.createdAt,
    /** Unix timestamp in ms (Sleeper-compatible) */
    created: createdMs,
    messageType: message.messageType ?? 'text',
    metadata: message.metadata ?? null,
  }
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  }

  const allowed = await canAccessLeague(leagueId, userId)
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const bigBrotherLeague = await isBigBrotherLeague(leagueId)
  let selectedBbChannel: BigBrotherChannelKey | null = null
  if (bigBrotherLeague) {
    const requested = req.nextUrl.searchParams?.get('channel')?.trim()
    selectedBbChannel =
      requested === 'main' ||
      requested === 'hoh_room' ||
      requested === 'have_nots' ||
      requested === 'jury' ||
      requested === 'nominees'
        ? requested
        : 'main'

    const access = await getAccessibleBbChannels(leagueId, userId)
    const readable = new Set(access.filter((c) => c.canRead).map((c) => c.key))
    if (!readable.has(selectedBbChannel)) {
      return NextResponse.json({ error: 'Forbidden channel' }, { status: 403 })
    }
  }

  const limit = Math.min(Number(req.nextUrl.searchParams?.get('limit') || '50'), 100)
  const messages = await getLeagueChatMessages(leagueId, { limit, requestingUserId: userId })
  const filteredMessages =
    bigBrotherLeague && selectedBbChannel
      ? messages.filter((message) => {
          const metadata =
            message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
              ? (message.metadata as Record<string, unknown>)
              : undefined
          const channel = readBbChannelKeyFromMetadata(metadata) ?? 'main'
          return channel === selectedBbChannel
        })
      : messages

  /*
   * Presence beacon. Folded into the poll the drawer already makes rather than
   * given a route of its own — this repo is at the platform's route ceiling —
   * and deliberately after the access check, so viewing is only recorded for a
   * league the caller is actually allowed to read.
   *
   * Both calls are best-effort inside their own module. A chat that failed to
   * load because presence failed would be a worse product than a chat with no
   * presence strip.
   */
  const presenceScope = { kind: 'league' as const, id: leagueId }
  await markViewingChat(presenceScope, {
    userId,
    resolveName: async () => {
      const row = await prisma.appUser.findUnique({
        where: { id: userId },
        select: { displayName: true, username: true },
      })
      return row?.displayName || row?.username || null
    },
  })
  const presence = await readChatPresence(presenceScope)

  return NextResponse.json({
    /*
     * So the client can tell which reactions are the viewer's own. The stored
     * entry lists user ids and the drawer has never known who it is rendering
     * for; without this a reaction could be displayed but not un-done.
     */
    viewerUserId: userId,
    presence,
    messages: filteredMessages.map((message) =>
      toClientMessage({
        id: message.id,
        parentMessageId: message.parentMessageId ?? null,
        senderUserId: message.senderUserId ?? null,
        senderName: message.senderName ?? null,
        senderAvatarUrl: message.senderAvatarUrl ?? null,
        body: message.body,
        createdAt: message.createdAt,
        messageType: message.messageType ?? 'text',
        metadata: message.metadata ?? null,
      })
    ),
  })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const leagueId = toStringValue(body?.leagueId).trim()
  const message = toStringValue(body?.message).trim()
  const metadataRaw = body?.metadata
  const metadata =
    metadataRaw && typeof metadataRaw === 'object' && !Array.isArray(metadataRaw)
      ? (metadataRaw as Record<string, unknown>)
      : undefined

  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  }

  const metaStr = metadata ? JSON.stringify(metadata) : ''
  if (metaStr.length > 120_000) {
    return NextResponse.json({ error: 'Metadata too large' }, { status: 400 })
  }

  const hasRich =
    Boolean(metadata && Object.keys(metadata).length > 0) ||
    Boolean(toStringValue(body?.gifId)) ||
    Boolean(body?.poll) ||
    (Array.isArray(body?.attachments) && body.attachments.length > 0)

  if (!message && !hasRich) {
    return NextResponse.json({ error: 'message or media payload required' }, { status: 400 })
  }
  if (message.length > 1000) {
    return NextResponse.json({ error: 'Message too long' }, { status: 400 })
  }

  const allowed = await canAccessLeague(leagueId, userId)
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const bigBrotherLeague = await isBigBrotherLeague(leagueId)
  let selectedBbChannel: BigBrotherChannelKey | null = null
  if (bigBrotherLeague) {
    selectedBbChannel = readBbChannelKeyFromMetadata(metadata) ?? 'main'
    const access = await getAccessibleBbChannels(leagueId, userId)
    const writeable = new Set(access.filter((c) => c.canWrite).map((c) => c.key))
    if (!writeable.has(selectedBbChannel)) {
      return NextResponse.json({ error: 'Forbidden channel' }, { status: 403 })
    }
  }

  const persistedMetadata: Record<string, unknown> | undefined =
    metadata && Object.keys(metadata).length > 0 ? { ...metadata } : undefined

  const finalMetadata =
    bigBrotherLeague && selectedBbChannel
      ? { ...(persistedMetadata ?? {}), bbChannel: selectedBbChannel }
      : persistedMetadata

  let bbProcessed: Awaited<ReturnType<typeof processBigBrotherLeagueChatInput>> | null = null
  if (!hasRich && message.trim() && bigBrotherLeague) {
    bbProcessed = await processBigBrotherLeagueChatInput(leagueId, userId, message)
    if (bbProcessed.outcome === 'suppress_public') {
      return NextResponse.json({
        suppressed: true,
        privateChimmyNotice: bbProcessed.privateNotice,
      })
    }
  }

  let c2cProcessed: Awaited<ReturnType<typeof processC2cLeagueChatInput>> | null = null
  let devyProcessed: Awaited<ReturnType<typeof processDevyLeagueChatInput>> | null = null
  let idpProcessed: Awaited<ReturnType<typeof processIdpLeagueChatInput>> | null = null
  if (!hasRich && message.trim() && !bigBrotherLeague) {
    c2cProcessed = await processC2cLeagueChatInput(leagueId, userId, message)
    if (c2cProcessed?.outcome === 'suppress_public') {
      return NextResponse.json({
        suppressed: true,
        privateChimmyNotice: c2cProcessed.privateNotice,
      })
    }
  }
  if (!hasRich && message.trim() && !bigBrotherLeague && c2cProcessed === null) {
    devyProcessed = await processDevyLeagueChatInput(leagueId, userId, message)
    if (devyProcessed?.outcome === 'suppress_public') {
      return NextResponse.json({
        suppressed: true,
        privateChimmyNotice: devyProcessed.privateNotice,
      })
    }
  }
  if (!hasRich && message.trim() && !bigBrotherLeague && c2cProcessed === null && devyProcessed === null) {
    idpProcessed = await processIdpLeagueChatInput(leagueId, userId, message)
    if (idpProcessed?.outcome === 'suppress_public') {
      return NextResponse.json({
        suppressed: true,
        privateChimmyNotice: idpProcessed.privateNotice,
      })
    }
  }

  const wantsChimmyPrivateDm =
    !hasRich &&
    message.trim() &&
    isChimmyPrivateMessage(message) &&
    !(bbProcessed?.outcome === 'post_user_and_chimmy' && (bbProcessed.chimmyMessages?.length ?? 0) > 0) &&
    !(c2cProcessed?.outcome === 'post_user_and_chimmy' && (c2cProcessed.chimmyMessages?.length ?? 0) > 0) &&
    !(devyProcessed?.outcome === 'post_user_and_chimmy' && (devyProcessed.chimmyMessages?.length ?? 0) > 0) &&
    !(idpProcessed?.outcome === 'post_user_and_chimmy' && (idpProcessed.chimmyMessages?.length ?? 0) > 0)

  if (wantsChimmyPrivateDm) {
    const mentionParsed = parseAtMentions(message)
    const privateUserMsg = await createLeagueChatMessage(leagueId, userId, message, {
      metadata: finalMetadata,
      isPrivate: true,
      visibleToUserId: userId,
      messageSubtype: 'chimmy_private',
      mentionedUserIds: mentionParsed.userMentions,
    })
    if (!privateUserMsg) {
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
    }
    const replyText = await generateChimmyPrivateReply(message, leagueId)
    const leagueRow = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { userId: true },
    })
    const announcerId = leagueRow?.userId ?? userId
    const privateChimmyMsg = await createLeagueChatMessage(leagueId, announcerId, replyText, {
      type: 'system',
      isPrivate: true,
      visibleToUserId: userId,
      messageSubtype: 'chimmy_private',
      metadata: { isSystem: true, chimmyPrivateReply: true },
    })

    return NextResponse.json({
      message: toClientMessage({
        id: privateUserMsg.id,
        senderUserId: privateUserMsg.senderUserId ?? null,
        senderName: privateUserMsg.senderName ?? 'Manager',
        senderAvatarUrl: privateUserMsg.senderAvatarUrl ?? null,
        body: privateUserMsg.body,
        createdAt: privateUserMsg.createdAt,
        messageType: privateUserMsg.messageType ?? 'text',
        metadata: privateUserMsg.metadata ?? null,
      }),
      extraMessages: privateChimmyMsg
        ? [
            toClientMessage({
              id: privateChimmyMsg.id,
              senderUserId: privateChimmyMsg.senderUserId ?? null,
              senderName: privateChimmyMsg.senderName ?? 'Chimmy',
              senderAvatarUrl: privateChimmyMsg.senderAvatarUrl ?? null,
              body: privateChimmyMsg.body,
              createdAt: privateChimmyMsg.createdAt,
              messageType: privateChimmyMsg.messageType ?? 'text',
              metadata: privateChimmyMsg.metadata ?? null,
            }),
          ]
        : [],
    })
  }

  const bodyText =
    message ||
    (metadata?.gifUrl || metadata?.giphyId || metadata?.gifId ? '🎬 GIF' : '') ||
    (metadata?.poll ? '📊 Poll' : '') ||
    (metadata?.attachments ? '📎 Media' : '') ||
    '[Media]'

  const mentionInfo = parseAtMentions(message)
  /*
   * The column and the service option have both existed the whole time; this
   * route simply never read the field off the body, so a reply sent from the
   * comms drawer was stored as a top-level message.
   */
  const parentMessageId =
    typeof body?.parentMessageId === 'string' && body.parentMessageId.trim().length > 0
      ? body.parentMessageId.trim()
      : undefined

  const created = await createLeagueChatMessage(leagueId, userId, bodyText, {
    metadata: finalMetadata,
    messageSubtype: mentionInfo.hasAll ? 'at_all' : null,
    mentionedUserIds: mentionInfo.userMentions,
    parentMessageId,
  })
  if (!created) {
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }

  const chimmyBatch =
    bbProcessed?.outcome === 'post_user_and_chimmy' && bbProcessed.chimmyMessages.length > 0
      ? bbProcessed.chimmyMessages
      : c2cProcessed?.outcome === 'post_user_and_chimmy' && c2cProcessed.chimmyMessages.length > 0
        ? c2cProcessed.chimmyMessages
        : devyProcessed?.outcome === 'post_user_and_chimmy' && devyProcessed.chimmyMessages.length > 0
          ? devyProcessed.chimmyMessages
          : idpProcessed?.outcome === 'post_user_and_chimmy' && idpProcessed.chimmyMessages.length > 0
            ? idpProcessed.chimmyMessages
            : []

  const extraMessages: ReturnType<typeof toClientMessage>[] = []
  if (chimmyBatch.length > 0) {
    const leagueRow = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { userId: true },
    })
    const announcerId = leagueRow?.userId
    if (announcerId) {
      for (const chimmy of chimmyBatch) {
        const row = await createLeagueChatMessage(leagueId, announcerId, chimmy.text, {
          type: 'system',
          metadata: {
            isSystem: true,
            chimmy: true,
            ...(bbProcessed?.outcome === 'post_user_and_chimmy' ? { bigBrother: true } : {}),
            ...(c2cProcessed?.outcome === 'post_user_and_chimmy' ? { c2c: true } : {}),
            ...(devyProcessed?.outcome === 'post_user_and_chimmy' ? { devy: true } : {}),
            ...(idpProcessed?.outcome === 'post_user_and_chimmy' ? { idp: true } : {}),
            ...(bigBrotherLeague && selectedBbChannel ? { bbChannel: selectedBbChannel } : {}),
            ...(chimmy.metadata ?? {}),
          },
        })
        if (row) {
          extraMessages.push(
            toClientMessage({
              id: row.id,
              senderUserId: row.senderUserId ?? null,
              senderName: row.senderName ?? 'AllFantasy',
              senderAvatarUrl: row.senderAvatarUrl ?? null,
              body: row.body,
              createdAt: row.createdAt,
              messageType: row.messageType ?? 'text',
              metadata: row.metadata ?? null,
            })
          )
        }
      }
    }
  }

  void syncOutboundLeagueChat({
    leagueId,
    messageId: created.id,
    authorName: created.senderName ?? 'Manager',
    authorAvatarUrl: created.senderAvatarUrl ?? null,
    text: created.body,
    gifUrl: gifUrlFromMetadata(metadata),
  }).catch(() => {})

  if (mentionInfo.hasAll) {
    const sender = await prisma.appUser.findUnique({
      where: { id: userId },
      select: { displayName: true, username: true, email: true },
    })
    const senderName = sender?.displayName || sender?.username || sender?.email || 'Someone'
    void getLeagueMemberUserIds(leagueId).then((ids) => {
      const targets = ids.filter((id) => id !== userId)
      if (targets.length === 0) return
      return dispatchNotification({
        userIds: targets,
        category: 'league_announcements',
        productType: 'app',
        type: 'at_all',
        title: '@all in league chat',
        body: `${senderName} mentioned everyone in the league chat.`,
        severity: 'low',
        actionHref: `/league/${encodeURIComponent(leagueId)}`,
        actionLabel: 'Open chat',
        meta: { leagueId, messageId: created.id },
      })
    })
  }

  return NextResponse.json({
    message: toClientMessage({
      id: created.id,
      senderUserId: created.senderUserId ?? null,
      senderName: created.senderName ?? 'Manager',
      senderAvatarUrl: created.senderAvatarUrl ?? null,
      body: created.body,
      createdAt: created.createdAt,
      messageType: created.messageType ?? 'text',
      metadata: created.metadata ?? null,
    }),
    ...(extraMessages.length > 0 ? { extraMessages } : {}),
  })
}

