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
 * stopped a database read from being added to a client-reachable file.
 *
 * 🛑 AN EARLIER VERSION OF THIS PARAGRAPH SAID NOTHING IN THE REPO COULD SEE
 * THAT ERROR, AND THAT WAS FLATLY WRONG. `next build` catches it, and catches it
 * TRANSITIVELY. The claim rested on `typescript.ignoreBuildErrors`, which is
 * consumed in exactly one place in all of `next/dist/build` — `type-check.js`,
 * where it gates the `tsc` step. It cannot suppress a webpack error, and this is
 * a webpack error: `webpack-config.js` registers `next-invalid-import-error-loader`
 * against `/^server-only$/` unconditionally, and webpack propagates the issuer's
 * layer to every module it imports, so the violation is caught at any depth.
 * `performance-budget.yml` runs `npm run build` on every pull request and every
 * push to `main`, and `build:railway` runs it on every deploy.
 *
 * ⚠ SO THE THING WORTH GUARDING IS THE HALF THE BUNDLER CANNOT SEE: a module
 * that reads the database but carries NO `server-only` marker. There is nothing
 * for the loader to trip on, so it bundles clean and fails later and quieter.
 * `scripts/check-core-app-server-only.mjs` is that guard, and it is why the
 * client-side import scanner that first shipped here was withdrawn — it
 * duplicated the bundler badly (blind to side-effect imports, to `await
 * import()`, to re-exports, and to any file whose `'use client'` sat below a
 * comment) while missing the case the bundler genuinely cannot reach.
 *
 * The split is the shape CLAUDE.md records for `lib/fantasycalc.ts`, though
 * mirrored: there the FETCH moved out because 45 importers wanted the pure
 * helpers; here the pure half moved out because the loader had one importer and
 * the shared vocabulary had two. Same principle — the smaller move — opposite
 * direction. Read the fantasycalc note for the reasoning, not the mechanics.
 *
 * ⚠ DIRECTION IS THREE STATES, AND "OFF" IS NOT "POST-ONLY WITH THE SWITCH
 * DOWN". The schema stores three booleans (`syncEnabled`, `syncOutbound`,
 * `syncInbound`); this module translates them to and from the three directions a
 * commissioner actually chooses on `/core/discord`. Two translations would
 * eventually disagree, and the failure mode of disagreeing about direction is a
 * private message in a public channel.
 *
 * 🛑 AND THEY ALREADY DISAGREE. This module is NOT the only writer, and an
 * earlier version of this comment claimed it was — that the client and server
 * "cannot drift". `app/league/[leagueId]/components/DiscordLeagueSyncPanel.tsx`
 * is a second client UI over the same three booleans, with three INDEPENDENT
 * checkboxes, each PATCHing one flag on its own and never calling
 * `flagsFromDirection`. It can therefore produce `{ syncEnabled: true,
 * syncOutbound: false, syncInbound: true }` — inbound-only — which
 * `directionFromFlags` reports as 'off' while `/api/discord/poll-messages`
 * (`where: { syncEnabled: true, syncInbound: true }`) keeps pulling Discord
 * messages into league chat. The screen says "Nothing relays" and it is relaying.
 *
 * That is a live product bug, not a refactor artifact, and it is NOT fixed here:
 * the honest options are a fourth direction or removing the panel's independent
 * toggles, and that is a product decision. Recorded so the next reader does not
 * inherit the false version.
 *
 * ⚠ COMMISSIONER-ONLY SURFACES DEFAULT TO OFF IN THIS FILE — AND ONLY IN THIS
 * FILE. A private note that appears in a public Discord channel is the kind of
 * mistake you only make once. `defaultDirection` is 'off' for those surfaces
 * here, and the UI refuses to present them as on-by-default.
 *
 * 🛑 THE DATABASE DOES NOT AGREE, THOUGH THIS COMMENT USED TO SAY IT DID ("the
 * column default in the migration says the same. Three places, deliberately.").
 * Migration `20260823120000_discord_bridge_surfaces` adds only
 * `commissionerOnly BOOLEAN NOT NULL DEFAULT false` — it never touches the
 * direction columns, which remain `syncEnabled @default(true)`,
 * `syncOutbound @default(true)`, `syncInbound @default(false)`: post-only. So a
 * row inserted for `commissioner_notes` by anything that does not go through
 * this file lands post-only AND flagged not-commissioner-only, the inverse of
 * both labels. The migration's own comment anticipates exactly that script.
 * Until the column defaults are fixed, this constant is the ONLY place the
 * safety default actually lives — treat it accordingly.
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
