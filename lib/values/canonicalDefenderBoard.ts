import type { PrismaClient } from '@prisma/client'

import { priceIdpBoard, type LeagueIdpVorpResult } from '@/lib/idp-projections/leagueIdpVorp'
import { getDefaultScoringRules } from '@/lib/scoring-defaults/ScoringDefaultsRegistry'

/**
 * What a defender is worth WITHOUT a league — the league-free counterpart to the offensive
 * market chart.
 *
 * 🛑 THE GAP THIS FILLS, MEASURED ON PRODUCTION 2026-09-06. `PlayerValueSnapshot` prices 399
 * players, all of them QB/RB/WR/TE, because FantasyCalc publishes no defenders and no kickers.
 * Against the 2,105 distinct NFL players actually rostered:
 *
 *     offence (QB/RB/WR/TE/FB)   898 rostered   399 priced
 *     defence                    628 rostered     0 priced
 *     K + DEF                      91 rostered     0 priced
 *
 * Defenders ARE priced today — `loadLeagueIdpVorp` does it well — but only INSIDE a league,
 * because value over replacement is defined against a league's starting requirements. So every
 * surface that asks "what is this player worth" without a league context returns nothing for 719
 * rostered players. This answers that question by naming a reference league instead of inventing
 * a league-free notion of replacement, which does not exist.
 *
 * ⚠ IT ADDS NO NEW VALUATION AND MUST NOT. Every number comes from `priceIdpBoard`, the same
 * function `loadLeagueIdpVorp` calls, with the same curve and the same replacement maths. What
 * is new here is the CONTEXT — a canonical scoring system and a canonical starting requirement.
 * A second way to price a defender is the duplicate-board failure `lib/values/
 * leagueDefenderBoard.ts` names in its own header.
 */

/**
 * The reference league. Guap's decision, 2026-09-06: **12 teams, 3 IDP starters.**
 *
 * ⚠ THESE ARE THE ONLY TWO NUMBERS THAT SET REPLACEMENT LEVEL, so they are constants with a
 * decision attached rather than parameters with defaults. 12 x 3 = 36 starting IDP slots, so
 * replacement is roughly the 37th-best defender. Changing either re-prices the entire board;
 * that is a product decision, not a tuning knob.
 */
export const CANONICAL_NUM_TEAMS = 12

/**
 * Three FLEX slots rather than one LB + one DL + one DB, and the choice is load-bearing.
 *
 * `buildIdpValuations` fills dedicated slots from the projection ranking and then hands each
 * flex slot to whichever remaining defender projects highest — so with flex slots, where the
 * starters come from is an OUTPUT of the projections rather than an assumption imposed on them.
 * Its own header calls that out: "NO INVENTED SHARES". Specifying 1/1/1 would assert that a
 * league starts one of each, which "3 IDP starters" does not say.
 */
export const CANONICAL_IDP_SLOTS: readonly string[] = ['IDP_FLEX', 'IDP_FLEX', 'IDP_FLEX']

/**
 * Balanced scoring, taken from the registry rather than copied.
 *
 * ⚠ THE SCORING CHOICE CHANGES THE ORDERING, NOT JUST THE SPREAD, WHICH IS WHY IT IS NAMED
 * LOUDLY HERE. Under tackle-weighted rules an edge rusher loses to a tackle-machine linebacker;
 * under big-play rules the reverse. The registry ships three NFL IDP profiles and the
 * UNQUALIFIED key `NFL-IDP` resolves to "Default NFL IDP (Balanced)" — so Balanced is the
 * repo's own canonical answer, not a preference of this module's.
 *
 * ⚠ AND IT IS READ THROUGH `getDefaultScoringRules`, NOT TRANSCRIBED. Copying the weights would
 * make this a second definition of what Balanced means, free to drift from the registry the day
 * someone tunes it — the same defect as the probe that carried its own copy of a parser.
 */
export const CANONICAL_SCORING_FORMAT = 'IDP'

/** IDP position codes, matching `SLOT_ELIGIBILITY` in `idpValuation.ts`. */
const IDP_POSITION_CODES = ['LB', 'ILB', 'OLB', 'DL', 'DE', 'DT', 'NT', 'DB', 'CB', 'S', 'SS', 'FS'] as const

