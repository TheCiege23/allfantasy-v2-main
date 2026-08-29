/**
 * The league's IDP board, keyed by the only thing the trade evaluator knows: a name.
 *
 * This is the seam between `loadLeagueIdpVorp` (which speaks Sleeper ids) and
 * `lib/hybrid-valuation.ts` (which prices by name). It exists because the two
 * halves of a working IDP valuation were already built and simply never met:
 * the board is computed from the league's own scoring and starting slots, and
 * every trade surface priced defenders off a flat per-position constant anyway.
 *
 * 🛑 THE BOARD MUST BE BUILT OVER THE WHOLE LEAGUE, NOT OVER THE TRADED PLAYERS.
 * `loadLeagueIdpVorp` ranks whatever ids it is handed and prices rank 1 at the
 * ceiling. Hand it the two defenders in a trade and both come back as top-of-board
 * assets — the most confident possible way to be wrong. `rosterPlayerIds` must be
 * every rostered player in the league, which is why this function fetches rosters
 * rather than letting a caller pass the trade's own ids by accident.
 *
 * ⚠ NO `import 'server-only'`, MATCHING ITS SIBLING `leagueIdpVorp.ts`. Prisma arrives as
 * an ARGUMENT rather than an import, so there is no client-bundling hazard to guard, and
 * the guard would block the read-only production probes this stack is validated with
 * (`scripts/probe-idp-*.ts` run under tsx, which throws on `server-only`).
 *
 * ⚠ AN EMPTY MAP IS THE SUCCESS CASE FOR MOST LEAGUES. Only leagues that genuinely
 * score IDP produce values; everything else — no scoring settings, no defenders,
 * no projection history — returns empty, and every caller treats that as "price
 * the way you always did". Nothing here should ever throw into a trade grade.
 */

import type { PrismaClient } from '@prisma/client'

import { getLeagueInfo, getLeagueRosters, getPlayersBySport } from '@/lib/sleeper-client'
import { loadLeagueIdpVorp, resolveLeagueIdpScoring, type LeagueIdpVorpResult } from './leagueIdpVorp'

/** What a priced defender is worth in this league, and what he plays. */
export interface IdpNamedValue {
  value: number
  /** Normalised IDP group (LB / DL / DB) as the board resolved it. */
  position: string
  sleeperId: string
}

export interface IdpTradeValueMap {
  /**
   * Lowercased, trimmed full name -> value. Only unambiguous names appear; see
   * `ambiguousNames`.
   */
  byNameLower: ReadonlyMap<string, IdpNamedValue>
  /** Null when the board was built. Otherwise why it was not. */
  skipped: LeagueIdpVorpResult['skipped'] | 'no_league_id' | 'no_rostered_players' | 'error'
  coverage: {
    defenders: number
    projected: number
    priced: number
    /** Priced defenders that survived the name join — what the evaluator can actually use. */
    named: number
  }
  /**
   * Priced defenders dropped because their name is shared with another rostered
   * player. Reported rather than resolved: see the join note below.
   */
  ambiguousNames: string[]
}

const EMPTY = (skipped: IdpTradeValueMap['skipped']): IdpTradeValueMap => ({
  byNameLower: new Map(),
  skipped,
  coverage: { defenders: 0, projected: 0, priced: 0, named: 0 },
  ambiguousNames: [],
})

export interface LoadIdpTradeValuesArgs {
  prisma: PrismaClient
  /** Sleeper's own league id — the one every trade surface already holds. */
  platformLeagueId: string | null | undefined
  isDynasty: boolean
  /**
   * Pre-fetched Sleeper payloads, when the caller already has them. Supplying
   * these avoids re-fetching what the request has in hand; omitting them is
   * correct and simply costs the fetch.
   */
  prefetched?: {
    rosters?: Array<{ players?: string[] | null }> | null
    rosterPositions?: readonly string[] | null
    numTeams?: number | null
    /** Sleeper's player index, `pid -> { full_name, position }`. */
    players?: Record<string, { full_name?: string | null; position?: string | null }> | null
  }
}

/**
 * Build the league's IDP board and key it by name.
 *
 * Never throws: every failure path degrades to an empty map, because a trade grade
 * that dies over an IDP lookup is worse than one priced the old way.
 */
