/**
 * What Commissioner OS may actually DO with a planned action, on THIS league, on THIS platform.
 *
 * 🛑 THIS REUSES `WriteAuthority` RATHER THAN INTRODUCING A PARALLEL ENUM, AND THAT IS A DELIBERATE
 * DEVIATION FROM THE C5 BRIEF. The brief proposed `native_write | connected_write | read_only |
 * manual_unknown`. `lib/league/write-authority.ts` already owns exactly this question with
 * `NATIVE | SHADOW | CONNECTED`, is already the thing every mutation route returns to the client,
 * and already carries the measured lesson that produced it — the pre-Shadow codebase scattered
 * `platform === 'sleeper'` checks and showed "Lineup saved" for an ESPN league that never heard
 * about the change. A second enum would be a second answer to one question, and the two would drift
 * in the direction that lies to the user.
 *
 * The brief's four states map onto three without loss:
 *
 *   native_write   -> NATIVE
 *   connected_write-> CONNECTED   (nothing is CONNECTED today; the set is intentionally empty)
 *   read_only      -> SHADOW      with an EXTERNAL effect scope
 *   manual_unknown -> SHADOW      — `resolveWriteAuthority` already fails safe here, resolving an
 *                                   unrecognised or empty platform to SHADOW rather than NATIVE,
 *                                   because over-disclosing is cosmetic and over-claiming is a lie.
 *
 * ⚠ AUTHORITY IS PER-ACTION, NOT PER-LEAGUE, AND THAT IS THE POINT. A Sleeper-imported Survivor
 * league is read-only for a ROSTER mutation and fully writable for a PHASE transition, because the
 * phase machine's system of record is AllFantasy and always was. Collapsing to one league-level
 * verdict would either block Commissioner OS from running its own state machine, or claim it can
 * drop a player out of somebody's Sleeper roster. Both are wrong; the effect's scope is what
 * separates them.
 *
 * 🛑 BEING COMMISSIONER DOES NOT CONFER EXTERNAL WRITE ACCESS. The role gates whether a human may
 * ASK for an action. The platform decides whether AllFantasy can carry it out. They are checked
 * separately and neither substitutes for the other.
 *
 * Pure: no DB, no I/O, no clock.
 */

import { resolveWriteAuthority, sourcePlatformLabel, type WriteAuthority } from '@/lib/league/write-authority'

/**
 * Whose system of record an effect touches.
 *
 * INTERNAL — state AllFantasy owns outright: phases, tribes, commissioner tasks, announcements,
 *            draft slot assignments in an AF draft, division membership in an AF ladder. A shadow
 *            league's phase state is not a copy of anything on Sleeper; it exists only here.
 *
 * EXTERNAL — state whose truth lives on the host platform when the league is imported: roster
 *            slots, bench size, FAAB balances, add/drop, elimination as an actual roster release.
 */
export type EffectScope = 'internal' | 'external'

/**
 * The three questions the C5 brief requires every planned action to answer, kept separate because
 * they genuinely differ.
 *
 * ⚠ `canPrepare` IS THE ONE THAT CARRIES THE PRODUCT. Read-only integrations are the common case
 * and the whole value of Commissioner OS there is detect → calculate → prepare → guide → deep-link.
 * An action that cannot execute is not a dead end; it is a worked instruction for the commissioner.
 *
 * ⚠ `canVerify` IS NOT "we will notice eventually". It is true only when a later import or sync of
 * this league can actually establish that the thing happened. An effect nobody can observe after
 * the fact reports false, and the commissioner is told the verification is manual.
 */
export type ActionAuthority = {
  mode: WriteAuthority
  canExecute: boolean
  canPrepare: boolean
  canVerify: boolean
  /** The platform whose system of record this is, for copy. Null for native leagues. */
  sourceLabel: string | null
  /** Why execution is unavailable. Null when `canExecute` is true. */
  blockedReason: string | null
}

export type ResolveActionAuthorityInput = {
  /** Raw `League.platform`. Untrusted text — no DB enum backs it. */
  platform: string | null | undefined
  scope: EffectScope
  /**
   * Whether a later import/sync of this league could observe that the effect landed.
   *
   * Declared by the rule-effect definition, never inferred here. `SET_BENCH_SIZE` is observable
   * from a re-imported roster; `GENERATE_ANNOUNCEMENT` is not observable anywhere but AF.
   */
  verifiableFromImport: boolean
  /** Whether AllFantasy has any implementation that can prepare this effect yet. */
  preparable?: boolean
}

/**
 * Authority for one planned action.
 *
 * The table, stated plainly so it is auditable rather than inferred from the branches:
 *
 *   scope=internal, any authority   -> execute YES, prepare YES, verify YES
 *   scope=external, NATIVE          -> execute YES, prepare YES, verify YES
 *   scope=external, CONNECTED       -> execute YES, prepare YES, verify YES
 *   scope=external, SHADOW          -> execute NO,  prepare per-effect, verify per-effect
 *
 * ⚠ `internal` + SHADOW EXECUTING IS CORRECT AND IS NOT A HOLE. A shadow league is fully editable
 * inside AllFantasy on purpose — that is what makes it usable as a simulator — and its phase state
 * has no external counterpart to disagree with. The obligation on a shadow league is disclosure,
 * not prohibition, which is exactly what `lib/league/write-authority.ts` documents.
 */
export function resolveActionAuthority(input: ResolveActionAuthorityInput): ActionAuthority {
  const mode = resolveWriteAuthority(input.platform)
  const sourceLabel = sourcePlatformLabel(input.platform)
  const preparable = input.preparable !== false

  if (input.scope === 'internal' || mode !== 'SHADOW') {
    return {
      mode,
      canExecute: true,
      canPrepare: preparable,
      canVerify: true,
      sourceLabel,
      blockedReason: null,
    }
  }

  return {
    mode,
    canExecute: false,
    canPrepare: preparable,
    canVerify: input.verifiableFromImport,
    sourceLabel,
    blockedReason: `AllFantasy cannot write to ${sourceLabel ?? 'the host platform'}; ${
      sourceLabel ?? 'it'
    } remains this league's system of record.`,
  }
}

/**
 * One sentence a surface can render under a planned action.
 *
 * ⚠ NEVER SAYS A WRITE HAPPENED. The C5 brief's rule 10 — read-only providers return guidance, not
 * pretend writes — is enforced here in the copy as well as in the flags, because a flag nobody
 * renders is not a safeguard.
 */
export function describeActionAuthority(authority: ActionAuthority): string {
  if (authority.canExecute) {
    return authority.mode === 'CONNECTED' && authority.sourceLabel
      ? `AllFantasy will apply this in ${authority.sourceLabel}.`
      : 'AllFantasy will apply this.'
  }
  const source = authority.sourceLabel ?? 'your host platform'
  if (authority.canVerify) {
    return `Prepared for you to apply in ${source}. AllFantasy will confirm it on the next sync.`
  }
  return `Prepared for you to apply in ${source}. AllFantasy cannot confirm it afterwards — check it yourself.`
}