/**
 * Turn the registry's rule list into the flat `{ statKey: points }` record the projection
 * scorer consumes — the same shape `extractScoringSettings` returns for a real league.
 *
 * Disabled rules are omitted rather than written as 0: absent and "worth zero" are different
 * claims, and `hasIdpScoring` reads presence.
 */
export function canonicalIdpScoring(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const r of getDefaultScoringRules('NFL', CANONICAL_SCORING_FORMAT)) {
    if (!r.enabled) continue
    out[r.statKey] = r.pointsValue * (r.multiplier ?? 1)
  }
  return out
}

export interface CanonicalDefenderBoardArgs {
  prisma: PrismaClient
  /** Dynasty and redraft decay differently in the tail; this only selects WHICH curve. */
  isDynasty?: boolean
  /**
   * Bound the population. Omitted means every NFL defender the player table knows, which is the
   * intended use — a chart is only useful if it covers the board.
   */
  limit?: number
}

export interface CanonicalDefenderBoardResult extends LeagueIdpVorpResult {
  /** The reference league these prices are relative to. Never omit this when displaying them. */
  reference: {
    numTeams: number
    idpStarters: number
    slots: readonly string[]
    scoringFormat: string
  }
  /** Defenders considered before pricing — distinct from `coverage.defenders`, which is post-filter. */
  candidates: number
}

/**
 * Price every NFL defender against the canonical reference league.
 *
 * ⚠ THE RESULT IS ONLY MEANINGFUL BESIDE ITS REFERENCE, which is why `reference` is returned
 * rather than left implicit. "Micah Parsons is worth 4,800" is not a fact about the world; it is
 * a fact about a 12-team league starting three defenders under Balanced scoring. A surface that
 * shows the number without the league is making a claim this module cannot support.
 *
 * ⚠ AND IT IS NOT COMPARABLE TO THE OFFENSIVE CHART WITHOUT A DECISION NOBODY HAS MADE. The IDP
 * curve's ceiling (5,500 dynasty) is a product choice about what a top defender is worth against
 * a top receiver, and `idp-kicker-values.ts` records that the ceiling swings real trade verdicts
 * by up to five grades. Placing these numbers next to FantasyCalc values asserts that exchange
 * rate. See [[idp-ceiling-blast-radius]].
 */
export async function loadCanonicalDefenderBoard(
  args: CanonicalDefenderBoardArgs,
): Promise<CanonicalDefenderBoardResult> {
  const reference = {
    numTeams: CANONICAL_NUM_TEAMS,
    idpStarters: CANONICAL_IDP_SLOTS.length,
    slots: CANONICAL_IDP_SLOTS,
    scoringFormat: CANONICAL_SCORING_FORMAT,
  }

  /*
   * ⚠ DEDUPE ON sleeperId HERE AS WELL AS DOWNSTREAM. `SportsPlayer` carries duplicate rows per
   * Sleeper id — measured at 571 ids resolving to 1,329 rows — so `candidates` would be inflated
   * by roughly 2x if it counted rows. `priceIdpBoard` dedupes again for its own coverage numbers;
   * this one exists so the two can be compared and a discrepancy is visible rather than hidden.
   */
  const rows = await args.prisma.sportsPlayer
    .findMany({
      where: { sport: 'NFL', sleeperId: { not: null }, position: { in: [...IDP_POSITION_CODES] } },
      select: { sleeperId: true },
      ...(args.limit ? { take: args.limit } : {}),
    })
    .catch(() => [] as Array<{ sleeperId: string | null }>)

  const sleeperIds = [...new Set(rows.map((r) => r.sleeperId).filter((id): id is string => !!id))]

  const priced = await priceIdpBoard({
    prisma: args.prisma,
    scoring: canonicalIdpScoring(),
    sleeperIds,
    rosterSlots: CANONICAL_IDP_SLOTS,
    numTeams: CANONICAL_NUM_TEAMS,
    isDynasty: args.isDynasty ?? true,
  })

  return { ...priced, reference, candidates: sleeperIds.length }
}
