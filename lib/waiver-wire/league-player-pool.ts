import 'server-only'

import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { normalizePoolRowToUnified } from '@/lib/player-data/normalizeProviderPlayer'
import {
  serializeUnifiedPlayerForApi,
  type UnifiedPlayerWireDto,
} from '@/lib/player-data/serializeUnifiedPlayerForApi'

/**
 * The waiver wire for one league: every player in the sport's pool that nobody in the league holds.
 *
 * ── WHY THIS IS A MODULE AND NOT A ROUTE BODY ───────────────────────────────────────────────
 * It was a route body — `app/api/waiver-wire/leagues/[leagueId]/players`, whose result the waiver
 * page posts straight back to `/api/waiver-ai/engine` as `availablePlayers`. So the pool the waiver
 * engine reasons over has only ever existed on the CLIENT's round trip, which is why
 * `lib/decision-os/grounding/packet.ts` could not produce a `waiverDecision`: the packet has no
 * browser to ask. Extracting it here gives the server the same list the user's browser gets, from
 * ONE implementation.
 *
 * 🛑 THAT "ONE IMPLEMENTATION" IS THE POINT, NOT A TIDINESS ARGUMENT. A second server-side
 * free-agent query would be a second answer to "who is available", and the two would drift the
 * first time a sport, an id space or a rostered-id rule changed. This repo has already paid for
 * that shape once — a SQL copy of `normalizePlayerName` disagreed with the JS original on 7.2% of
 * rows. The route below is now a caller, not a copy.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────────────────
 * ⚠ NO AUTHORIZATION. The route keeps its own session check and league-membership gate, because
 * they answer a different question (may THIS user see this league) from the one here (who is on
 * this wire). A loader that authorized would invite a caller to skip the route's gate and think it
 * was covered; a loader that does not makes every caller state its own answer. The Decision OS
 * caller reaches this only after `loadWaiverWorldFacts` has already resolved the asker's roster in
 * the league, which is a stronger membership proof than the route's.
 *
 * ── THE TWO IDENTIFIER SPACES, KEPT AS THEY WERE ────────────────────────────────────────────
 * ⚠ A rostered player is matched on BOTH `player_id` and `external_source_id`, because a roster
 * stores whichever id its own platform uses. Dropping either half would leak rostered players onto
 * the wire — the maximally wrong answer for this screen, since the best "available" player would
 * be somebody's starter.
 */

/** How many pool rows to consider before the rostered filter. */
const DEFAULT_POOL_LIMIT = 800

export interface LeaguePlayerPoolOptions {
  /**
   * Rows drawn from the sport pool BEFORE rostered players are removed.
   *
   * ⚠ IT IS NOT THE SIZE OF THE RESULT, AND THE DIFFERENCE MATTERS AT SMALL VALUES. The pool is
   * ADP-ordered, so the first N rows are the most-owned players — which are also the most likely to
   * be rostered. A caller wanting 60 free agents must ask for several hundred here and slice
   * afterwards, not pass 60.
   */
  poolLimit?: number
  position?: string
  teamId?: string
  /**
   * Cap the number of AVAILABLE players serialized, applied after the rostered filter.
   *
   * 🛑 THE SERIALIZATION IS THE COST, NOT THE QUERY — measured 2026-09-08. `serializeUnifiedPlayerForApi`
   * builds the full unified snapshot per row: canonical NFL redraft player, display metadata, player
   * intelligence, game context, live scoring context. A caller that needs sixty names, positions and
   * injury statuses was paying for several hundred of those.
   *
   * ⚠ IT MUST BE APPLIED AFTER THE ROSTERED FILTER AND NEVER BY LOWERING `poolLimit`. The pool is
   * ADP-ordered, so its head is mostly rostered players; capping the INPUT returns a wire of scraps,
   * while capping the OUTPUT returns the true top of the wire. They are not interchangeable and the
   * cheap-looking one is wrong.
   *
   * Omitted by the route on purpose — the waiver page renders and filters the whole wire client-side,
   * so truncating it there would silently shorten a list a user scrolls.
   */
  maxPlayers?: number
}

export interface LeaguePlayerPoolResult {
  players: UnifiedPlayerWireDto[]
  /** Distinct player ids held by any roster in the league — the honesty denominator. */
  rosteredCount: number
}

/**
 * Load the available-player pool for a league. Read-only. Throws only what prisma throws; callers
 * that must not fail (the grounding packet) catch and degrade to a stated gap.
 */
export async function loadLeaguePlayerPool(
  leagueId: string,
  sport: string,
  options: LeaguePlayerPoolOptions = {},
): Promise<LeaguePlayerPoolResult> {
  const allRosters = await (prisma as any).roster.findMany({
    where: { leagueId },
    select: { playerData: true },
  })

  const rosteredIds = new Set<string>()
  for (const roster of allRosters) {
    for (const id of getRosterPlayerIds(roster.playerData)) {
      rosteredIds.add(id)
    }
  }

  const pool = await getPlayerPoolForLeague(leagueId, sport as Parameters<typeof getPlayerPoolForLeague>[1], {
    limit: options.poolLimit ?? DEFAULT_POOL_LIMIT,
    position: options.position,
    teamId: options.teamId,
  })

  const available = pool.filter((p: any) => {
    const playerId = p.player_id == null ? null : String(p.player_id)
    const externalSourceId = p.external_source_id == null ? null : String(p.external_source_id)
    return !(
      (playerId && rosteredIds.has(playerId)) ||
      (externalSourceId && rosteredIds.has(externalSourceId))
    )
  })

  /*
   * ⚠ CAP BEFORE THE AUGMENT LOOKUP AND THE SERIALIZE, not after. Both scale with row count, and a
   * caller that wanted sixty was paying for every available player in the sport.
   */
  const capped =
    options.maxPlayers != null && options.maxPlayers >= 0
      ? available.slice(0, options.maxPlayers)
      : available

  const availablePlayerIds = capped
    .map((p: any) => (p.player_id == null ? null : String(p.player_id)))
    .filter((id: string | null): id is string => Boolean(id))

  const sportsPlayerRows =
    availablePlayerIds.length > 0
      ? await (prisma as any).sportsPlayerRecord
          .findMany({
            where: {
              id: { in: availablePlayerIds },
              sport: String(sport).toUpperCase(),
            },
            select: {
              id: true,
              stats: true,
              projections: true,
              dataSource: true,
              headshotSource: true,
              adp: true,
            },
          })
          .catch(() => [])
      : []

  const sportsPlayerById = new Map<string, any>(
    sportsPlayerRows.map((row: any) => [String(row.id), row]),
  )

  const players = capped.map((p: any) =>
    serializeUnifiedPlayerForApi(
      normalizePoolRowToUnified(p, sport, {
        augment: {
          sportsPlayerRecord:
            p.player_id == null ? undefined : sportsPlayerById.get(String(p.player_id)),
        },
      }),
    ),
  )

  return { players, rosteredCount: rosteredIds.size }
}
