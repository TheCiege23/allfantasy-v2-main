import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'
import { isBotConfigured, missingBotPermissions, createOrReuseChannelInvite } from '@/lib/discord/bot'
import { channelLink } from '@/lib/discord/deepLinks'

export const dynamic = 'force-dynamic'

/**
 * Any league member: Discord sync status for a league, including a join invite.
 *
 * Was commissioner-only (`league.userId !== session.user.id`). Widened to
 * requireLeagueApiAccess — the one membership predicate, per lib/api/require-
 * league-access.ts — because a linked channel's invite link needs to reach every
 * member, not just the commissioner who set it up. PATCH below is unchanged and
 * stays commissioner-only; only read access grew.
 */
export async function GET(req: NextRequest) {
  const access = await requireLeagueApiAccess(req.nextUrl.searchParams?.get('leagueId'))
  if (!access.ok) return access.response
  const { leagueId, userId, access: membership } = access

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { name: true },
  })

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
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
  const [missingPermissions, inviteUrl] = link
    ? await Promise.all([
        missingBotPermissions(link.guildId),
        createOrReuseChannelInvite(link.channelId),
      ])
    : [[] as string[], null]

  return NextResponse.json({
    botConfigured: isBotConfigured(),
    isCommissioner: membership.isCommissioner,
    missingPermissions,
    /** Null when no channel is linked yet, or Discord couldn't be reached. */
    inviteUrl,
    discordConnected: Boolean(profile?.discordUserId),
    discordGuildId: profile?.discordGuildId ?? null,
    leagueName: league?.name ?? 'League',
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

