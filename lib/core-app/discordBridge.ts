import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadLeagueForOwner } from '@/lib/core-app/loadLeagueFor'
import { isBotConfigured } from '@/lib/discord/bot'
import { channelLink } from '@/lib/discord/deepLinks'
import { DISCORD_BOT_PERMISSIONS, DISCORD_CLIENT_ID } from '@/lib/discord/constants'
import {
  BRIDGE_SURFACES,
  directionFromFlags,
  type BridgeMapping,
  type BridgeMember,
  type DiscordBridgeData,
} from '@/lib/core-app/discordBridgeContract'

/**
 * 32a — the Discord bridge, read from real state.
 *
 * The shared vocabulary this returns lives in `discordBridgeContract.ts`, which
 * the client screen imports. Everything that touches the database lives HERE,
 * behind `server-only`, so the boundary is enforced by the bundler rather than
 * by remembering. See that file for why the two were separated.
 *
 * 🛑 THIS SCREEN IS OWNER-ONLY, AND THAT IS NARROWER THAN LEAGUE MEMBERSHIP ON
 * PURPOSE. It configures the whole league's bridge, so it deliberately does NOT
 * go through `loadLeagueFor` — that admits any of the four canonical membership
 * paths, which would hand every manager in the league the controls for what
 * relays into a public Discord channel. It goes through `loadLeagueForOwner`
 * instead — the owner-only sibling in the same chokepoint file, so the two
 * predicates sit side by side and neither drifts unwatched.
 *
 * ⚠ SO A CO-COMMISSIONER IS REFUSED HERE. That matches the behaviour this file
 * has always had and is unchanged by the split; it is recorded because it is a
 * real product question, not because it was decided here.
 *
 * ⚠ ONLY `league_chat` IS WIRED TODAY, AND THE REASON CHANGED ON 2026-08-30.
 * It used to be the schema: `surface` did not exist. It does now —
 * 20260823120000_discord_bridge_surfaces was applied to production that evening,
 * and `surface` and `commissionerOnly` are live columns.
 *
 * The gate below stays anyway, because the BLOCKER MOVED rather than cleared:
 * `lib/discord/sync-outbound.ts` has no notion of a surface. It relays to the
 * one row it finds for a league. So mapping a channel to trades or the draft
 * room would write a row nothing ever posts to — a control that silently does
 * nothing, which is precisely what this module refuses to render.
 *
 * 🛑 SO DO NOT DELETE THE GATE ON THE STRENGTH OF THE COLUMN EXISTING. Make the
 * relay surface-aware first, then remove the gate and `surfacesPending`
 * together. Until then the other three report `mapped: false, available: false`
 * and the screen says why.
 */

export async function getDiscordBridge(
  userId: string,
  leagueId: string,
): Promise<DiscordBridgeData | null> {
  /*
   * 🛑 OWNER-ONLY, AND THROUGH THE CHOKEPOINT RATHER THAN HAND-ROLLED.
   * `loadLeagueForOwner` carries the nullish guard that stops Prisma dropping an
   * `undefined` `userId` out of the `where` — which would return the row to any
   * caller. An earlier version of this function scoped the query inline and a
   * comment here claimed it was equivalent to the read-then-compare it replaced
   * "for every input"; that was false for exactly `undefined`.
   *
   * ⚠ DELIBERATELY NOT `loadLeagueFor`. That helper admits all four canonical
   * membership paths, and this screen configures what relays into a public
   * Discord channel for the whole league — member-wide access would be a
   * privilege widening dressed as consistency. A co-commissioner is refused
   * here; that is a product question with one implementation to change.
   */
  const league = await loadLeagueForOwner(userId, leagueId, { id: true, name: true })
  if (!league) return null

  const [profile, link, teams] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: { discordUserId: true, discordGuildId: true },
    }),
    /*
     * ⚠ SCOPED TO `league_chat`. `@@unique([leagueId, surface])` permits four
     * rows per league, and whatever row came back was rendered under the League
     * chat heading unconditionally — so once a `commissioner_notes` row exists,
     * an unfiltered `findFirst` could print the commissioner channel's name, URL
     * and direction as if it were league chat.
     */
    prisma.discordLeagueChannel.findFirst({
      where: { leagueId, surface: 'league_chat' },
      include: { guild: { select: { guildName: true } } },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { teamName: true, ownerName: true, claimedByUserId: true },
      orderBy: { teamName: 'asc' },
    }),
  ])

  /*
   * Who's linked. A manager with no Discord identity still sees everything —
   * their messages relay under their plain AllFantasy name. That is a real,
   * supported state, not an edge case, so it is computed here rather than
   * treated as missing data.
   */
  const claimedIds = teams.map((t) => t.claimedByUserId).filter((id): id is string => Boolean(id))
  const profiles = claimedIds.length
    ? await prisma.userProfile.findMany({
        where: { userId: { in: claimedIds } },
        select: { userId: true, discordUsername: true, discordAvatar: true },
      })
    : []
  const byUser = new Map(profiles.map((p) => [p.userId, p]))

  const members: BridgeMember[] = teams.map((t) => {
    const p = t.claimedByUserId ? byUser.get(t.claimedByUserId) : undefined
    return {
      teamName: t.teamName,
      ownerName: t.ownerName,
      linked: Boolean(p?.discordUsername),
      discordUsername: p?.discordUsername ?? null,
      discordAvatar: p?.discordAvatar ?? null,
    }
  })

  const mappings: BridgeMapping[] = BRIDGE_SURFACES.map((surface) => {
    /*
     * Only league chat can be mapped until the outbound relay knows about
     * surfaces — see the header. The `surface` column exists as of 2026-08-30;
     * it is `sync-outbound.ts` that does not read it yet. The other three are
     * reported as unavailable — a different thing from unmapped, and the screen
     * says which.
     */
    if (surface.id !== 'league_chat') {
      return {
        surface,
        mapped: false,
        available: false,
        direction: surface.defaultDirection,
        channelName: null,
        channelUrl: null,
      }
    }
    if (!link) {
      return {
        surface,
        mapped: false,
        available: true,
        direction: surface.defaultDirection,
        channelName: null,
        channelUrl: null,
      }
    }
    return {
      surface,
      mapped: true,
      available: true,
      direction: directionFromFlags(link),
      channelName: link.channelName,
      channelUrl: channelLink(link.guildId, link.channelId),
    }
  })

  const guildId = link?.guildId ?? profile?.discordGuildId ?? null

  return {
    leagueId: league.id,
    leagueName: league.name ?? 'League',
    botConfigured: isBotConfigured(),
    connected: Boolean(profile?.discordUserId),
    guildName: link?.guild?.guildName ?? null,
    guildId,
    mappings,
    members,
    installUrl: DISCORD_CLIENT_ID
      ? `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&permissions=${DISCORD_BOT_PERMISSIONS}&scope=bot%20applications.commands`
      : null,
    surfacesPending: true,
  }
}
