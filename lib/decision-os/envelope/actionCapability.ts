/**
 * What an envelope may SAY about an action. It never executes one.
 *
 * 🛑 IMPORTED LEAGUES ARE READ-ONLY, AND THAT IS A FACT ABOUT THE PLATFORMS, NOT
 * A POLICY WE CHOSE. Sleeper publishes no write endpoint at all — an
 * AllFantasy-native trade proposal against a Sleeper league is not "not yet
 * built", it is impossible. Yahoo, ESPN, MFL, Fleaflicker and Fantrax are not
 * wired. So the default for every imported league is unavailable, and only a
 * capability that PROVES otherwise may change that.
 *
 * ⚠ THE FAILURE THIS PREVENTS IS A SENTENCE, NOT A CRASH. "I've submitted that
 * claim for you" about a league we cannot write to is worse than any error: the
 * user stops watching the waiver they now believe is in.
 */

import type { AuthorizedLeagueIdentity, PermittedAction } from './types'

/** Actions the product recognises. Recognition is not capability. */
export const KNOWN_ACTION_IDS = [
  'submit_trade',
  'submit_waiver_claim',
  'set_lineup',
  'drop_player',
  'commissioner_action',
  'save_watchlist',
  'save_plan',
] as const
export type KnownActionId = (typeof KNOWN_ACTION_IDS)[number]

/**
 * Actions that write to the HOST platform, and therefore cannot work on an
 * imported league.
 *
 * ⚠ `save_watchlist` AND `save_plan` ARE DELIBERATELY ABSENT. They write to
 * AllFantasy's own storage, not to the host, so they are available on an
 * imported league — the read-only rule is about the host's roster, not about
 * everything a user might want to keep.
 */
const HOST_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  'submit_trade',
  'submit_waiver_claim',
  'set_lineup',
  'drop_player',
  'commissioner_action',
])

export type AutoManagementPolicy = {
  enabled: boolean
  /** The exact action ids the user has authorised for automatic execution. */
  coveredActionIds: readonly string[]
}

/** Nothing is auto-managed unless a policy says so. This is the shipped default. */
export const NO_AUTO_MANAGEMENT: AutoManagementPolicy = { enabled: false, coveredActionIds: [] }

/**
 * Describe an action for the envelope.
 *
 * ⚠ `requiresConfirmation` DEFAULTS TO TRUE AND ONLY A POLICY NAMING THIS EXACT
 * ACTION CAN CLEAR IT. Not a global "auto mode" toggle, not the action's
 * category — the id. A blanket switch is how a user who enabled automatic
 * lineup setting discovers their roster was traded.
 */
export function describeAction(args: {
  id: KnownActionId
  label: string
  league: AuthorizedLeagueIdentity | null
  policy?: AutoManagementPolicy
}): PermittedAction {
  const policy = args.policy ?? NO_AUTO_MANAGEMENT
  const writesToHost = HOST_WRITE_ACTIONS.has(args.id)

  if (!args.league) {
    return {
      id: args.id,
      label: args.label,
      available: false,
      unavailableReason: 'No league is selected, so there is nothing to act on.',
      requiresConfirmation: true,
      autoManaged: false,
    }
  }

  if (writesToHost && args.league.origin === 'imported') {
    const platform = args.league.platform ?? 'the host platform'
    return {
      id: args.id,
      label: args.label,
      available: false,
      /*
       * Names the platform and says what CAN be done, because "unavailable"
       * alone reads as a defect and sends the user looking for a setting.
       */
      unavailableReason: `This league is imported from ${platform}, which AllFantasy cannot write to. I can prepare the move and you can submit it on ${platform}.`,
      requiresConfirmation: true,
      autoManaged: false,
    }
  }

  const autoManaged = policy.enabled && policy.coveredActionIds.includes(args.id)
  return {
    id: args.id,
    label: args.label,
    available: true,
    unavailableReason: null,
    requiresConfirmation: !autoManaged,
    autoManaged,
  }
}

/**
 * True when the envelope must not imply any host write.
 *
 * Exported so a renderer can assert on one predicate rather than re-deriving
 * "is this imported" in each surface that needs to know.
 */
export function isHostReadOnly(league: AuthorizedLeagueIdentity | null): boolean {
  return league?.origin === 'imported'
}
