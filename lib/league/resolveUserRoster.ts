import 'server-only'

import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'

/**
 * WHICH ROSTER IN THIS LEAGUE BELONGS TO THIS USER.
 *
 * `resolveLeagueMembership` (lib/league-access.ts) answers "is this user IN the league" and is
 * the canonical ACCESS gate. This answers the different question a display surface asks —
 * "which of these players are YOURS" — and is deliberately NOT an access check. Call it only
 * after access is already established.
 *
 * ⚠ MEASURED AGAINST PRODUCTION 2026-08-28 BEFORE BEING WRITTEN, because the obvious design
 * was wrong. Across the 10 IDP leagues (176 Roster rows, 174 LeagueTeam rows, 13 claims):
 *
 *   Roster.platformUserId === userId                    13 of 13 claimed teams  ✅
 *   LeagueTeam.claimedByUserId -> platformUserId -> Roster   0 of 13            ❌
 *   LeagueTeam.legacyRosterId                            0 of 174 populated     ❌
 *
 * So the single roster lookup is the whole resolver, and the two routes that LOOK like they
 * should bridge a claim to a roster do not join at all. Do not add them back without
 * re-measuring — they are not merely redundant here, they resolve nothing.
 *
 * ⚠ WHY `Roster.platformUserId` HOLDS AN AF USER ID AT ALL. The column is the PLATFORM's id
 * space for unclaimed teams — Sleeper's numeric strings, e.g. `468164924573478912`, and 117 of
 * the 119 distinct values in these leagues are exactly that. Claiming a team REWRITES this
 * column to the AllFantasy user id, while `LeagueTeam.platformUserId` keeps the Sleeper id.
 * That asymmetry is why path A works and the LeagueTeam bridge does not, and it is why a
 * non-AF manager correctly resolves to nothing: they never claimed, so nothing points at them.
 *
 * ⚠ NEVER gate access on `LeagueTeam.platformUserId`. It is `String?` and describes a
 * different population — lib/league-access.ts measured it rejecting 98 of 176 real members.
 * This module does not read it.
 */
export interface UserRosterResolution {
  /** `Roster.id` for the user's own team. */
  rosterId: string
  /** Everything on that roster, in the platform's player-id space (Sleeper ids for NFL). */
  playerIds: string[]
}

export async function resolveUserRosterInLeague(
  leagueId: string,
  userId: string | null | undefined,
): Promise<UserRosterResolution | null> {
  if (!leagueId || !userId) return null

  try {
    /*
     * ⚠ BOTH ID SPACES. `League.id` is an AllFantasy uuid; `platformLeagueId` is Sleeper's
     * numeric string. Callers pass either, and `Roster.leagueId` is the uuid, so a caller
     * holding the platform id would silently match no rosters without this.
     */
    const league =
      (await prisma.league
        .findUnique({ where: { id: leagueId }, select: { id: true } })
        .catch(() => null)) ??
      (await prisma.league
        .findFirst({
          where: { platformLeagueId: leagueId },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        })
        .catch(() => null))

    if (!league) return null

    const roster = await prisma.roster.findFirst({
      where: { leagueId: league.id, platformUserId: userId },
      select: { id: true, playerData: true },
    })
    if (!roster) return null

    return { rosterId: roster.id, playerIds: getRosterPlayerIds(roster.playerData) }
  } catch {
    return null
  }
}
