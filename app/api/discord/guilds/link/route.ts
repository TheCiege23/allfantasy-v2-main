import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { linkVerifiedGuild, verifyGuildManager } from '@/lib/discord/guild-access'

export const dynamic = 'force-dynamic'

/*
 * 🛑 THIS ROUTE LET ANY LEAGUE OWNER CLAIM ANY DISCORD SERVER (owner's call 2026-09-25, "fix both
 * security holes now"). It took a guildId from the request body and upserted the link with
 * `linkedByUserId` = the caller — overwriting whoever held it — and `channels/create` trusts that
 * record. So anyone who owned a league could type another community's server id, take the link over,
 * and have our bot create channels and webhooks in a server they have no rights in.
 *
 * Now the same two checks the bot-install callback already makes: Discord itself must say the caller's
 * connected Discord account owns or manages that server (verifyGuildManager — Administrator or Manage
 * Server), and an existing link is never handed to someone else (linkVerifiedGuild). The server name
 * comes from Discord, not from the request.
 */
export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const body = (await req.json().catch(() => null)) as { leagueId?: string; guildId?: string } | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const guildId = typeof body?.guildId === 'string' ? body.guildId.trim() : ''

  if (!leagueId || !guildId) {
    return NextResponse.json({ error: 'leagueId and guildId required' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { userId: true },
  })
  if (!league || league.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const verified = await verifyGuildManager(userId, guildId)
  if (!verified) {
    return NextResponse.json(
      {
        error: 'discord_server_not_managed',
        message:
          "We couldn't confirm you run that Discord server. Connect your Discord account, add the AllFantasy bot to the server, and make sure you own it or can manage it.",
      },
      { status: 403 },
    )
  }

  const ownsLink = await linkVerifiedGuild(userId, guildId, verified.guildName)
  if (!ownsLink) {
    return NextResponse.json(
      { error: 'discord_server_linked_elsewhere', message: 'That Discord server is already linked by someone else.' },
      { status: 409 },
    )
  }

  return NextResponse.json({ success: true, guildName: verified.guildName })
}
