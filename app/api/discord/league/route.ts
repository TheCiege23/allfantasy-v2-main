import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'
import { isBotConfigured, missingBotPermissions, getChannel, channelVisibility } from '@/lib/discord/bot'
import { DISCORD_INBOUND_SCHEDULED } from '@/lib/discord/inboundStatus'
import { channelLink } from '@/lib/discord/deepLinks'
import { BRIDGE_SURFACES } from '@/lib/core-app/discordBridge'
import { canManageDiscordBridge } from '@/lib/discord/bridgeAccess'
import {
  INVALID_DISCORD_INVITE_MESSAGE,
  normalizeDiscordInviteUrl,
  storedDiscordInvite,
} from '@/lib/discord/inviteLink'
import { writeLeagueDiscordInvite } from '@/lib/discord/leagueInvite'

export const dynamic = 'force-dynamic'

/**
 * The surfaces a channel may mirror, from the one place that defines them.
 *
 * ⚠ IMPORTED RATHER THAN RETYPED. `lib/core-app/discordBridge.ts` defines the
 * surfaces `/core/discord` renders. A second hardcoded list here is how the route
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
 * member, not just the commissioner who set it up. Someone outside the league is
 * refused there, before anything is read, so they never see the invite.
 *
 * 🛑 THE INVITE IS READ FROM THE LEAGUE, NEVER MINTED HERE. This used to call
 * `createOrReuseChannelInvite` on every read — a Discord list, and on a miss a
 * Discord CREATE, from every member's drawer open. It is now
 * `League.settings.discordInviteUrl`, written only by the commissioner's own
 * actions (see lib/discord/leagueInvite.ts), and it does not need a channel or a
 * bot: a commissioner can paste their server's link and be done.
 */
export async function GET(req: NextRequest) {
  const access = await requireLeagueApiAccess(req.nextUrl.searchParams?.get('leagueId'))
  if (!access.ok) return access.response
  const { leagueId, userId } = access

  const [league, canManage] = await Promise.all([
    prisma.league.findFirst({
      where: { id: leagueId },
      select: { name: true, settings: true },
    }),
    // The same rule PATCH enforces, so "Manage Discord" is offered to exactly who can use it.
    canManageDiscordBridge(leagueId, userId),
  ])

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      discordUserId: true,
      discordGuildId: true,
    },
  })

  const link = await prisma.discordLeagueChannel.findFirst({
    where: { leagueId, surface: 'league_chat' },
    include: { guild: true },
  })

  /*
   * `?detail=1` — the commissioner's setup screen also wants to know whether the
   * channel is members-only or open to the server, read live from Discord (the
   * commissioner can change it there). Not fetched for the drawer's member view:
   * one fewer Discord call on every drawer open, and members do not need it.
   */
  const wantDetail = req.nextUrl.searchParams?.get('detail') === '1' && canManage

  // Servers that installed the bot under the old permission integer still hold a
  // narrower grant. Only worth asking Discord once a channel is actually linked.
  const [missingPermissions, visibility] = link
    ? await Promise.all([
        missingBotPermissions(link.guildId),
        wantDetail
          ? getChannel(link.channelId)
              .then((info) => (info ? channelVisibility(info, link.guildId) : 'gone'))
              .catch(() => null)
          : Promise.resolve(null),
      ])
    : [[] as string[], null]

  return NextResponse.json({
    botConfigured: isBotConfigured(),
    /** Head commissioner or co-commissioner — may open the setup screen. */
    isCommissioner: canManage,
    missingPermissions,
    /** The league's stored invite (re-validated on read); null until one is set. */
    inviteUrl: storedDiscordInvite(league?.settings),
    /** False until Discord → AllFantasy has a schedule; the UI must not offer it before. */
    inboundAvailable: DISCORD_INBOUND_SCHEDULED,
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
          /** 'private' | 'server' | 'gone' with ?detail=1; null when not asked or unknown. */
          visibility,
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
    /** A Discord invite to store on the league; null or '' removes it. */
    inviteUrl?: unknown
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

  /*
   * Head commissioner or co-commissioner (owner's decision, 2026-09-25) — `canManageDiscordBridge`,
   * the same rule the setup screen uses to decide whether to show itself. This was
   * `league.userId !== session.user.id`, so a co-commissioner was shown nothing they could save.
   * A missing league has no role, so it is refused here too.
   */
  if (!(await canManageDiscordBridge(leagueId, session.user.id))) {
    return NextResponse.json(
      { error: 'Only the commissioner or a co-commissioner can change this league’s Discord.' },
      { status: 403 },
    )
  }

  /*
   * The invite members join through. Validated here whatever the screen already checked — every
   * member of the league is sent to this link. Refused BEFORE any write, including a toggle that
   * rides along in the same body, so a bad link never half-applies a request.
   */
  const hasInvite = body !== null && Object.prototype.hasOwnProperty.call(body, 'inviteUrl')
  let inviteUrl: string | null = null
  if (hasInvite) {
    const raw = body?.inviteUrl
    const clearing = raw === null || (typeof raw === 'string' && raw.trim() === '')
    if (!clearing) {
      inviteUrl = normalizeDiscordInviteUrl(raw)
      if (!inviteUrl) {
        return NextResponse.json({ error: INVALID_DISCORD_INVITE_MESSAGE, code: 'invalid-invite' }, { status: 400 })
      }
    }
  }

  const data: Record<string, boolean> = {}
  if (typeof body?.syncEnabled === 'boolean') data.syncEnabled = body.syncEnabled
  if (typeof body?.syncOutbound === 'boolean') data.syncOutbound = body.syncOutbound
  if (typeof body?.syncInbound === 'boolean') data.syncInbound = body.syncInbound
  const hasToggles = Object.keys(data).length > 0

  if (!hasToggles && !hasInvite) {
    return NextResponse.json({ error: 'No toggles' }, { status: 400 })
  }

  /*
   * An invite on its own is a league setting, not a channel toggle: it needs no channel row and no
   * bot. A commissioner who already runs a server can paste its link and stop there.
   */
  if (!hasToggles) {
    await writeLeagueDiscordInvite(leagueId, inviteUrl)
    return NextResponse.json({ ok: true, inviteUrl })
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
   * failure `discordBridge.ts` calls a mistake you only make once, and
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

  if (hasInvite) {
    await writeLeagueDiscordInvite(leagueId, inviteUrl)
    return NextResponse.json({ ok: true, surface, updated: count, inviteUrl })
  }
  return NextResponse.json({ ok: true, surface, updated: count })
}