export async function loadIdpTradeValuesByName(
  args: LoadIdpTradeValuesArgs,
): Promise<IdpTradeValueMap> {
  const leagueId = args.platformLeagueId
  if (!leagueId) return EMPTY('no_league_id')

  try {
    /*
     * 🛑 THE SCORING GATE COMES FIRST, BEFORE ANY PROVIDER CALL.
     *
     * Only ~10 of 110 production leagues genuinely score IDP. Fetching rosters and the
     * player index first would put two Sleeper round trips on the critical path of every
     * trade grade in the other ~100 — latency paid by leagues that can never use the
     * result. One indexed Postgres read answers it instead.
     */
    const scoring = await resolveLeagueIdpScoring(args.prisma, leagueId)
    if (!scoring.ok) return EMPTY(scoring.reason)

    const rosters =
      args.prefetched?.rosters ?? (await getLeagueRosters(leagueId).catch(() => []))

    const rosterPlayerIds = [
      ...new Set(
        (rosters ?? []).flatMap((r) =>
          Array.isArray(r?.players) ? r.players.filter((p): p is string => typeof p === 'string' && !!p) : [],
        ),
      ),
    ]
    if (rosterPlayerIds.length === 0) return EMPTY('no_rostered_players')

    let rosterPositions = args.prefetched?.rosterPositions ?? null
    let numTeams = args.prefetched?.numTeams ?? null
    if (!rosterPositions || !numTeams) {
      const info = await getLeagueInfo(leagueId).catch(() => null)
      rosterPositions = rosterPositions ?? (info?.roster_positions as string[] | undefined) ?? null
      numTeams = numTeams ?? info?.total_rosters ?? null
    }

    const board = await loadLeagueIdpVorp({
      prisma: args.prisma,
      leagueId,
      rosterPositions,
      rosterPlayerIds,
      numTeams: numTeams ?? rosters?.length ?? 12,
      isDynasty: args.isDynasty,
    })

    if (board.skipped !== null || board.valueBySleeperId.size === 0) {
      return { ...EMPTY(board.skipped ?? 'no_rostered_players'), coverage: { ...board.coverage, named: 0 } }
    }

    type PlayerIndex = Record<string, { full_name?: string | null; position?: string | null }>
    const players: PlayerIndex =
      args.prefetched?.players ??
      ((await getPlayersBySport('nfl').catch(() => ({}))) as PlayerIndex)

    /*
     * ⚠ THE NAME JOIN REFUSES COLLISIONS INSTEAD OF PICKING ONE, AND AN IDP LEAGUE IS
     * EXACTLY WHERE THAT MATTERS. `lib/player-identity/nameIndex.ts` records the
     * general hazard; the specific one here is that a defender frequently shares a
     * name with an OFFENSIVE player on the same rosters — Justin Jefferson is a WR in
     * Minnesota and a linebacker in Cleveland, Byron Murphy a corner and a lineman.
     * The evaluator prices by name, so emitting a defender's value under a name the
     * league also uses for a wide receiver would hand a WR the defender's price.
     *
     * ⚠ AMBIGUITY IS ASSESSED OVER THE LEAGUE'S ROSTERED PLAYERS, NOT THE WHOLE SLEEPER
     * INDEX. The index carries ~11k players including decades of retirees, and refusing
     * every name that ever collided with one of them would drop most of the board to
     * protect against a confusion that cannot occur — the evaluator only prices players
     * someone actually rosters. The rostered set is the set that can genuinely be
     * confused, so it is the set the guard is drawn over.
     *
     * A refused name simply reads as absent, which is the pre-existing behaviour.
     */
    const nameCounts = new Map<string, number>()
    for (const pid of rosterPlayerIds) {
      const nm = players?.[pid]?.full_name?.trim().toLowerCase()
      if (!nm) continue
      nameCounts.set(nm, (nameCounts.get(nm) ?? 0) + 1)
    }

    const byNameLower = new Map<string, IdpNamedValue>()
    const ambiguousNames: string[] = []
    for (const [sleeperId, value] of board.valueBySleeperId) {
      const info = players?.[sleeperId]
      const nm = info?.full_name?.trim().toLowerCase()
      if (!nm) continue
      if ((nameCounts.get(nm) ?? 0) > 1) {
        ambiguousNames.push(nm)
        continue
      }
      byNameLower.set(nm, {
        value,
        position: (info?.position ?? '').toUpperCase() || 'IDP',
        sleeperId,
      })
    }

    return {
      byNameLower,
      skipped: null,
      coverage: { ...board.coverage, named: byNameLower.size },
      ambiguousNames: [...new Set(ambiguousNames)],
    }
  } catch {
    return EMPTY('error')
  }
}
