import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createLeagueChannel, deleteUnmappedChannel, isBotConfigured } from '@/lib/discord/bot'
import { channelLink } from '@/lib/discord/deepLinks'
import { verifyGuildManager } from '@/lib/discord/guild-access'
import { getLeagueMemberUserIds } from '@/lib/league-chat/leagueMemberIds'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isBotConfigured()) {
    return NextResponse.json({ error: 'Discord bot not configured' }, { status: 503 })
  }

  const body = (await req.json().catch(() => null)) as { leagueId?: string; guildId?: string } | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const guildId = typeof body?.guildId === 'string' ? body.guildId.trim() : ''

  if (!leagueId || !guildId) {
    return NextResponse.json({ error: 'leagueId and guildId required' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { userId: true, name: true },
  })
  if (!league || league.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const guildLink = await prisma.discordGuildLink.findUnique({ where: { guildId } })
  if (!guildLink || guildLink.linkedByUserId !== session.user.id) {
    return NextResponse.json({ error: 'Guild not linked by you' }, { status: 403 })
  }

  const leagueName = league.name ?? 'League'
  const manager = await verifyGuildManager(session.user.id, guildId)
  if (!manager) return NextResponse.json({ error: 'Connect Discord and verify Manage Server access.' }, { status: 403 })
  const existing = await prisma.discordLeagueChannel.findFirst({ where: { leagueId, surface: 'league_chat' } })
  if (existing) {
    if (existing.guildId !== guildId) return NextResponse.json({ error: 'League is already connected to another server.' }, { status: 409 })
    return NextResponse.json({ channelId: existing.channelId, channelName: existing.channelName, channelUrl: channelLink(guildId, existing.channelId) })
  }
  const memberIds = await getLeagueMemberUserIds(leagueId)
  const profiles = await prisma.userProfile.findMany({ where: { userId: { in: memberIds }, discordConnectedAt: { not: null }, discordUserId: { not: null } }, select: { discordUserId: true } })
  const discordIds = [...new Set([manager.discordUserId, ...profiles.flatMap(p => p.discordUserId ? [p.discordUserId] : [])])]
  let created: { channelId: string; channelName: string }
  try {
    created = await createLeagueChannel(guildId, leagueName, discordIds)
  } catch {
    return NextResponse.json({ error: 'Could not create a private Discord channel. Check bot permissions.' }, { status: 502 })
  }
  const { channelId, channelName } = created

  let linked
  try {
    linked = await prisma.discordLeagueChannel.upsert({
      where: { leagueId_guildId: { leagueId, guildId } },
      create: { leagueId, guildId, channelId, channelName },
      update: {},
    })
  } catch {
    await deleteUnmappedChannel(channelId).catch(() => console.error('[discord] Failed to clean up newly created unmapped channel', channelId))
    return NextResponse.json({ error: 'Could not save the Discord connection. Please retry.' }, { status: 503 })
  }
  if (linked.channelId !== channelId) {
    await deleteUnmappedChannel(channelId).catch(() => console.error('[discord] Failed to clean up duplicate new channel', channelId))
    if (linked.surface !== 'league_chat') return NextResponse.json({ error: 'Server already has a different connection for this league.' }, { status: 409 })
    return NextResponse.json({ channelId: linked.channelId, channelName: linked.channelName, channelUrl: channelLink(linked.guildId, linked.channelId) })
  }

  const channelUrl = channelLink(guildId, channelId)

  return NextResponse.json({
    channelId,
    channelName,
    channelUrl,
  })
}
