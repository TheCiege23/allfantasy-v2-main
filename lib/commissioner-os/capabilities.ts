/**
 * Commissioner OS capabilities — the additive layer that fixes "one concept is not enough".
 *
 * 🛑 THIS IS NOT A SECOND FORMAT ENGINE, AND IT MUST NEVER BECOME ONE. Classification stays where
 * it already is: `readFormatRules` (`lib/trade-intel/leagueFormatRules.ts`) decides what a league
 * IS, and `resolveLeagueRules` (`lib/league-rules/`) carries the concept, the modifiers, the alias
 * tags and the pricing base with provenance. This module answers a different question that neither
 * of those can: *what mechanics does Commissioner OS have to operate here* — plural, simultaneous,
 * and not reducible to one id.
 *
 * The existing single-concept resolvers are correct for their jobs and wrong for this one:
 *
 *   - `resolveSpecialtyConceptKey` returns ONE `SpecialtyConceptKey`. A Survivor All-Stars
 *     Guillotine league is guillotine AND survivor-tribal AND scheduled-roster-mutation AND
 *     power/reward bearing, and any single key discards three of those.
 *   - `resolveLeagueRules` reports one `concept` plus `modifiers`, which is the right shape for
 *     "explain this league" but still names one primary format.
 *
 * So capabilities are a SET, composed from four independent sources (format, concept, modifiers,
 * template). Nothing here replaces a single-concept resolver — `CommissionerLeagueProfile` carries
 * `legacySpecialtyConceptKey` verbatim so the existing handler registry keeps working unchanged.
 *
 * ⚠ A CAPABILITY IS A MECHANIC, NOT A PERMISSION AND NOT A GUARANTEE THAT IT IS IMPLEMENTED.
 * `standings.promotion_relegation` means "this league promotes and relegates", not "Commissioner OS
 * may run it now" (that is `lib/commissioner-os/authority.ts`) and not "the engine is production
 * safe" (Survivor's runtime is explicitly not, per the repo's own audit). Reading it as either is
 * how a fixture becomes a false claim.
 *
 * Pure: ids in, ids out. No DB, no I/O, no clock.
 */

import type { LeagueFormatId } from '@/lib/league/format-engine'

/**
 * Every mechanic Commissioner OS can be asked to observe, explain, prepare or execute.
 *
 * Namespaced `domain.mechanic` on purpose: the domain prefix is what lets a surface ask "does this
 * league have ANY power mechanics" without enumerating them, and it keeps the union readable as it
 * grows past the two launch templates.
 *
 * ⚠ ADDITIVE ONLY. Removing or renaming an id silently changes what a PINNED template claims — see
 * the versioning note in `lib/commissioner-os/template/types.ts`. Add a new id and leave the old
 * one in place.
 */
export type CommissionerCapabilityId =
  // --- roster lifecycle -----------------------------------------------------
  /** Rosters carry from season to season. */
  | 'roster.dynasty_carryover'
  /** A bounded number of players carry into the next draft at a cost. */
  | 'roster.keeper_carryover'
  /** Starting lineup or bench size changes on a PUBLISHED schedule mid-season. */
  | 'roster.scheduled_expansion'
  /** College players are held on the same roster as professionals. */
  | 'roster.college_assets'
  // --- lineup ---------------------------------------------------------------
  /** Lineups are scored optimally after the fact; nobody sets one. */
  | 'lineup.best_ball'
  // --- elimination ----------------------------------------------------------
  /** Lowest scorer is removed and their roster is released. */
  | 'elimination.guillotine'
  /** More than one team leaves per scoring period. */
  | 'elimination.double'
  /** Immunity can pass an elimination to the next eligible team. */
  | 'elimination.immunity'
  // --- survivor tribal ------------------------------------------------------
  | 'survivor.tribes'
  | 'survivor.tribe_shuffle'
  | 'survivor.match_play'
  | 'survivor.tribe_champion'
  | 'survivor.merge'
  | 'survivor.final_placement'
  // --- powers / rewards -----------------------------------------------------
  | 'powers.idol'
  | 'powers.swap_token'
  | 'rewards.faab'
  // --- draft ----------------------------------------------------------------
  /** Rookie draft order is computed from something other than reverse standings. */
  | 'draft.custom_rookie_order'
  /** Captains pick in schoolyard order rather than snake order. */
  | 'draft.schoolyard'
  // --- standings / advancement ---------------------------------------------
  | 'standings.promotion_relegation'
  | 'standings.tier_playoffs'
  /** A standings input is frozen at a point in the season and stops moving. */
  | 'standings.frozen_input'
  | 'advancement.tournament'
  // --- governance -----------------------------------------------------------
  /** Rules are commissioner-configurable rather than fixed by the format. */
  | 'governance.configurable_rules'
  // --- trading --------------------------------------------------------------
  /** The format forbids trades outright. */
  | 'trades.disabled'
  // --- scoring --------------------------------------------------------------
  | 'scoring.idp'
  // --- phase machinery ------------------------------------------------------
  /** The league moves through named phases with defined transitions. */
  | 'phase.state_machine'

/**
 * Capabilities implied by the canonical format alone.
 *
 * ⚠ DELIBERATELY THIN. A format only earns a capability here when it is true of EVERY league of
 * that format — the concept and template layers add the rest. Guillotine gets
 * `elimination.guillotine` because a guillotine league without it is not a guillotine league;
 * it does NOT get `powers.idol`, because plain Guillotine has no idols and only the Survivor
 * All-Stars variant adds them.
 */
