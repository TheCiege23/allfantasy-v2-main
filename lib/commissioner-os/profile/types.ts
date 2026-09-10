/**
 * `CommissionerLeagueProfile` — the canonical description of a league for Commissioner OS.
 *
 * 🛑 IT COMPOSES `resolveLeagueRules`. IT DOES NOT RE-DERIVE ANYTHING IT ALREADY ANSWERS.
 * `lib/league-rules/resolveLeagueRules.ts` already resolves concept, modifiers, alias tags, the
 * flattened base, the pricing base and keeper rules WITH PROVENANCE, and it is already pure. Every
 * one of those fields is carried here verbatim, and `rules` holds the whole resolution so a caller
 * can reach the provenance rather than a lossy copy of it.
 *
 * That is not politeness about existing code. `readFormatRules` carries a measured rule — its
 * `FORMAT_ALIASES` allowlist is what stops `idp` being read as a format, and taking `alias[0]`
 * instead repriced 110 of 271 production leagues, 97 of them dynasty leagues demoted to redraft by a
 * scoring flag. A second classifier here would be that bug again under a new name.
 *
 * ## What this profile adds that no existing resolver can
 *
 *  1. `capabilityIds` — a SET. One specialty concept is not enough for a league that is
 *     simultaneously guillotine, survivor-tribal, power-bearing and roster-mutating.
 *  2. `template` — a pinned, versioned ruleset, resolved exactly or reported unresolved.
 *  3. `writeAuthority` — whether AllFantasy can act here at all, separate from role.
 *  4. `commissionerRole` — who is asking, as an EXPLICIT INPUT (see below).
 *  5. `resolution` / `degradedReasons` — an honest unknown instead of a confident default.
 *
 * ## Role and platform are inputs, not lookups
 *
 * ⚠ `commissionerRole` AND `platform` ARE PASSED IN, NEVER READ FROM THE DATABASE HERE. The
 * authoritative role resolver (`getLeagueRole` in `lib/league/permissions.ts`) imports prisma, and
 * pulling it into this module would make the pure core DB-bound and drag `@prisma/client` — which,
 * as this repo has measured twice, populates `process.env` from `.env` on import and has pointed
 * "local" test suites at production. The caller already has the role; it hands it over.
 *
 * ## Degrading honestly
 *
 * 🛑 AN UNKNOWN FORMAT MUST NOT RESOLVE TO REDRAFT HERE. `toFormatId` in `lib/league/format-engine.ts`
 * does exactly that (`FORMAT_REGISTRY[normalized] ? normalized : 'redraft'`) and it is correct for
 * the create wizard, where something has to be offered. It is wrong for Commissioner OS, where
 * "redraft" would silently switch off every specialty behaviour a league actually has and report
 * itself healthy. So this module does its own STRICT lookup and reports `canonicalFormatId: null`
 * with `resolution: 'degraded'` when nothing matches.
 */

import type { LeagueSport } from '@prisma/client'
import type { LeagueFormatId } from '@/lib/league/format-engine'
import type { LeagueRole } from '@/lib/league/permissions'
import type { WriteAuthority } from '@/lib/league/write-authority'
import type { ResolvedLeagueRules } from '@/lib/league-rules'
import type { SpecialtyConceptKey } from '@/lib/specialty-automation/types'
import type { CommissionerCapabilityId } from '@/lib/commissioner-os/capabilities'
import type { LeagueTemplateDefinition } from '@/lib/commissioner-os/template/types'

/**
 * Contract version of the profile SHAPE.
 *
 * ⚠ NOT a league's template version and not the rule catalog's `CATALOG_VERSION`. Bumped when this
 * object's fields change, so a consumer that stored one can tell whether it still understands it.
 */
export const COMMISSIONER_PROFILE_VERSION = '1.0.0'

/**
 * How `canonicalFormatId` was arrived at.
 *
 * ⚠ REPORTED BECAUSE THE PRECEDENCE IS LOAD-BEARING AND NON-OBVIOUS. A King of the Hill league's
 * canonical format is `redraft` via `flattened_base` — the concept is King of the Hill and the
 * format underneath it is redraft, and a reader that cannot tell those apart is the exact failure
 * `ConceptCatalogEntry.flattenedOnto` was written to prevent.
 */
