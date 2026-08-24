import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isBotConfigured, missingBotPermissions } from '@/lib/discord/bot'
import { channelLink } from '@/lib/discord/deepLinks'

export const dynamic = 'force-dynamic'

/** Commissioner: Discord sync status for a league. */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { userId: true, name: true },
  })
  if (!league || league.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      discordUserId: true,
      discordGuildId: true,
    },
  })

  const link = await prisma.discordLeagueChannel.findFirst({
    where: { leagueId },
    include: { guild: true },
  })

  // Servers that installed the bot under the old permission integer still hold a
  // narrower grant. Only worth asking Discord once a channel is actually linked.
  const missingPermissions = link ? await missingBotPermissions(link.guildId) : []

  return NextResponse.json({
    botConfigured: isBotConfigured(),
    missingPermissions,
    discordConnected: Boolean(profile?.discordUserId),
    discordGuildId: profile?.discordGuildId ?? null,
    leagueName: league.name,
    channel: link
      ? {
          channelId: link.channelId,
          channelName: link.channelName,
          guildId: link.guildId,
          guildName: link.guild?.guildName,
          syncEnabled: link.syncEnabled,
          syncOutbound: link.syncOutbound,
          syncInbound: link.syncInbound,
          channelUrl: channelLink(link.guildId, link.channelId),
        }
      : null,
  })
}

export async function PATCH(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as {
    leagueId?: string
    syncEnabled?: boolean
    syncOutbound?: boolean
    syncInbound?: boolean
  } | null

  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { userId: true },
  })
  if (!league || league.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const data: Record<string, boolean> = {}
  if (typeof body?.syncEnabled === 'boolean') data.syncEnabled = body.syncEnabled
  if (typeof body?.syncOutbound === 'boolean') data.syncOutbound = body.syncOutbound
  if (typeof body?.syncInbound === 'boolean') data.syncInbound = body.syncInbound

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No toggles' }, { status: 400 })
  }

  await prisma.discordLeagueChannel.updateMany({
    where: { leagueId },
    data,
  })

  return NextResponse.json({ ok: true })
}

