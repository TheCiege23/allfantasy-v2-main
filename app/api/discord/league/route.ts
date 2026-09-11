import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'
import { isBotConfigured, missingBotPermissions, createOrReuseChannelInvite } from '@/lib/discord/bot'
import { channelLink } from '@/lib/discord/deepLinks'
import { BRIDGE_SURFACES } from '@/lib/core-app/discordBridgeContract'

export const dynamic = 'force-dynamic'

/**
 * The surfaces a channel may mirror, from the one place that defines them.
 *
 * ⚠ IMPORTED RATHER THAN RETYPED. `discordBridgeContract.ts` is the vocabulary
 * `/core/discord` renders and it is client-safe (no prisma, no `server-only`),
 * so an API route may take it. A second hardcoded list here is how the route
 * starts accepting a surface the UI cannot show, or rejecting one it offers.
 */
const VALID_SURFACES = new Set<string>(BRIDGE_SURFACES.map((s) => s.id))

/**
 * ⚠ THE DEFAULT IS LOAD-BEARING AND IT IS NOT ARBITRARY. Callers that predate
 * surfaces send no `surface` — `DiscordLeagueSyncPanel.tsx` at
 * /league/[leagueId] PATCHes a single boolean and nothing else. Every row in
 * the table today is `league_chat`, because `discordLeagueChannel.surface`
 * carries that column default and the only creator
 * (`/api/discord/channels/create`) never sets it. So defaulting here scopes
 * those callers to exactly the row they were already editing.
 */
const DEFAULT_SURFACE = 'league_chat'

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
    surface?: string
    syncEnabled?: boolean
    syncOutbound?: boolean
    syncInbound?: boolean
  } | null

  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  }

  const surface =
    typeof body?.surface === 'string' && body.surface.trim() ? body.surface.trim() : DEFAULT_SURFACE
  if (!VALID_SURFACES.has(surface)) {
    return NextResponse.json({ error: 'Unknown surface' }, { status: 400 })
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

  /*
   * 🛑 SCOPED TO ONE SURFACE. This was `where: { leagueId }`, which writes EVERY
   * channel row the league has. `@@unique([leagueId, surface])` permits four —
   * league chat, trades/waivers, draft room, commissioner notes — so once the
   * other three become mappable, a commissioner setting League chat to "Both
   * ways" would have written `{ syncEnabled: true, syncOutbound: true,
   * syncInbound: true }` onto `commissioner_notes` as well, flipping it from off
   * to both-ways with no UI for it and no way to notice.
   *
   * That is exactly the "private note that appears in a public Discord channel"
   * failure `discordBridgeContract.ts` calls a mistake you only make once, and
   * the `commissionerOnly` default is the guard it defeats.
   *
   * ⚠ LATENT, NOT LIVE, WHICH IS WHY IT SURVIVED. `getDiscordBridge` marks every
   * non-`league_chat` surface `available: false` and the picker disables on
   * that, so nothing can send another surface today. It becomes reachable the
   * moment `lib/discord/sync-outbound.ts` learns about surfaces and
   * `surfacesPending` goes false — i.e. in the commit that makes the feature
   * work, which is the worst moment to discover it.
   *
   * ⚠ AT MOST ONE ROW MATCHES. Both `@@unique([leagueId, guildId])` and
   * `@@unique([leagueId, surface])` exist, so a (league, surface) pair is unique
   * and `updateMany` here is a single-row write. It is kept over `update` only
   * so a miss returns a count rather than throwing P2025.
   */
  const { count } = await prisma.discordLeagueChannel.updateMany({
    where: { leagueId, surface },
    data,
  })

  /*
   * ⚠ A ZERO-ROW WRITE USED TO RETURN `{ ok: true }`. Unscoped, that only
   * happened for a league with no channel at all; scoped, it also happens for a
   * surface with no mapping — a state the caller can now ask for. Reporting
   * success for a write that changed nothing is the same shape of lie as the
   * direction collapse, so it is a 404.
   *
   * The legacy panel at /league/[leagueId] cannot hit this: it renders its
   * toggles inside `{status.channel ? … }`, so it only PATCHes when a row
   * exists.
   */
  if (count === 0) {
    return NextResponse.json({ error: 'No channel mapped to that surface' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, surface, updated: count })
}

