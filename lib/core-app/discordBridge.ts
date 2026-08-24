import { prisma } from '@/lib/prisma'
import { isBotConfigured } from '@/lib/discord/bot'
import { channelLink } from '@/lib/discord/deepLinks'
import { DISCORD_BOT_PERMISSIONS, DISCORD_CLIENT_ID } from '@/lib/discord/constants'

/**
 * 32a — the Discord bridge, read from real state.
 *
 * ⚠ DIRECTION IS THREE STATES, AND "OFF" IS NOT "POST-ONLY WITH THE SWITCH
 * DOWN". The schema stores three booleans (`syncEnabled`, `syncOutbound`,
 * `syncInbound`); this module is the ONLY place that translates them to and from
 * the three directions a commissioner actually chooses. Two translations would
 * eventually disagree, and the failure mode of disagreeing about direction is a
 * private message in a public channel.
 *
 * ⚠ COMMISSIONER-ONLY SURFACES DEFAULT TO OFF, AND THAT DEFAULT IS LOAD-BEARING.
 * A private note that appears in a public Discord channel is the kind of mistake
 * you only make once. `defaultDirection` is 'off' for those surfaces here, the
 * column default in the migration says the same, and the UI refuses to present
 * them as on-by-default. Three places, deliberately.
 *
 * ⚠ ONLY `league_chat` IS WIRED TODAY. `DiscordLeagueChannel` currently holds one
 * row per league and has no `surface` column — the migration that adds it
 * (20260823120000_discord_bridge_surfaces) is authored but NOT APPLIED, because
 * the only database .env.local points at is production. Until it is applied, the
 * other three surfaces report `mapped: false, available: false` and the screen
 * says so plainly rather than rendering a control that would silently do
 * nothing.
 */

export type BridgeDirection = 'both' | 'post-only' | 'off'

export type BridgeSurfaceId = 'league_chat' | 'trades_waivers' | 'draft_room' | 'commissioner_notes'

export type BridgeSurface = {
  id: BridgeSurfaceId
  label: string
  description: string
  /** Commissioner-only surfaces default OFF and are labelled as such. */
  commissionerOnly: boolean
  defaultDirection: BridgeDirection
}

export const BRIDGE_SURFACES: BridgeSurface[] = [
  {
    id: 'league_chat',
    label: 'League chat',
    description: 'Everyday league talk. The surface the bridge relays today.',
    commissionerOnly: false,
    defaultDirection: 'both',
  },
  {
    id: 'trades_waivers',
    label: 'Trades & waivers',
    description: 'Offers, accepts, vetoes and claim results.',
    commissionerOnly: false,
    defaultDirection: 'post-only',
  },
  {
    id: 'draft_room',
    label: 'Draft room',
    description: 'Picks as they land. Bursty on draft night — see rate limiting below.',
    commissionerOnly: false,
    defaultDirection: 'post-only',
  },
  {
    id: 'commissioner_notes',
    label: 'Commissioner notes',
    description: 'Private commissioner working notes.',
    commissionerOnly: true,
    /*
     * ⚠ OFF. Not a preference — a safety default. Do not "improve" this to
     * post-only because the other three are on.
     */
    defaultDirection: 'off',
  },
]

/** The three booleans the schema stores → the one direction a human picks. */
export function directionFromFlags(flags: {
  syncEnabled: boolean
  syncOutbound: boolean
  syncInbound: boolean
}): BridgeDirection {
  if (!flags.syncEnabled) return 'off'
  if (flags.syncOutbound && flags.syncInbound) return 'both'
  if (flags.syncOutbound) return 'post-only'
  // Inbound-only is not an offered direction; treat it as off rather than
  // inventing a fourth state the UI cannot express.
  return 'off'
}

/** The inverse. The PATCH route at /api/discord/league takes exactly these. */
export function flagsFromDirection(direction: BridgeDirection): {
  syncEnabled: boolean
  syncOutbound: boolean
  syncInbound: boolean
} {
  if (direction === 'off') return { syncEnabled: false, syncOutbound: false, syncInbound: false }
  if (direction === 'post-only') return { syncEnabled: true, syncOutbound: true, syncInbound: false }
  return { syncEnabled: true, syncOutbound: true, syncInbound: true }
}

export type BridgeMapping = {
  surface: BridgeSurface
  /** False when no Discord channel is mapped to this surface. */
  mapped: boolean
  /**
   * False when the schema cannot yet express this mapping at all — the
   * `surface` column is unapplied. Distinct from `mapped: false`, which means
   * "expressible, just not set up".
   */
  available: boolean
  direction: BridgeDirection
  channelName: string | null
  channelUrl: string | null
}

export type BridgeMember = {
  teamName: string
  ownerName: string
  linked: boolean
  discordUsername: string | null
  discordAvatar: string | null
}

export type DiscordBridgeData = {
  leagueId: string
  leagueName: string
  /** False when DISCORD_BOT_TOKEN is unset — nothing can relay at all. */
  botConfigured: boolean
  /** Has this commissioner connected their own Discord account? */
  connected: boolean
  guildName: string | null
  guildId: string | null
  mappings: BridgeMapping[]
  members: BridgeMember[]
  /** The bot-install URL, with exactly the permissions the bridge needs. */
  installUrl: string | null
  /**
   * True while the surface migration is unapplied. The screen prints this as a
   * plain sentence rather than hiding three dead controls.
   */
  surfacesPending: boolean
}

/** The three scopes the connect flow asks for, and the ones it never does. */
export const BRIDGE_SCOPES_REQUESTED = [
  'Create channels and webhooks in the server you choose',
  'Read messages in the channels you map — and only those',
  'Send messages in the channels you map — and only those',
]

export const BRIDGE_SCOPES_REFUSED = [
  'Your DMs. Never requested, never bridged.',
  'Server member management. We do not kick, ban or assign roles.',
  'Any channel you did not map. The bot cannot see the rest of the server.',
]

export async function getDiscordBridge(
  userId: string,
  leagueId: string,
): Promise<DiscordBridgeData | null> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { id: true, name: true, userId: true },
  })
  // Commissioner-only surface: this screen configures the whole league's bridge.
  if (!league || league.userId !== userId) return null

  const [profile, link, teams] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: { discordUserId: true, discordGuildId: true },
    }),
    prisma.discordLeagueChannel.findFirst({
      where: { leagueId },
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
     * Only league chat can be mapped until the `surface` column exists. The
     * other three are reported as unavailable — a different thing from unmapped,
     * and the screen says which.
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
