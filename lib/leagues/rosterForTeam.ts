/**
 * Find a team's roster, honouring the sync's identity contract.
 *
 * ⚠ `Roster.platformUserId` DOES NOT MATCH `LeagueTeam.platformUserId`, AND THAT
 * IS BY DESIGN. From the header of
 * `lib/fantasy-os/sync/collector/applySleeperLeagueSync.ts`:
 *
 *   "LeagueTeam.platformUserId retains the RAW Sleeper manager id, while
 *    Roster.platformUserId may hold the RESOLVED AllFantasy AppUser id (when the
 *    manager is linked to an AF account) — the raw Sleeper manager id always
 *    remains in Roster.playerData.source_manager_id."
 *
 * `lib/sleeper-sync.ts:411` implements it:
 *
 *     const platformUserId = managerUserIds.get(ownerId) ?? ownerId
 *
 * So a LINKED manager's roster is keyed by their AllFantasy id and an UNLINKED
 * manager's by the raw Sleeper id. Joining the two `platformUserId` columns
 * therefore finds every unlinked manager and silently misses every linked one.
 *
 * ⚠ THE FAILURE LOOKS LIKE ONE BROKEN ROW, WHICH IS WHY IT MISLEADS. Measured on
 * a real league: 11 of 12 rosters joined and the twelfth appeared orphaned — it
 * was simply the only manager with a linked account. It also gets WORSE as more
 * managers link, not better, so a passing spot-check today proves nothing.
 *
 * `source_manager_id` is the durable key: the contract guarantees it always
 * holds the raw Sleeper manager id, for linked and unlinked alike.
 */

import 'server-only'

import { prisma } from '@/lib/prisma'

export type RosterForTeam = {
  id: string
  playerData: unknown
  /** How the row was found, so a caller can report which contract applied. */
  matchedBy: 'source_manager_id' | 'platform_user_id'
}

/**
 * The roster belonging to a league team, by its RAW platform manager id.
 *
 * Tries the durable key first and falls back to the direct one, so it is correct
 * for a linked manager, an unlinked manager, and any row written before the
 * contract existed.
 */
export async function findRosterForTeam(
  leagueId: string,
  platformManagerId: string,
): Promise<RosterForTeam | null> {
  /*
   * Raw SQL because the durable key lives inside a Json column, and Prisma's
   * typed filters cannot express "this JSON path OR this scalar column".
   */
  const rows = await prisma.$queryRaw<
    Array<{ id: string; playerData: unknown; matched_by: string }>
  >`
    SELECT id,
           "playerData",
           CASE
             WHEN ("playerData"::jsonb)->>'source_manager_id' = ${platformManagerId}
               THEN 'source_manager_id'
             ELSE 'platform_user_id'
           END AS matched_by
      FROM rosters
     WHERE "leagueId" = ${leagueId}
       AND (
             ("playerData"::jsonb)->>'source_manager_id' = ${platformManagerId}
             OR "platformUserId" = ${platformManagerId}
           )
     ORDER BY CASE
                WHEN ("playerData"::jsonb)->>'source_manager_id' = ${platformManagerId} THEN 0
                ELSE 1
              END
     LIMIT 1
  `

  const hit = rows[0]
  if (!hit) return null
  return {
    id: hit.id,
    playerData: hit.playerData,
    matchedBy: hit.matched_by === 'source_manager_id' ? 'source_manager_id' : 'platform_user_id',
  }
}

/**
 * The player ids on a roster, however the platform stored them.
 *
 * Returns null when the roster holds no player array at all — distinct from an
 * empty roster, which is a real state.
 */
export function rosterPlayerIds(playerData: unknown): string[] | null {
  const pd = (playerData ?? null) as { players?: unknown[] } | null
  if (!Array.isArray(pd?.players)) return null
  return (pd.players as unknown[]).map(String).filter(Boolean)
}
