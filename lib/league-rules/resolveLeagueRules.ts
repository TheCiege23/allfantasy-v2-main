/**
 * Resolve a league row into its catalog entry plus the rules that actually
 * apply to it, each carrying where it came from.
 *
 * 🛑 THIS MODULE CLASSIFIES NOTHING. `readFormatRules` decides what format a
 * league is, and `readConceptAliasTags` decides where the alias tags live.
 * Both already exist, both carry measurements about what happens when they are
 * re-derived, and a second opinion here would be the 110-league misclassification
 * in a new file. Everything below is composition: call the authorities, look the
 * answer up in the catalog, attach provenance.
 *
 * ⚠ RESOLUTION ORDER IS LEAGUE SETTING → CATALOG DEFAULT → UNKNOWN, and the
 * third is a real outcome, not a failure. The brief: "Resolved league settings
 * override template defaults... Defaults must be marked as defaults; missing
 * imported fields remain unknown."
 */

import { readFormatRules, type FormatRules } from '@/lib/trade-intel/leagueFormatRules'
import { readConceptAliasTags } from '@/lib/league-contract/conceptAliasTags'
import { CATALOG_VERSION, getConceptForFormat, getConceptsForAliasTags } from './conceptCatalog'
import type { ConceptCatalogEntry, ResolvedRule } from './types'

/** The league fields this resolver reads. A subset of the Prisma row on purpose. */
export type LeagueRuleInput = {
  leagueType?: string | null
  isDynasty?: boolean | null
  keeperCount?: number | null
  keeperCostSystem?: string | null
  keeperRoundPenalty?: number | null
  /** Raw `settings` JSON. Alias tags are read out of it by the one reader that knows the path. */
  settings?: unknown
  /** Sport, when the caller has it. Used only to report coverage, never to classify. */
  sport?: string | null
}

export type ResolvedLeagueRules = {
  catalogVersion: string
  /**
   * The format the league actually is, from `readFormatRules`. Present even
   * when no catalog entry matches.
   */
  formatRules: FormatRules
  /**
   * The catalog entry for the resolved format, or null when the format is one
   * the catalog does not document (including `other`).
   */
  concept: ConceptCatalogEntry | null
  /**
   * Scoring/roster modifiers that ACCOMPANY the format rather than replace it.
   *
   * ⚠ IDP LIVES HERE, NOT IN `concept`. That separation is the acceptance
   * scenario "IDP does not erase dynasty" — the modifier is reported alongside
   * a dynasty concept, never instead of it.
   */
  modifiers: ConceptCatalogEntry[]
  /** Alias tags actually stored on the league, verbatim. */
  aliasTags: string[]
  /**
   * The base format the concept was flattened onto, when it was flattened.
   * Non-null only for KOTH / pirate / royal, and reported so an explanation can
   * say "King of the Hill, on a redraft shell" rather than picking one.
   */
  flattenedOnto: string | null
  /** Sport, when supplied, and whether the concept claims to support it. */
  sport: string | null
  sportSupported: boolean | null
  /** Keeper rules, resolved with provenance. */
  keeper: {
    maxKeepers: ResolvedRule<number>
    costSystem: ResolvedRule<string>
    roundPenalty: ResolvedRule<number>
    futurePicksTradeable: ResolvedRule<boolean>
  }
}

function unknownRule<T>(basis: string): ResolvedRule<T> {
  return { value: null, provenance: 'unknown', basis }
}

function fromLeague<T>(value: T, basis: string): ResolvedRule<T> {
  return { value, provenance: 'league_setting', basis }
}

/**
 * The Prisma column defaults on `League`, verbatim from `prisma/schema.prisma`.
 *
 * 🛑 EVERY LEAGUE ROW CARRIES THESE WHETHER OR NOT ANYONE CHOSE THEM.
 * `keeperCount @default(3)`, `keeperCostSystem @default("round_based")`,
 * `keeperRoundPenalty @default(1)` — so reading the column and reporting it as
 * the commissioner's setting invents a keeper policy for every league in the
 * database, redraft leagues included. Matching against these is what lets the
 * resolver say "default, unconfirmed" instead.
 *
 * ⚠ THIS IS A MIRROR OF THE SCHEMA AND WILL DRIFT IF THE SCHEMA CHANGES.
 * `__tests__/league-rules/conceptCatalog.test.ts` parses `schema.prisma` and
 * fails when these disagree, so the drift is loud rather than silent.
 */
export const LEAGUE_COLUMN_DEFAULTS = {
  keeperCount: 3,
  keeperCostSystem: 'round_based',
  keeperRoundPenalty: 1,
} as const

