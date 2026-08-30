/**
 * The one place a caller attaches this league's non-market values to a ValuationContext.
 *
 * 🛑 WHY THIS EXISTS: THE OPTIONAL FIELD WAS THE BUG. `ValuationContext.leagueValueByNameLower`
 * is optional, and its absence is silent and plausible — a defender still comes back with a
 * number, just the flat `IDP_KICKER_BASELINE_VALUES` constant in lib/hybrid-valuation.ts where
 * the best linebacker in the league and a rookie backup both price at 800. Nothing throws,
 * nothing logs, and no test fails. Four call sites wired it and three priced defenders without
 * it, so the SAME defender carried two different prices depending on which surface asked.
 *
 * A caller now spreads one call instead of assembling four things by hand:
 *
 *     const ctx: ValuationContext = {
 *       asOfDate, isSuperFlex,
 *       ...(await resolveLeagueValuePatch({ platformLeagueId, sleeperLeague: league })),
 *     }
 *
 * ⚠ AN EMPTY PATCH IS THE CORRECT RESULT FOR MOST LEAGUES AND MUST STAY HARMLESS. Only ~10 of
 * 110 production leagues genuinely score IDP. Everything else — no IDP scoring, no kicker slot,
 * no league at all — returns `{}` and the caller prices exactly as it did before.
 *
 * 🛑 AND "NO LEAGUE" MUST RETURN `{}` RATHER THAN A GUESS, WHICH IS WHY THE RULE IS STRUCTURAL
 * HERE INSTEAD OF WRITTEN IN A COMMENT AT EACH SITE. An IDP value is computed against a
 * specific league's starting slots and scoring; applying one league's board to another is worse
 * than the flat constant, because it is wrong AND confident. Callers that genuinely have no
 * league — `/api/instant/trade` parses a trade out of free text, `lib/trade-alternatives.ts`
 * receives a `UserTrade` that carries no league id — must keep passing nothing, and get `{}`
 * from here if they ask anyway.
 *
 * ⚠ FORMAT IS DERIVED HERE, NOT AT THE CALL SITE, AND THAT IS THE SECOND HALF OF THE POINT.
 * `isDynasty` selects between two decay curves and two ceilings (5500/5300 IDP, 500/650 kicker),
 * and three call sites resolved it three different ways — one of them by regex-testing a NUMBER
 * for the string "redraft", which can never match, so that surface read every league as dynasty.
 * Hand this a Sleeper league payload and `getLeagueType` decides, once.
 */

import type { PrismaClient } from '@prisma/client'

import { prisma as defaultPrisma } from '@/lib/prisma'
import type { ValuationContext } from '@/lib/hybrid-valuation'
import {
  loadLeagueTradeValues,
  type LeagueTradeValues,
  type LoadLeagueTradeValuesArgs,
} from '@/lib/league-values/leagueTradeValues'
import { getLeagueType, type SleeperLeague } from '@/lib/sleeper-client'

/**
 * The slice of a ValuationContext this module owns. A `Partial` on purpose: the empty object
 * is a first-class result, and spreading it must leave the context untouched.
 */
export type LeagueValuePatch = Partial<Pick<ValuationContext, 'leagueValueByNameLower'>>

/** Nothing to add. Frozen so a caller cannot mistake it for a mutable accumulator. */
const EMPTY_PATCH: LeagueValuePatch = Object.freeze({})

/**
 * Dynasty or not, from the only authority that answers it — Sleeper's `settings.type`
 * (0 redraft, 1 keeper, 2 dynasty).
 *
 * ⚠ KEEPER COUNTS AS REDRAFT HERE, matching `getLeagueType`, and the choice is visible rather
 * than incidental: a keeper league's values sit nearer redraft than dynasty, and inventing a
 * third curve would mean inventing two more unmeasured ceilings.
 */
export function isDynastySleeperLeague(league: SleeperLeague | null | undefined): boolean {
  if (!league) return false
  return getLeagueType(league) === 'dynasty'
}

export interface ResolveLeagueValuePatchArgs {
  /**
   * Sleeper's own league id — NOT the internal `League.id`. Sleeper's roster and settings
   * endpoints do not answer to the internal id, so a caller working in internal space must
   * pass `platformLeagueId`.
   */
  platformLeagueId: string | null | undefined
  /**
   * The Sleeper league payload, when the caller already fetched it. Supplying it decides the
   * format AND saves the loader a round trip, because `roster_positions` and `total_rosters`
   * are read straight off it.
   */
  sleeperLeague?: SleeperLeague | null
  /**
   * Format, for a caller that has no Sleeper payload to derive it from. Ignored when
   * `sleeperLeague` is supplied — the payload is the better authority.
   *
   * Defaults to dynasty when neither is given: every production league that genuinely scores
   * IDP is dynasty (see lib/idp-kicker-values.ts), so the redraft curve is unreachable today
   * and this default is the one that changes nothing.
   */
  isDynasty?: boolean
  /** Anything the caller already holds, so the loader fetches only what is genuinely missing. */
  prefetched?: LoadLeagueTradeValuesArgs['prefetched']
  /** Injectable for tests and for probes that build their own client. */
  prisma?: PrismaClient
  /**
   * Receives the full loader result — coverage, refusal reason, ambiguous names — for a caller
   * that wants to report why a board was or was not built. The patch itself stays a patch.
   */
  onResult?: (result: LeagueTradeValues) => void
}

/**
 * Build this league's IDP + kicker value map, shaped for spreading into a ValuationContext.
 *
 * Never throws and never rejects: a trade grade, a roster valuation or a waiver board dying
 * over an IDP lookup is strictly worse than one priced the old way.
 */
export async function resolveLeagueValuePatch(
  args: ResolveLeagueValuePatchArgs,
): Promise<LeagueValuePatch> {
  const platformLeagueId = args.platformLeagueId
  if (!platformLeagueId) return EMPTY_PATCH

  const isDynasty = args.sleeperLeague
    ? isDynastySleeperLeague(args.sleeperLeague)
    : args.isDynasty ?? true

  /*
   * Slots and team count come off the supplied payload when the caller did not pass them
   * explicitly. An explicit `prefetched` value always wins — a caller that took the trouble
   * to compute one knows something this function does not.
   */
  const prefetched: LoadLeagueTradeValuesArgs['prefetched'] = {
    ...args.prefetched,
    rosterPositions:
      args.prefetched?.rosterPositions ??
      (args.sleeperLeague?.roster_positions as readonly string[] | undefined) ??
      null,
    numTeams: args.prefetched?.numTeams ?? args.sleeperLeague?.total_rosters ?? null,
  }

  try {
    const values = await loadLeagueTradeValues({
      prisma: args.prisma ?? defaultPrisma,
      platformLeagueId,
      isDynasty,
      prefetched,
    })

    args.onResult?.(values)

    /*
     * An empty map is not an error, but it must not become an empty `leagueValueByNameLower`
     * either: the field's presence is what tells `pricePlayer` a board exists, so handing it
     * a map with nothing in it would be a claim rather than an absence.
     */
    if (values.byNameLower.size === 0) return EMPTY_PATCH
    return { leagueValueByNameLower: values.byNameLower }
  } catch {
    return EMPTY_PATCH
  }
}
