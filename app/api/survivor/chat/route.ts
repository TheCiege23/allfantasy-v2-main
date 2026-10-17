import { canSeeSurvivorChannel, resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember, assertLeagueCommissioner } from '@/lib/league/league-access'
import { canSendToChannel } from '@/lib/survivor/chatPermissionGuard'
import { publishSurvivorRedraftEvent } from '@/lib/survivor/survivorRedraftStreamHub'

export const dynamic = 'force-dynamic'

async function getUserDisplayName(userId: string): Promise<string> {
  const u = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { displayName: true, username: true },
  })
  return u?.displayName?.trim() || u?.username || 'Player'
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams?.get('channelId')?.trim()
  const before = req.nextUrl.searchParams?.get('before')
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams?.get('limit')) || 50))
  if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

  const channel = await prisma.survivorChatChannel.findFirst({ where: { id: channelId } })
  if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gate = await assertLeagueMember(channel.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const access = await resolveSurvivorAccessContext(channel.leagueId, userId)
  if (!access?.isLeagueMember || !canSeeSurvivorChannel(access, channel)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const where: {
    channelId: string
    createdAt?: { lt: Date }
  } = { channelId }
  if (before) {
    const d = new Date(before)
    if (!Number.isNaN(d.getTime())) where.createdAt = { lt: d }
  }

  const messages = await prisma.survivorChatMessage.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { reactions: true },
  })

  return NextResponse.json({ messages })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const intent = typeof body.intent === 'string' ? body.intent : 'send'

  if (intent === 'react') {
    const messageId = typeof body.messageId === 'string' ? body.messageId : ''
    const emoji = typeof body.emoji === 'string' ? body.emoji : ''
    if (!messageId || !emoji) return NextResponse.json({ error: 'messageId and emoji required' }, { status: 400 })
    const msg = await prisma.survivorChatMessage.findFirst({ where: { id: messageId } })
    if (!msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const gate = await assertLeagueMember(msg.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
    const sendCheck = await canSendToChannel(msg.leagueId, userId, msg.channelId)
    if (!sendCheck.allowed) return NextResponse.json({ error: sendCheck.reason }, { status: 403 })
    const existing = await prisma.survivorChatReaction.findFirst({
      where: { messageId, userId, emoji },
    })
    const row =
      existing ??
      (await prisma.survivorChatReaction.create({
        data: { messageId, userId, emoji },
      }))
    const season = await prisma.redraftSeason.findFirst({
      where: { leagueId: msg.leagueId },
      orderBy: { createdAt: 'desc' },
    })
    if (season) {
      publishSurvivorRedraftEvent(season.id, {
        type: 'chat_reaction',
        messageId,
        emoji,
        leagueId: msg.leagueId,
      })
    }
    return NextResponse.json({ reaction: row })
  }

  if (intent === 'pin') {
    const messageId = typeof body.messageId === 'string' ? body.messageId : ''
    if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })
    const msg = await prisma.survivorChatMessage.findFirst({ where: { id: messageId } })
    if (!msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const comm = await assertLeagueCommissioner(msg.leagueId, userId)
    if (!comm.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const channel = await prisma.survivorChatChannel.findFirst({ where: { id: msg.channelId, leagueId: msg.leagueId } })
    const access = await resolveSurvivorAccessContext(msg.leagueId, userId)
    if (!channel || !access?.isLeagueMember || !canSeeSurvivorChannel(access, channel)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const updated = await prisma.survivorChatMessage.update({
      where: { id: messageId },
      data: { isPinned: true, pinnedAt: new Date(), pinnedBy: userId },
    })
    const season = await prisma.redraftSeason.findFirst({
      where: { leagueId: msg.leagueId },
      orderBy: { createdAt: 'desc' },
    })
    if (season) {
      publishSurvivorRedraftEvent(season.id, {
        type: 'message_pinned',
        channelId: msg.channelId,
        messageId,
        leagueId: msg.leagueId,
      })
    }
    return NextResponse.json({ message: updated })
  }

  const channelId = typeof body.channelId === 'string' ? body.channelId : ''
  const content = typeof body.content === 'string' ? body.content : ''
  const contentType = typeof body.contentType === 'string' ? body.contentType : 'text'
  const cardData = typeof body.cardData === 'object' && body.cardData ? body.cardData : undefined

  if (!channelId || !content) {
    return NextResponse.json({ error: 'channelId and content required' }, { status: 400 })
  }

  const channel = await prisma.survivorChatChannel.findFirst({ where: { id: channelId } })
  if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gate = await assertLeagueMember(channel.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const access = await resolveSurvivorAccessContext(channel.leagueId, userId)
  if (!access?.isLeagueMember || !canSeeSurvivorChannel(access, channel)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (contentType === 'host_announcement') {
    const comm = await assertLeagueCommissioner(channel.leagueId, userId)
    if (!comm.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const perm = await canSendToChannel(channel.leagueId, userId, channelId)
  if (!perm.allowed) return NextResponse.json({ error: perm.reason ?? 'forbidden' }, { status: 403 })

  if (/^(?:@chimmy\s+)?(?:i\s+)?vote\b/i.test(content.trim())) {
    return NextResponse.json({ error: 'Send votes privately in your @Chimmy room.' }, { status: 422 })
  }

  const senderName = await getUserDisplayName(userId)
  const created = await prisma.survivorChatMessage.create({
    data: {
      leagueId: channel.leagueId,
      channelId,
      channelType: channel.channelType,
      senderUserId: userId,
      senderName,
      content,
      contentType,
      cardData: cardData as object | undefined,
    },
    include: { reactions: true },
  })

  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId: channel.leagueId },
    orderBy: { createdAt: 'desc' },
  })
  if (season) {
    publishSurvivorRedraftEvent(season.id, {
      type: 'new_chat_message',
      channelId,
      channelType: channel.channelType,
      messageId: created.id,
      preview: content.slice(0, 50),
      leagueId: channel.leagueId,
    })
  }

  return NextResponse.json({ message: created })
}

export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { messageId?: string; content?: string }
  try {
    body = (await req.json()) as { messageId?: string; content?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const messageId = body.messageId?.trim()
  const content = body.content
  if (!messageId || typeof content !== 'string') {
    return NextResponse.json({ error: 'messageId and content required' }, { status: 400 })
  }

  const msg = await prisma.survivorChatMessage.findFirst({ where: { id: messageId } })
  if (!msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const channel = await prisma.survivorChatChannel.findFirst({ where: { id: msg.channelId, leagueId: msg.leagueId } })
  const access = await resolveSurvivorAccessContext(msg.leagueId, userId)
  if (!channel || !access?.isLeagueMember || !canSeeSurvivorChannel(access, channel)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const comm = await assertLeagueCommissioner(msg.leagueId, userId)
  if (msg.senderUserId !== userId && !comm.ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const updated = await prisma.survivorChatMessage.update({
    where: { id: messageId },
    data: { content, editedAt: new Date() },
    include: { reactions: true },
  })
  return NextResponse.json({ message: updated })
}

export async function DELETE(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { messageId?: string }
  try {
    body = (await req.json()) as { messageId?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const messageId = body.messageId?.trim()
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })

  const msg = await prisma.survivorChatMessage.findFirst({ where: { id: messageId } })
  if (!msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const channel = await prisma.survivorChatChannel.findFirst({ where: { id: msg.channelId, leagueId: msg.leagueId } })
  const access = await resolveSurvivorAccessContext(msg.leagueId, userId)
  if (!channel || !access?.isLeagueMember || !canSeeSurvivorChannel(access, channel)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const comm = await assertLeagueCommissioner(msg.leagueId, userId)
  if (msg.senderUserId !== userId && !comm.ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const updated = await prisma.survivorChatMessage.update({
    where: { id: messageId },
    data: { isDeleted: true, deletedAt: new Date(), deletedBy: userId },
  })
  return NextResponse.json({ message: updated })
}