/**
 * A value read off the row, classified by whether it is distinguishable from the
 * column default.
 *
 * ⚠ A MATCH IS NOT PROOF NOBODY SET IT — a commissioner who genuinely chose
 * `round_based` looks identical. `schema_default` says exactly that much and no
 * more, which is the honest reading of a column that cannot tell them apart.
 */
function fromColumn<T>(value: T | null | undefined, columnDefault: T, label: string): ResolvedRule<T> {
  if (value === null || value === undefined) {
    return unknownRule(`not on file for this league (${label})`)
  }
  if (value === columnDefault) {
    return {
      value,
      provenance: 'schema_default',
      basis: `the ${label} column default — every league carries it, so it is NOT confirmed for this one`,
    }
  }
  return fromLeague(value, 'league settings')
}

/**
 * Resolve every rule that applies to this league.
 *
 * Pure and synchronous. It reads a row the caller already has; it opens no
 * connection and calls no provider, so it is safe on a request path.
 */
export function resolveLeagueRules(league: LeagueRuleInput): ResolvedLeagueRules {
  const aliasTags = readConceptAliasTags(league.settings)

  /*
   * ⚠ THE ALIAS TAGS MUST BE HANDED TO `readFormatRules`, NOT INTERPRETED HERE.
   * That function's own header says "READ THESE OR FOUR FORMATS PRICE AS
   * SOMETHING ELSE", and its FORMAT_ALIASES allowlist is what stops `idp` being
   * mistaken for a format. Passing them through is the entire point of this call.
   */
  const formatRules = readFormatRules({
    leagueType: league.leagueType,
    isDynasty: league.isDynasty,
    keeperCount: league.keeperCount,
    keeperCostSystem: league.keeperCostSystem,
    keeperRoundPenalty: league.keeperRoundPenalty,
    aliasTags,
  })

  const concept = getConceptForFormat(formatRules.concept)

  /*
   * Modifiers are the alias-tag matches that are NOT the resolved format.
   * Comparing by catalog id rather than by tag keeps this correct when a
   * concept carries several aliases (koth answers to both `king_of_the_hill`
   * and `koth`).
   */
  const aliasMatches = getConceptsForAliasTags(aliasTags)
  const modifiers = aliasMatches.filter((m) => m.id !== concept?.id)

  const sport = league.sport ? String(league.sport).trim().toUpperCase() : null
  /*
   * ⚠ THREE-VALUED, AND `null` IS NOT `false`. Null means we cannot say —
   * either no sport was supplied or the concept declares no sport scope. Saying
   * "not supported" there would be a claim we have no basis for.
   */
  const sportSupported =
    !sport || !concept || concept.supportedSports.length === 0
      ? null
      : concept.supportedSports.includes(sport)

  return {
    catalogVersion: CATALOG_VERSION,
    formatRules,
    concept,
    modifiers,
    aliasTags,
    flattenedOnto: concept?.flattenedOnto ?? null,
    sport,
    sportSupported,
    keeper: {
      maxKeepers: fromColumn(formatRules.maxKeepers, LEAGUE_COLUMN_DEFAULTS.keeperCount, 'keeperCount'),
      costSystem: fromColumn(
        formatRules.keeperCostSystem || null,
        LEAGUE_COLUMN_DEFAULTS.keeperCostSystem,
        'keeperCostSystem'
      ),
      roundPenalty: fromColumn(
        formatRules.keeperRoundPenalty,
        LEAGUE_COLUMN_DEFAULTS.keeperRoundPenalty,
        'keeperRoundPenalty'
      ),
      /*
       * 🛑 NULL HERE IS UNKNOWN AND MUST NOT BECOME "YES". `FormatRules` says so
       * in its own comment: keeper leagues genuinely differ on whether pick
       * trading is ever opened, and we read that setting from no platform.
       * Guessing yes prices assets that may not be movable; guessing no hides
       * real ones. This is the acceptance scenario "an unknown imported keeper
       * rule remains unknown".
       */
      futurePicksTradeable:
        typeof formatRules.futurePicksTradeable === 'boolean'
          ? {
              value: formatRules.futurePicksTradeable,
              /*
               * ⚠ THIS IS DERIVED FROM THE FORMAT, NOT READ FROM THE LEAGUE, AND
               * SAYING OTHERWISE MATTERS. `readFormatRules` returns false for
               * redraft because future rookie picks DO NOT EXIST there, and true
               * for dynasty because they always do — neither is a setting anyone
               * chose. Calling it `league_setting` would also make it count
               * towards "this league configured its keeper rules", which staples
               * a keeper block onto every redraft league.
               */
              provenance: 'catalog_default',
              basis: `implied by the ${formatRules.concept} format itself`,
            }
          : unknownRule('not read from any platform — differs by league'),
    },
  }
}
