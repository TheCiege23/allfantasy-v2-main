/**
 * The waiver-wire pool for one league — the input `loadWaiverWorldFacts` deliberately does not load.
 *
 * 🛑 THIS IS THE THING THAT MADE `waiverDecision` UNPRODUCIBLE. `packet.ts` recorded the blocker
 * exactly: "`WaiverAIEngineInput` needs `availablePlayers`, the waiver wire pool, which the legacy
 * route already holds and `loadWaiverWorldFacts` does not load." The legacy route holds it because
 * the CLIENT posts it (`availablePlayers: z.array(...).min(1)` on /api/waiver-ai/engine) — there is
 * no server-side assembly there to reuse. This module is that assembly.
 *
 * ⚠ IT IS THE SAME RESOLVER AND THE SAME SUBTRACTION THE WAIVER ASSISTANT ALREADY USES
 * (`lib/ai/waivers/waiverRecommendationService.ts`), reused rather than re-derived. Two answers to
 * "who is available in this league" is the bug; the assistant and the packet must not be able to
 * disagree about it.
 */
import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { getPlayerPoolForSport } from '@/lib/sport-teams/SportPlayerPoolResolver'

export interface WaiverPool {
  availablePlayers: Array<{ id: string; name: string; position: string }>
  /**
   * True when the pool is a bounded slice rather than the whole wire.
   *
   * ⚠ REPORTED, NOT HIDDEN. `runWaiverClaimDecision` takes `poolIncomplete` and the decision's
   * honesty depends on it: a recommendation drawn from the top 300 is a recommendation from a
   * SAMPLE, and saying so is the difference between "the best add" and "the best add we looked at".
   */
  poolIncomplete: boolean
  /** Rosters found for this league. Zero means the subtraction below was vacuous. */
  leagueRosterCount: number
}

/** Matches the assistant's `deep` mode. A larger slice costs one query, not one per player. */
const POOL_LIMIT = 300

export async function loadWaiverPool(leagueId: string, sport: string): Promise<WaiverPool> {
  const [leagueRosters, pool] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId }, select: { playerData: true } }),
    getPlayerPoolForSport(sport, { limit: POOL_LIMIT }),
  ])

  /*
   * ⚠ EVERY ROSTER IN THE LEAGUE, NOT JUST THE ASKER'S. A pool that subtracts only your own players
   * recommends people already rostered by your opponents — confidently, and with a FAAB bid attached.
   * That is worse than no recommendation, because it looks actionable.
   */
  const rosteredIds = new Set<string>()
  for (const r of leagueRosters) {
    for (const id of getRosterPlayerIds(r.playerData)) rosteredIds.add(id)
  }

  const availablePlayers = pool
    .filter((p) => {
      const ids = [p.player_id, p.external_source_id].filter(Boolean) as string[]
      return !ids.some((id) => rosteredIds.has(id))
    })
    /*
     * ⚠ THE SAME MAPPING THE ASSISTANT USES, character for character — including the 'FLEX'
     * fallback and the uppercase. A different default here would be a second answer to "what
     * position is this player", and the two surfaces would rank the same wire differently.
     */
    .map((p) => ({
      id: p.player_id,
      name: p.full_name,
      position: (p.position ?? 'FLEX').toUpperCase(),
    }))

  return {
    availablePlayers,
    /*
     * The pool was capped, so a fuller wire may hold a better target. This is true whenever the
     * resolver returned a full page — the honest reading of a bounded read, not a guess about
     * whether more exists.
     */
    poolIncomplete: pool.length >= POOL_LIMIT,
    leagueRosterCount: leagueRosters.length,
  }
}
