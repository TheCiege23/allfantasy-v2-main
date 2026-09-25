import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  DiscordApiError,
  channelVisibility,
  createLeagueChannel,
  createOrReuseChannelInvite,
  createWebhook,
  getBotUserId,
  getChannel,
  isBotConfigured,
  postMessage,
  privateChannelOverwrites,
} from '@/lib/discord/bot'
import { channelLink } from '@/lib/discord/deepLinks'
import { planPrivateChannelAccess, type PrivateAccessPlan } from '@/lib/discord/leagueChannelAccess'

export const dynamic = 'force-dynamic'

type Visibility = 'server' | 'private'

const SURFACE = 'league_chat'

function fail(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status })
}

/**
 * Make (or find) the league's Discord channel — the one channel AllFantasy talks to.
 *
 * Body: `{ leagueId, guildId, visibility?: 'server' | 'private' }`.
 *
 *   - `server`  — everyone in the Discord server can see it. Right for a server made
 *                 just for the league (the template flow). The default, because it is
 *                 what this route always did and what the legacy panel expects.
 *   - `private` — members-only from the first moment: @everyone is denied View
 *                 Channel, and the commissioner plus every league member who has
 *                 linked Discord AND is already in the server is let in. Who could
 *                 not be let in is returned by name, so the screen can say so.
 *
 * ⚠ COPYING STARTS OFF. A new channel row is written with `syncEnabled`,
 * `syncOutbound` and `syncInbound` all false. The column defaults would turn
 * AllFantasy → Discord copying ON the moment the channel exists; the product rule is
 * that league chat only leaves AllFantasy once the commissioner switches it on.
 *
 * ⚠ ONE CHANNEL PER LEAGUE, AND ASKING TWICE IS SAFE. If the league already has a
 * live channel in this server, it is returned untouched rather than a second one
 * being made. If that channel was deleted in Discord, or the league is moving to a
 * different server, the existing row is re-pointed (and copying reset to off) rather
 * than a new row colliding with `@@unique([leagueId, surface])`.
 *
 * Tokens: the webhook token is stored server-side exactly as before and is never in
 * a response. Discord's error text is never echoed to the client either.
 */
export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return fail('Unauthorized', 401)

  if (!isBotConfigured()) {
    return fail('Discord isn’t switched on for AllFantasy yet.', 503)
  }

  const body = (await req.json().catch(() => null)) as {
    leagueId?: unknown
    guildId?: unknown
    visibility?: unknown
  } | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const guildId = typeof body?.guildId === 'string' ? body.guildId.trim() : ''
  if (!leagueId || !guildId) return fail('leagueId and guildId required', 400)

  const rawVisibility = body?.visibility ?? 'server'
  if (rawVisibility !== 'server' && rawVisibility !== 'private') return fail('Unknown visibility', 400)
  const visibility: Visibility = rawVisibility

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { userId: true, name: true },
  })
  if (!league || league.userId !== userId) return fail('Forbidden', 403)

  const guildLink = await prisma.discordGuildLink.findUnique({ where: { guildId } })
  if (!guildLink || guildLink.linkedByUserId !== userId) {
    return fail('Add AllFantasy to that server first.', 403, { code: 'guild-not-linked' })
  }

  const existing = await prisma.discordLeagueChannel.findFirst({ where: { leagueId, surface: SURFACE } })

  if (existing && existing.guildId === guildId) {
    let live
    try {
      live = await getChannel(existing.channelId)
    } catch {
      return fail(
        'AllFantasy can’t see your league channel right now. Check that the bot is still in the server and can view the channel.',
        502,
        { code: 'discord-unreachable' },
      )
    }
    if (live) {
      return NextResponse.json({
        alreadyExisted: true,
        channelId: existing.channelId,
        channelName: live.name ?? existing.channelName,
        channelUrl: channelLink(guildId, existing.channelId),
        visibility: channelVisibility(live, guildId),
        inviteUrl: await createOrReuseChannelInvite(existing.channelId).catch(() => null),
      })
    }
    // Deleted in Discord — fall through and make a fresh one.
  }

  let access: PrivateAccessPlan | null = null
  let overwrites: ReturnType<typeof privateChannelOverwrites> | undefined
  if (visibility === 'private') {
    const botId = await getBotUserId().catch(() => null)
    if (!botId) return fail('Couldn’t reach Discord. Try again in a minute.', 502, { code: 'discord-unreachable' })
    access = await planPrivateChannelAccess({ leagueId, guildId, commissionerUserId: userId })
    try {
      overwrites = privateChannelOverwrites(guildId, botId, access.discordUserIds)
    } catch {
      return fail('Couldn’t work out who should see the channel.', 400)
    }
  }

  const leagueName = league.name ?? 'League'
  let created: { channelId: string; channelName: string }
  try {
    created = await createLeagueChannel(guildId, leagueName, overwrites ? { permissionOverwrites: overwrites } : {})
  } catch (err) {
    const status = err instanceof DiscordApiError ? err.status : 0
    console.warn('[discord/channels/create] channel creation failed', { status })
    if (status === 403) {
      return fail(
        'AllFantasy isn’t allowed to make channels in that server. Add it again from step 3 and keep every box ticked.',
        403,
        { code: 'missing-permissions' },
      )
    }
    return fail('Discord didn’t make the channel. Try again in a minute.', 502, { code: 'discord-error' })
  }

  // The relay posts as the bot, not through this webhook, so a server that did not
  // grant Manage Webhooks must not lose a channel it already has over it.
  const webhook = await createWebhook(created.channelId, 'AllFantasy').catch(() => null)

  const rowData = {
    guildId,
    channelId: created.channelId,
    channelName: created.channelName,
    webhookId: webhook?.id ?? null,
    webhookToken: webhook?.token ?? null,
    lastSyncedMessageId: null,
    syncEnabled: false,
    syncOutbound: false,
    syncInbound: false,
  }
  if (existing) {
    await prisma.discordLeagueChannel.update({ where: { id: existing.id }, data: rowData })
  } else {
    await prisma.discordLeagueChannel.create({ data: { leagueId, surface: SURFACE, ...rowData } })
  }

  await postMessage(
    created.channelId,
    `👋 This channel is linked to **${leagueName}** on AllFantasy. ` +
      'League chat from AllFantasy only shows up here if your commissioner switches copying on.',
  ).catch(() => null)

  const inviteUrl = await createOrReuseChannelInvite(created.channelId).catch(() => null)

  return NextResponse.json({
    alreadyExisted: false,
    channelId: created.channelId,
    channelName: created.channelName,
    channelUrl: channelLink(guildId, created.channelId),
    visibility,
    inviteUrl,
    ...(access
      ? {
          access: {
            included: access.included,
            notLinked: access.notLinked,
            notInServer: access.notInServer,
            unknown: access.unknown,
          },
        }
      : {}),
  })
}
