import { prisma } from '@/lib/prisma'
import { isUnownedTeam, ownedTeamNames } from '@/lib/core-app/commissioner/activity'

/**
 * Roster-shape reads for Workspace's task detection.
 *
 * Separate from `taskSources.ts` on purpose: that module is pure functions of reads, which is what
 * lets the whole detection layer be tested without a database. Putting a Prisma call in it would
 * take that away from every detector, not just the new one.
 */

export interface OrphanTeamCounts {
  totalTeams: number
  orphanCount: number
  /**
   * The names of every team someone owns, spelled exactly as `readManagerActivity` spells them.
   *
   * ⚠ THE INACTIVE-MANAGERS DETECTOR NEEDS THIS AND CANNOT GET IT FROM THE MOVE READ.
   * `readManagerActivity` lists only managers with a move in the last two windows, so a manager
   * who has done nothing for 28 days is not in its answer at all — the one person the detector
   * exists to name. Measured on production 2026-09-16: a 12-team league with 4 active managers
   * had a stored task reading "2 managers inactive"; the other 6 were invisible to it.
   */
  ownedTeamNames: string[]
}

/**
 * How many seats this league has, how many nobody is in, and who owns the rest.
 *
 * ⚠ `isOrphan` IS A THREE-STATE COLUMN — `true`, `false`, or NULL for a row the importer never
 * decided about — so it is tested strictly (`isUnownedTeam` requires `=== true`). Counting
 * `!== false` would report every league that predates the flag as entirely unclaimed, which is
 * the loudest possible way to be wrong about 288 leagues.
 *
 * ⚠ AND `isOrphan === true` IS STILL NOT ENOUGH. On production it is set on teams that DO have
 * someone — one was claimed by the league's own owner and linked to a platform user. A seat counts
 * as empty only when it is flagged AND unclaimed AND has no platform user behind it — the same
 * `isUnownedTeam` the Commissioner Hub uses, so the two surfaces cannot disagree about a league's
 * empty seats.
 *
 * Degrades to zeroes rather than throwing: a Workspace scan that cannot read the roster should lose
 * one detector, not fail the league's whole scan and drop the three findings that did resolve.
 */
export async function readOrphanTeamCounts(leagueId: string): Promise<OrphanTeamCounts> {
  try {
    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { teamName: true, ownerName: true, isOrphan: true, claimedByUserId: true, platformUserId: true },
    })
    return {
      totalTeams: teams.length,
      orphanCount: teams.filter(isUnownedTeam).length,
      ownedTeamNames: ownedTeamNames(teams),
    }
  } catch {
    return { totalTeams: 0, orphanCount: 0, ownedTeamNames: [] }
  }
}
