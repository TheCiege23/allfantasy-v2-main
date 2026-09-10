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
 * ⚠ DIRECTION IS FOUR STATES, AND "OFF" IS NOT "POST-ONLY WITH THE SWITCH
 * DOWN". The schema stores three booleans (`syncEnabled`, `syncOutbound`,
 * `syncInbound`); this module translates them to and from the directions a
 * commissioner actually chooses on `/core/discord`. Two translations would
 * eventually disagree, and the failure mode of disagreeing about direction is a
 * private message in a public channel.
 *
 * 🛑 THERE IS A SECOND WRITER, AND THIS FILE IS NOT IT. An earlier version of
 * this comment claimed the client and server "cannot drift".
 * `app/league/[leagueId]/components/DiscordLeagueSyncPanel.tsx` is a second
 * client UI over the same three booleans, with three INDEPENDENT checkboxes,
 * each PATCHing one flag on its own and never calling `flagsFromDirection`. So
 * the set of flag combinations a WRITER can produce has always been larger than
 * the set this vocabulary could NAME.
 *
 * 🛑 THAT GAP WAS A LIE, NOT AN OMISSION, AND `pull-only` CLOSES IT.
 * `{ syncEnabled: true, syncOutbound: false, syncInbound: true }` — inbound-only
 * — used to fall through to 'off'. `/core/discord` printed "Off · Nothing
 * relays" while `/api/discord/poll-messages` (`where: { syncEnabled: true,
 * syncInbound: true }`, which never reads `syncOutbound`) kept pulling Discord
 * messages into league chat. Worse, the picker short-circuits on
 * `next === direction`, so a commissioner who distrusted it and clicked "Off"
 * got a no-op. Every reachable combination now has a name the UI can show.
 *
 * ⚠ THE DURABLE RULE, WHICH IS NOT ABOUT DISCORD: when a reader maps a WIDER
 * state space onto a NARROWER vocabulary, the extra states do not disappear —
 * they get reported as whichever name is nearest, and "nearest" here meant the
 * safest-sounding one. Prefer a name per reachable state over a fallback,
 * because a fallback is indistinguishable from a correct answer.
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

/**
 * ⚠ FOUR STATES, ONE PER REACHABLE FLAG COMBINATION. `pull-only` is the
 * inbound-only case — Discord relays INTO league chat and nothing goes out. It
 * was added because the state was already reachable from the legacy sync panel
 * and this vocabulary reported it as 'off' while it was relaying. Adding a fifth
 * means updating `flagsFromDirection`'s switch (the compiler will say so) and
 * `DIRECTIONS` in `components/core-app/screens/DiscordBridge.tsx` (it will not).
 */
export type BridgeDirection = 'both' | 'post-only' | 'pull-only' | 'off'

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

/**
 * The three booleans the schema stores → the one direction a human picks.
 *
 * 🛑 EVERY REACHABLE FLAG COMBINATION NOW MAPS TO A DIRECTION THE UI CAN SHOW.
 * `pull-only` exists because the state was already reachable and was being
 * reported as its opposite: inbound-only rendered as 'off' — "Nothing relays" —
 * while `/api/discord/poll-messages` (`where: { syncEnabled: true, syncInbound:
 * true }`, which never looks at `syncOutbound`) kept pulling Discord messages
 * into league chat. A commissioner could switch the bridge off, be told it was
 * off, and still be relaying.
 *
 * ⚠ THE COLLAPSE WAS NOT A BUG IN THIS FUNCTION, WHICH IS WHY IT SURVIVED.
 * It was correct about `/core/discord`, which offered three buttons. It was
 * wrong about the DATABASE, which the three independent checkboxes in
 * `app/league/[leagueId]/components/DiscordLeagueSyncPanel.tsx` can drive into
 * any of eight combinations. A reader that cannot express what a writer can
 * produce does not report an omission — it reports a falsehood.
 */
export function directionFromFlags(flags: {
  syncEnabled: boolean
  syncOutbound: boolean
  syncInbound: boolean
}): BridgeDirection {
  if (!flags.syncEnabled) return 'off'
  if (flags.syncOutbound && flags.syncInbound) return 'both'
  if (flags.syncOutbound) return 'post-only'
  if (flags.syncInbound) return 'pull-only'
  // Enabled with neither leg on. Nothing moves, so 'off' is the honest answer —
  // and unlike inbound-only, it is also what the picker writes back for 'off'.
  return 'off'
}

/**
 * The inverse. The PATCH route at /api/discord/league takes exactly these.
 *
 * ⚠ EXHAUSTIVE, AND IT FAILS CLOSED. The previous form was a chain of `if`s
 * ending in a bare `return { …all true }`, so ANY direction it did not
 * recognise — a fifth one added later, a stale value off the wire — became the
 * MOST permissive setting the bridge has. The `never` binding makes a missing
 * case a type error, and the default returns all-false so a value that does
 * reach it at runtime stops the relay rather than opening it. Types alone are
 * not the backstop here: `next.config.js` sets `typescript.ignoreBuildErrors`.
 */
export function flagsFromDirection(direction: BridgeDirection): {
  syncEnabled: boolean
  syncOutbound: boolean
  syncInbound: boolean
} {
  switch (direction) {
    case 'both':
      return { syncEnabled: true, syncOutbound: true, syncInbound: true }
    case 'post-only':
      return { syncEnabled: true, syncOutbound: true, syncInbound: false }
    case 'pull-only':
      return { syncEnabled: true, syncOutbound: false, syncInbound: true }
    case 'off':
      return { syncEnabled: false, syncOutbound: false, syncInbound: false }
    default: {
      const unreachable: never = direction
      void unreachable
      return { syncEnabled: false, syncOutbound: false, syncInbound: false }
    }
  }
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