const FORMAT_CAPABILITIES: Readonly<Record<LeagueFormatId, readonly CommissionerCapabilityId[]>> = {
  redraft: [],
  dynasty: ['roster.dynasty_carryover'],
  keeper: ['roster.keeper_carryover'],
  best_ball: ['lineup.best_ball'],
  guillotine: ['elimination.guillotine', 'rewards.faab'],
  survivor: ['survivor.tribes', 'phase.state_machine'],
  tournament: ['advancement.tournament', 'phase.state_machine'],
  devy: ['roster.dynasty_carryover', 'roster.college_assets'],
  c2c: ['roster.dynasty_carryover', 'roster.college_assets'],
  zombie: ['elimination.guillotine'],
  salary_cap: ['governance.configurable_rules'],
  big_brother: ['phase.state_machine', 'elimination.immunity'],
}

/**
 * Capabilities implied by a catalog concept id, where the concept says more than its base format.
 *
 * 🛑 `survivor_guillotine` IS THE WHOLE REASON THIS LAYER EXISTS. It is a catalog-only entry
 * (`formatRulesConcept: null`) that no classifier emits, and it is simultaneously guillotine and
 * survivor and scheduled-roster and power-bearing. Every single-concept resolver in this repo has
 * to pick one of those and throw the others away. Here it is all of them at once, which is the
 * additive property the C0.5 brief asked for.
 *
 * ⚠ KEYED ON `ConceptCatalogEntry.id`, NOT on `LeagueConcept`. Those are different id spaces —
 * the catalog carries `pirate_vampire` where the classifier returns `pirate`, and the catalog has
 * entries (`survivor_guillotine`, `royal`, `big_brother`) that the classifier never returns at all.
 */
const CONCEPT_CAPABILITIES: Readonly<Record<string, readonly CommissionerCapabilityId[]>> = {
  survivor_guillotine: [
    'elimination.guillotine',
    'elimination.double',
    'elimination.immunity',
    'survivor.tribes',
    'survivor.tribe_shuffle',
    'survivor.match_play',
    'survivor.tribe_champion',
    'survivor.merge',
    'survivor.final_placement',
    'powers.idol',
    'powers.swap_token',
    'rewards.faab',
    'roster.scheduled_expansion',
    'draft.schoolyard',
    'trades.disabled',
    'phase.state_machine',
  ],
  royal: ['roster.dynasty_carryover', 'governance.configurable_rules'],
  pirate_vampire: ['roster.dynasty_carryover', 'elimination.immunity'],
  king_of_the_hill: ['phase.state_machine'],
  big_brother: ['phase.state_machine', 'elimination.immunity', 'powers.idol'],
}

/**
 * Capabilities implied by a modifier.
 *
 * ⚠ A MODIFIER ADDS, IT NEVER REPLACES. `idp` contributes `scoring.idp` and touches nothing else —
 * which is the same separation `readFormatRules` enforces with its `FORMAT_ALIASES` allowlist, and
 * for the same measured reason: 183 of 271 production leagues carry `['idp']`, and letting a
 * modifier speak as a format demoted 97 dynasty leagues to redraft.
 */
const MODIFIER_CAPABILITIES: Readonly<Record<string, readonly CommissionerCapabilityId[]>> = {
  idp: ['scoring.idp'],
}

/** Stable ordering so a capability list is byte-identical across runs. Determinism is testable. */
function sortCapabilities(ids: Iterable<CommissionerCapabilityId>): CommissionerCapabilityId[] {
  return [...new Set(ids)].sort()
}

/**
 * Compose the capability set for a league.
 *
 * Four independent sources, unioned. None of them is authoritative over another — a template can
 * only ADD to what the format and concept already imply, never subtract, because a template that
 * could remove `elimination.guillotine` from a guillotine league would be describing a different
 * league than the one the classifier found.
 */
export function composeCapabilities(input: {
  canonicalFormatId: LeagueFormatId | null
  conceptId: string | null
  modifierIds: readonly string[]
  templateCapabilityIds?: readonly CommissionerCapabilityId[]
}): CommissionerCapabilityId[] {
  const out = new Set<CommissionerCapabilityId>()

  if (input.canonicalFormatId) {
    for (const c of FORMAT_CAPABILITIES[input.canonicalFormatId] ?? []) out.add(c)
  }
  if (input.conceptId) {
    for (const c of CONCEPT_CAPABILITIES[input.conceptId] ?? []) out.add(c)
  }
  for (const m of input.modifierIds) {
    for (const c of MODIFIER_CAPABILITIES[m] ?? []) out.add(c)
  }
  for (const c of input.templateCapabilityIds ?? []) out.add(c)

  return sortCapabilities(out)
}

/** Capabilities a format implies on its own. Exported for tests and for template validation. */
export function capabilitiesForFormat(formatId: LeagueFormatId): CommissionerCapabilityId[] {
  return sortCapabilities(FORMAT_CAPABILITIES[formatId] ?? [])
}

/** Capabilities a catalog concept implies beyond its base format. */
export function capabilitiesForConcept(conceptId: string): CommissionerCapabilityId[] {
  return sortCapabilities(CONCEPT_CAPABILITIES[conceptId] ?? [])
}

/** True when the league has any capability in a domain, e.g. `hasCapabilityDomain(caps, 'powers')`. */
export function hasCapabilityDomain(
  capabilityIds: readonly CommissionerCapabilityId[],
  domain: string,
): boolean {
  const prefix = `${domain}.`
  return capabilityIds.some((id) => id.startsWith(prefix))
}
