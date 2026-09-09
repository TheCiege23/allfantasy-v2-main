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

import {
  FORMAT_ALIASES,
  LEAGUE_COLUMN_DEFAULTS,
  MODIFIER_ALIASES,
  readFormatRules,
  type FormatRules,
  type KeeperEvidence,
} from '@/lib/trade-intel/leagueFormatRules'
import { readConceptAliasTags } from '@/lib/league-contract/conceptAliasTags'
import { keeperSettingsConfirmedFrom } from '@/lib/league-contract/keeperProvenance'
import {
  CATALOG_VERSION,
  getConceptById,
  getConceptForFormat,
  getConceptsForAliasTags,
} from './conceptCatalog'
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
  /**
   * Independent proof the keeper settings were intentionally chosen. Forwarded
   * verbatim to `readFormatRules`; this module forms no opinion about it.
   */
  keeperSettingsConfirmed?: boolean | null
}

export type ResolvedLeagueRules = {
  catalogVersion: string
  /**
   * The format the league actually is, from `readFormatRules`. Present even
   * when no catalog entry matches.
   */
  formatRules: FormatRules
  /**
   * What the league IS — the primary product concept.
   *
   * ⚠ NOT THE SAME AS `pricingBaseFormat`, and deliberately so. A Royal league's
   * concept is Royal; its pricing base is dynasty. Null only when nothing —
   * alias, leagueType or classifier — matches a catalog entry.
   */
  concept: ConceptCatalogEntry | null
  /**
   * What VALUES the league — the classifier's concept, which pricing selects on.
   *
   * ⚠ THIS IS THE FIELD THE TRADE ENGINES USE, and it is reported separately so
   * an explanation can say "Royal, priced as dynasty" instead of having to pick
   * one and erase the other. Equal to `concept.formatRulesConcept` for the
   * common case; different exactly when a format was flattened onto a shell.
   */
  pricingBaseFormat: string
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
  /**
   * Why the classifier did or did not treat this as a keeper league.
   *
   * ⚠ `null` WITH A NON-ZERO `keeper.maxKeepers` IS THE INTERESTING CASE, not a
   * contradiction: the row carries the schema default of 3 and nobody is known
   * to have chosen it. The value is reportable as an unconfirmed default; it
   * has simply not earned keeper classification or keeper pricing.
   */
  keeperEvidence: KeeperEvidence
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

/*
 * ⚠ `LEAGUE_COLUMN_DEFAULTS` IS RE-EXPORTED, NOT REDEFINED. It briefly lived
 * here as its own copy, which is two implementations of one rule — the bug this
 * repo has paid for before. It now lives with the classifier that reads it,
 * because the classifier is the thing whose correctness depends on it.
 */
export { LEAGUE_COLUMN_DEFAULTS }

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
    /*
     * ⚠ AN EXPLICIT ARGUMENT WINS, AND ABSENT FALLS THROUGH TO THE SETTINGS
     * BLOCK — it is NOT coerced to false. `keeperSettingsConfirmedFrom` returns
     * `undefined` when no provenance was ever written, which is what lets the
     * differs-from-default heuristic still speak for older rows. Using `??`
     * rather than `||` matters: `false` is a real answer here ("the provider
     * says this is not a keeper league") and `||` would discard it.
     */
    keeperSettingsConfirmed:
      league.keeperSettingsConfirmed ?? keeperSettingsConfirmedFrom(league.settings),
  })

  /*
   * 🛑 THE PRIMARY CONCEPT AND THE PRICING BASE ARE DIFFERENT QUESTIONS, AND
   * COLLAPSING THEM ERASES THE PRODUCT.
   *
   * `readFormatRules` maps Royal onto `dynasty` — correctly, because dynasty is
   * how a Royal league must be PRICED (rosters carry over, future picks are
   * real). But a manager in a Royal league is not in a dynasty league, and
   * grounding that says "Dynasty, plus a modifier called Royal" has described
   * the shell and thrown away the format.
   *
   * So both are kept: `concept` is what the league IS, `pricingBaseFormat` is
   * what values it. Neither is derived from the other and neither is dropped.
   *
   * Resolution order, most specific first:
   *   1. a FORMAT alias tag that names a catalog entry — Royal, KOTH, Pirate
   *   2. `leagueType` matching a catalog entry id directly — this is what makes
   *      the catalog-only concepts reachable (Survivor All-Stars Guillotine,
   *      Big Brother, Salary Cap, Best Ball), none of which any classifier
   *      emits, without inventing a classifier branch for them
   *   3. the classifier's concept
   *
   * ⚠ STEP 1 USES `FORMAT_ALIASES`, THE EXISTING AUTHORITY, RATHER THAN ASKING
   * "is this tag also a catalog id". `idp` is a catalog entry AND an alias tag,
   * and without that allowlist it would win step 1 and become the primary
   * concept of every IDP league — the 97-dynasty-league bug, rebuilt here.
   */
  const aliasMatches = getConceptsForAliasTags(aliasTags)
  const primaryFromAlias =
    aliasMatches.find((e) => e.aliasTags.some((a) => FORMAT_ALIASES.has(a))) ?? null
  /*
   * 🛑 STEP 2 IS RESTRICTED TO CONCEPTS THE CLASSIFIER CANNOT EXPRESS, AND THE
   * UNRESTRICTED VERSION WAS WRONG IN A WAY A TEST CAUGHT IMMEDIATELY.
   *
   * `leagueType` is `redraft` on a keeper league imported from Sleeper — the
   * classifier is what upgrades it to `keeper` on the evidence. An unguarded
   * "does leagueType name a catalog entry" match found the REDRAFT entry and
   * beat that upgrade, silently undoing the keeper work in the same commit that
   * added it.
   *
   * So this step exists only for entries with no `formatRulesConcept`: the
   * catalog-only concepts (Survivor All-Stars Guillotine, Big Brother, Salary
   * Cap, Best Ball, Royal) that no classifier branch emits. Where the classifier
   * HAS an opinion, it wins.
   *
   * ⚠ MODIFIERS ARE EXCLUDED EVEN THOUGH THEY ALSO HAVE A NULL CONCEPT. `idp`
   * qualifies on that test alone, and letting it through would make IDP the
   * primary concept of any league whose `leagueType` read `idp` — the
   * modifier-as-format error, one more time.
   */
  const byLeagueType = getConceptById(String(league.leagueType ?? '').trim().toLowerCase())
  const primaryFromLeagueType =
    byLeagueType &&
    byLeagueType.formatRulesConcept === null &&
    !byLeagueType.aliasTags.some((a) => MODIFIER_ALIASES.has(a))
      ? byLeagueType
      : null

  const concept = primaryFromAlias ?? primaryFromLeagueType ?? getConceptForFormat(formatRules.concept)

  /*
   * Modifiers are the alias-tag matches that are NOT the primary concept.
   * Comparing by catalog id rather than by tag keeps this correct when a
   * concept carries several aliases (koth answers to both `king_of_the_hill`
   * and `koth`).
   */
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
    pricingBaseFormat: formatRules.concept,
    modifiers,
    aliasTags,
    flattenedOnto: concept?.flattenedOnto ?? null,
    sport,
    sportSupported,
    keeperEvidence: formatRules.keeperEvidence,
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