export type CommissionerFormatBasis =
  /** The catalog concept names a base format it was flattened onto (KOTH -> redraft). */
  | 'flattened_base'
  /** The catalog concept id is itself a canonical format id (guillotine, dynasty, ...). */
  | 'concept_id'
  /** No catalog concept, but the classifier's pricing base is a canonical format id. */
  | 'pricing_base'
  /**
   * Neither answered, and the league's PINNED template declares a base format.
   *
   * ⚠ LAST, NEVER FIRST. A pinned template must not overrule the classifier — a league mis-pinned
   * to the wrong template would then report the wrong format with full confidence, and the pin is
   * the least-verified input of the three. This step exists for the genuinely unclassifiable case,
   * of which `survivor_guillotine` is the live example: it is a catalog-only concept whose id is
   * not a `LeagueFormatId` and whose classifier answer is `other`, so without the pin the profile
   * would degrade to `unknown_format` on a league whose format is written down in its own template.
   */
  | 'template_base'
  /** Nothing matched. `canonicalFormatId` is null and the profile is degraded. */
  | 'unresolved'

export type CommissionerProfileDegradeReason =
  /** No canonical format could be identified. Specialty behaviour must not be assumed. */
  | 'unknown_format'
  /** No catalog concept matched, so there is no documented rule set to explain. */
  | 'no_catalog_concept'
  /** The league is pinned to a template id/version the registry does not have. */
  | 'template_pin_unresolved'
  /** The league is pinned to a template that does not claim this sport. */
  | 'template_sport_incompatible'
  /** The concept does not claim to support this league's sport. */
  | 'concept_sport_unsupported'

export type CommissionerTemplateBinding = {
  id: string
  version: string
  key: string
  /** The definition, when the exact pin resolved. Null when it did not. */
  definition: LeagueTemplateDefinition | null
  /** Why it did not resolve. Null when it did. */
  unresolvedReason: string | null
}

/**
 * Network membership — the seam for leagues that belong to a wider structure (a network of EFL
 * ladders, a tournament circuit).
 *
 * ⚠ NOTHING IN THIS REPO POPULATES THIS. It is an explicit caller-supplied passthrough so the
 * contract has the shape, and it is typed as optional-and-null rather than invented, because a
 * field with a plausible default and no data source is how a fixture becomes a false claim.
 */
export type CommissionerNetworkMembership = {
  networkId: string
  role: 'member' | 'host'
  label?: string
}

export type CommissionerLeagueProfile = {
  profileVersion: string

  // --- identity -------------------------------------------------------------
  leagueId: string
  season: number | null
  sport: LeagueSport | null

  // --- format, alias-preserving --------------------------------------------
  /** Null when nothing matched. NEVER silently 'redraft'. */
  canonicalFormatId: LeagueFormatId | null
  formatBasis: CommissionerFormatBasis
  /** `ConceptCatalogEntry.id` — the product concept. Null when no catalog entry matched. */
  conceptId: string | null
  conceptLabel: string | null
  /** The base format a flattened concept sits on (KOTH -> 'redraft'). Null when not flattened. */
  flattenedOnto: string | null
  /** What VALUES the league, from the classifier. Kept beside `conceptId`, never instead of it. */
  pricingBaseFormat: string
  /** Verbatim from `conceptRules.extensions.aliasTags`. */
  aliasTags: string[]
  /** Catalog ids of scoring/roster modifiers that accompany the format (e.g. `idp`). */
  modifierIds: string[]

  // --- the additive layer ---------------------------------------------------
  capabilityIds: CommissionerCapabilityId[]
  template: CommissionerTemplateBinding | null

  /**
   * The legacy single-concept key, carried unchanged.
   *
   * 🛑 COMPATIBILITY, NOT DUPLICATION. `dispatchConceptHandler` switches on this and every existing
   * specialty handler still runs off it. The C0.5 brief is explicit that the legacy path must not be
   * removed in this phase, so the profile carries it rather than replacing it — a Commissioner OS
   * surface reads `capabilityIds`, the automation pipeline keeps reading this, and neither has to
   * know about the other yet.
   */
  legacySpecialtyConceptKey: SpecialtyConceptKey

  // --- who is asking, and what AF may do -----------------------------------
  commissionerRole: LeagueRole
  platform: string | null
  writeAuthority: WriteAuthority
  networkMembership: CommissionerNetworkMembership | null

  // --- lifecycle ------------------------------------------------------------
  lifecycleState: string | null
  status: string | null

  // --- honesty --------------------------------------------------------------
  resolution: 'resolved' | 'degraded'
  degradedReasons: CommissionerProfileDegradeReason[]

  /**
   * The full rule resolution, carried rather than summarised.
   *
   * ⚠ THE PROVENANCE LIVES IN HERE AND IT MATTERS. `rules.keeper.maxKeepers.provenance` can be
   * `schema_default`, which means the row carries Prisma's `@default(3)` and NOBODY IS KNOWN TO
   * HAVE CHOSEN IT. Flattening that to a number would state a rule about essentially every league
   * in the database in the same confident voice as a real one.
   */
  rules: ResolvedLeagueRules
}
