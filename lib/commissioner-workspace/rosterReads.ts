import { prisma } from '@/lib/prisma'

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
}

/**
 * How many seats this league has, and how many nobody is in.
 *
 * ⚠ `isOrphan` IS A THREE-STATE COLUMN — `true`, `false`, or NULL for a row the importer never
 * decided about — so the orphan count tests `is true` rather than truthiness. Counting `!== false`
 * would report every league that predates the flag as entirely unclaimed, which is the loudest
 * possible way to be wrong about 288 leagues.
 *
 * Degrades to zeroes rather than throwing: a Workspace scan that cannot read the roster should lose
 * one detector, not fail the league's whole scan and drop the three findings that did resolve.
 */
export async function readOrphanTeamCounts(leagueId: string): Promise<OrphanTeamCounts> {
  try {
    const [totalTeams, orphanCount] = await Promise.all([
      prisma.leagueTeam.count({ where: { leagueId } }),
      prisma.leagueTeam.count({ where: { leagueId, isOrphan: true } }),
    ])
    return { totalTeams, orphanCount }
  } catch {
    return { totalTeams: 0, orphanCount: 0 }
  }
}
