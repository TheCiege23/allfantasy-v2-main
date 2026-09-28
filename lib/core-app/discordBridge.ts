import { prisma } from '@/lib/prisma'
import { isBotConfigured } from '@/lib/discord/bot'
import { channelLink } from '@/lib/discord/deepLinks'
import { leagueTemplateUrl } from '@/lib/discord/template'
import { DISCORD_INBOUND_SCHEDULED } from '@/lib/discord/inboundStatus'
import { canManageDiscordBridge } from '@/lib/discord/bridgeAccess'
import { storedDiscordInvite } from '@/lib/discord/inviteLink'

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
 *
 * ⚠ LEAGUE CHAT DEFAULTS TO OFF TOO, SINCE 2026-09-25. Discord is sold as "your
 * league, your space": the server belongs to the league, and AllFantasy chat only
 * goes there when the commissioner switches copying on. `/api/discord/channels/create`
 * writes new rows with all three flags false; `defaultDirection` below says the same.
 * Two-way (Discord → AllFantasy) is a further opt-in, and is not offered at all until
 * `DISCORD_INBOUND_SCHEDULED` is true — see lib/discord/inboundStatus.ts.
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
    /*
     * ⚠ OFF. League chat leaves AllFantasy only when the commissioner says so, and
     * reading Discord back in is a separate opt-in on top of that.
     */
    defaultDirection: 'off',
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
  /**
   * Starts the real "add AllFantasy to your server" OAuth round trip — our own
   * `/api/discord/bot-install?leagueId=…`, which sets state, our redirect, and
   * remembers the league so Discord sends the commissioner back to THIS screen.
   *
   * 🛑 IT USED TO BE A BARE discord.com AUTHORIZE URL with no redirect and no state,
   * so the server someone added the bot to was never saved and the next step could
   * never work. Null only when there is no league to return to.
   */
  installUrl: string | null
  /**
   * True while the outbound relay is not surface-aware. The screen prints this as a
   * plain sentence rather than hiding three dead controls.
   */
  surfacesPending: boolean

  /*
   * ⚠ THE FIELDS BELOW ARE OPTIONAL FOR ONE REASON: `app/dev/handoff-preview/fixtures.ts`
   * builds a `DiscordBridgeData` literal and predates them. `getDiscordBridge` always
   * sets all four; the screen falls back to the safe reading when one is missing
   * (not ready, no template, two-way unavailable). Make them required once that
   * fixture carries them.
   */
  /** Their Discord username, when connected — shown so they know which account. */
  discordUsername?: string | null
  /**
   * True when AllFantasy has been added to `guildId` BY THIS COMMISSIONER and the
   * server was verified theirs to manage (a DiscordGuildLink row they own). Only then
   * can the league channel be made there.
   */
  serverReady?: boolean
  /** `https://discord.new/<code>` from DISCORD_LEAGUE_TEMPLATE_CODE, or null when unset. */
  templateUrl?: string | null
  /** False until Discord → AllFantasy runs on a schedule; the screen must not offer it. */
  inboundAvailable?: boolean
  /**
   * The invite every league member gets a "Join the league Discord" button for — stored on the
   * league (`League.settings.discordInviteUrl`), pasted by a commissioner or kept from channel
   * creation. Null until one exists. Optional for the same fixture reason as the four above.
   */
  inviteUrl?: string | null
}

/**
 * What the AllFantasy bot does in a league's server, and what it never does.
 *
 * ⚠ HONEST, NOT REASSURING. This list used to promise "the bot cannot see the rest of
 * the server". That was false: the install grants View Channels server-wide, so the
 * bot can see any channel it is not shut out of. What is TRUE is what AllFantasy does
 * with that — it reads one channel, and only when two-way is on — and the screen says
 * how to shut the bot out of any channel for good.
 */
export const BRIDGE_SCOPES_REQUESTED = [
  'Make your league channel and a join link for it',
  'Post in your league channel — only when you turn copying on',
  'Read your league channel — only if you turn on two-way',
]

export const BRIDGE_SCOPES_REFUSED = [
  'Read your other channels. We never do, and you can hide any channel from the bot in Discord.',
  'Read DMs. Never asked for, never copied.',
  'Kick, ban, or change anyone’s roles.',
]

export async function getDiscordBridge(
  userId: string,
  leagueId: string,
): Promise<DiscordBridgeData | null> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { id: true, name: true, settings: true },
  })
  /*
   * Commissioner-only surface: this screen configures the whole league's bridge. "Commissioner" is
   * the head commissioner AND co-commissioners (2026-09-25) — `canManageDiscordBridge`, the rule
   * every bridge write route checks, so nobody is shown a control the server then refuses.
   */
  if (!league || !(await canManageDiscordBridge(leagueId, userId))) return null

  const [profile, link, teams] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: { discordUserId: true, discordUsername: true, discordGuildId: true },
    }),
    prisma.discordLeagueChannel.findFirst({
      where: { leagueId, surface: 'league_chat' },
      include: { guild: { select: { guildName: true, linkedByUserId: true } } },
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

  /*
   * Which server this league is set up against. An existing channel wins; otherwise
   * the server this commissioner most recently added AllFantasy to (bot-callback
   * writes `discordGuildId` only after verifying they manage it).
   */
  const guildId = link?.guildId ?? profile?.discordGuildId ?? null
  const guildLink = link?.guild
    ? link.guild
    : guildId
      ? await prisma.discordGuildLink.findUnique({
          where: { guildId },
          select: { guildName: true, linkedByUserId: true },
        })
      : null
  /*
   * Ready when THIS person added AllFantasy to the server — or when the league's channel already
   * lives there. The second case is a co-commissioner opening a league the head commissioner set up:
   * the server is the league's and AllFantasy is in it, so steps 2 and 3 are done, not "make a server".
   */
  const serverReady = Boolean(guildLink) && (guildLink?.linkedByUserId === userId || Boolean(link))

  return {
    leagueId: league.id,
    leagueName: league.name ?? 'League',
    botConfigured: isBotConfigured(),
    connected: Boolean(profile?.discordUserId),
    discordUsername: profile?.discordUsername ?? null,
    guildName: guildLink?.guildName ?? null,
    guildId,
    serverReady,
    inboundAvailable: DISCORD_INBOUND_SCHEDULED,
    mappings,
    members,
    installUrl: `/api/discord/bot-install?leagueId=${encodeURIComponent(league.id)}`,
    templateUrl: leagueTemplateUrl(),
    surfacesPending: true,
    inviteUrl: storedDiscordInvite(league.settings),
  }
}
