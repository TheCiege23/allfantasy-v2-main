import 'server-only'
import { prisma } from '@/lib/prisma'
import { railRecordsFrom, type RailRecord, type RailRecordTeam } from './railRecordRank'

export type { RailRecord } from './railRecordRank'

/**
 * Your record and place in each league, for the line under the platform on the league list
 * ("6-3 · 2nd").
 *
 * Two set-based reads whatever the league count: your claimed teams, then every team in those
 * leagues (for a place when the platform did not publish one). The shell is on every /core page,
 * so this is budgeted like `getRailMatchups`: a failure is an empty map and the line simply does
 * not draw.
 *
 * Postgres only — `LeagueTeam` as the last sync wrote it.
 */
export async function getRailRecords(userId: string, leagueIds: string[]): Promise<Record<string, RailRecord>> {
  if (leagueIds.length === 0) return {}
  const mine = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: userId, leagueId: { in: leagueIds } },
    select: { leagueId: true, externalId: true },
  })
  if (mine.length === 0) return {}
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: { in: [...new Set(mine.map((t) => t.leagueId))] } },
    select: { leagueId: true, externalId: true, wins: true, losses: true, ties: true, pointsFor: true, currentRank: true },
  })
  return railRecordsFrom(mine, teams as RailRecordTeam[])
}
