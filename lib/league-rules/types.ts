/**
 * Types for the league rule catalog.
 *
 * 🛑 THE CATALOG IS AN INDEX, NOT AN ENGINE. It explains rules; it never
 * classifies a league. Classification belongs to `readFormatRules`
 * (`lib/trade-intel/leagueFormatRules.ts`), which is the ONE place that knows
 * `aliasTags` carries two different kinds of thing. That module records the
 * measurement: taking `alias[0]` instead of its FORMAT_ALIASES allowlist
 * reprices 110 of 271 production leagues, 97 of them dynasty leagues demoted to
 * redraft by a scoring flag. A second classifier here would be that bug again
 * under a new name, so this module deliberately owns no detection logic.
 */

import type { LeagueConcept } from '@/lib/trade-intel/leagueFormatRules'

/**
 * Where a rule value came from. Three-valued on purpose.
 *
 * 🛑 `unknown` IS NOT `catalog_default`, AND COLLAPSING THEM IS THE FAILURE THIS
 * FIELD EXISTS TO PREVENT. An imported league whose keeper rule we never
 * received must read as unknown; answering with the template's default there
 * states a rule the commissioner never set, in a voice indistinguishable from a
 * rule they did. The brief is explicit: "Defaults must be marked as defaults;
 * missing imported fields remain unknown."
 */
export type RuleProvenance =
  /** Read from this league's own stored settings. Overrides everything. */
  | 'league_setting'
  /** The concept's documented default. True of the format, not of this league. */
  | 'catalog_default'
  /**
   * The value equals the Prisma column default, so NOBODY IS KNOWN TO HAVE SET IT.
   *
   * 🛑 THIS EXISTS BECAUSE THE SCHEMA MAKES "UNSET" INVISIBLE. `League` declares
   * `keeperCount @default(3)`, `keeperCostSystem @default("round_based")` and
   * `keeperRoundPenalty @default(1)`, so EVERY row carries a keeper policy
   * whether or not a commissioner ever chose one — including redraft leagues
   * with no keepers at all. Reading the column and calling it `league_setting`
   * would state an invented rule about essentially every league in the database,
   * in the same confident voice as a real one.
   *
   * ⚠ IT IS DELIBERATELY NOT `unknown`. The value may well be correct, and a
   * commissioner who genuinely chose `round_based` is indistinguishable from the
   * default from the row alone. So this says what is true — "this is the
   * default; it has not been confirmed for this league" — and leaves the answer
   * to say so too.
   */
  | 'schema_default'
  /** Not on file. Never guess, never substitute a default. */
  | 'unknown'

/** A rule value carrying where it came from. */
export type ResolvedRule<T> = {
  value: T | null
  provenance: RuleProvenance
  /** Human-readable source, e.g. "league settings" or "Guillotine v1 default". */
  basis: string
}

/** A lifecycle phase a league of this concept moves through. */
export type ConceptPhase = {
  id: string
  label: string
  /** What is legal, and what the manager should be thinking about, in this phase. */
  summary: string
}

/**
 * An action the concept permits *as a format*.
 *
 * ⚠ THIS IS FORMAT LEGALITY ONLY — it answers "does this format have trades at
 * all", not "may this user do it now". Permission, role, phase and league state
 * are checked at execution by `lib/chimmy-actions`. A `true` here is a
 * necessary condition, never a sufficient one.
 */
export type ConceptAction = {
  id: string
  label: string
  /** False when the format forbids it outright (e.g. trades in Survivor Guillotine). */
  legalInFormat: boolean
  /** Why, when false or conditional. */
  note?: string
}

/**
 * One concept's entry in the catalog.
 *
 * `ruleVersion` is a content version for THIS ENTRY, bumped when the documented
 * rules change. It is not a schema version and not a league's settings version.
 */
export type ConceptCatalogEntry = {
  /** Catalog id. Matches a `LeagueConcept` where one exists, else a catalog-only id. */
  id: string
  label: string
  ruleVersion: string
  /**
   * The `LeagueConcept` that `readFormatRules` returns for this entry, when it
   * returns one. `null` for catalog-only entries that no classifier emits yet —
   * they are reachable by explicit id, never by classification.
   */
  formatRulesConcept: LeagueConcept | null
  /**
   * Alias tags in `conceptRules.extensions.aliasTags` that indicate this concept.
   * Read by `readConceptAliasTags`; classified by `FORMAT_ALIASES`.
   */
  aliasTags: string[]
  /**
   * The base format this concept is flattened onto at creation, if any.
   *
   * ⚠ THE ALIAS IS THE REAL FORMAT. `normalizeConcept.ts` stores King of the
   * Hill as `redraft` + `['king_of_the_hill']`. A reader that stops at the base
   * format has lost the concept — which is the acceptance scenario "King of the
   * Hill retains its concept when its base format is redraft".
   */
  flattenedOnto: string | null
  /** Sports this concept is actually implemented for. Empty means not sport-scoped. */
  supportedSports: string[]
  /** One or two sentences. What this format IS. */
  summary: string
  /** How a team leaves, when the format eliminates. Null when it does not. */
  elimination: string | null
  /** Tiebreak rule, when the format defines one. */
  tiebreak: string | null
  /** Playoff structure, when the format defines one. */
  playoffs: string | null
  phases: ConceptPhase[]
  actions: ConceptAction[]
  /**
   * Settings a commissioner configures for this concept. Names are catalog
   * labels for explanation; they are not a schema and are not read back.
   */
  configurableFields: string[]
  /**
   * The runtime modules that actually implement this concept. Recorded so a
   * reader can go to the authority instead of trusting this text.
   */
  runtimeAuthority: string[]
}
