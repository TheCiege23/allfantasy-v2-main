/**
 * The Discord bridge's shared vocabulary — the shape the SERVER produces and the
 * CLIENT renders, and nothing else.
 *
 * 🛑 THIS FILE IS IMPORTED BY A CLIENT COMPONENT. IT MUST NEVER IMPORT PRISMA,
 * `server-only`, OR ANYTHING THAT REACHES THEM. That is not a style rule; it is
 * the defect this file was carved out of. Migrating the old combined module to
 * the League-read chokepoint broke `/core` outright with a 500 —
 *
 *   Error: You're importing a component that needs "server-only"
 *
 * — because `components/core-app/screens/DiscordBridge.tsx` is a `'use client'`
 * component importing the same module the loader lived in. The combined module
 * therefore could not carry a `server-only` marker, which in turn meant nothing
 * stopped a server import from being added to a client-reachable file. Caught by
 * a 500 on a live server, not by typecheck: `next.config.js` sets
 * `typescript.ignoreBuildErrors`, and a client/server boundary violation is a
 * BUNDLING error, so no amount of typechecking would have found it.
 *
 * The split is the shape CLAUDE.md records for `lib/fantasycalc.ts`: move the
 * half that cannot be shared, leave the half that everything imports.
 *
 * ⚠ DIRECTION IS THREE STATES, AND "OFF" IS NOT "POST-ONLY WITH THE SWITCH
 * DOWN". The schema stores three booleans (`syncEnabled`, `syncOutbound`,
 * `syncInbound`); this module is the ONLY place that translates them to and from
 * the three directions a commissioner actually chooses. Two translations would
 * eventually disagree, and the failure mode of disagreeing about direction is a
 * private message in a public channel. Both directions of that translation live
 * here PRECISELY so the client and the server cannot drift: the PATCH route at
 * /api/discord/league takes `flagsFromDirection`'s output, and the client builds
 * it.
 *
 * ⚠ COMMISSIONER-ONLY SURFACES DEFAULT TO OFF, AND THAT DEFAULT IS LOAD-BEARING.
 * A private note that appears in a public Discord channel is the kind of mistake
 * you only make once. `defaultDirection` is 'off' for those surfaces here, the
 * column default in the migration says the same, and the UI refuses to present
 * them as on-by-default. Three places, deliberately.
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
   * True while the outbound relay is not surface-aware. The screen prints this as a
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
