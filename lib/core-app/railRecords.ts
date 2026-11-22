import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { espnAllPlayEliminationSize } from './espnKnockoutWeek'
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
  const claimed = [...new Set(mine.map((t) => t.leagueId))]
  const [teams, eliminationSizes] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId: { in: claimed } },
      select: { leagueId: true, externalId: true, wins: true, losses: true, ties: true, pointsFor: true, currentRank: true },
    }),
    espnEliminationSizes(claimed),
  ])
  return railRecordsFrom(mine, teams as RailRecordTeam[], eliminationSizes)
}

/**
 * ESPN leagues whose stored settings say all-play elimination, with their size — what
 * `espnKnockoutWeek` needs to name the week you went. Three scalars per ESPN league, not the whole
 * settings blob (it carries every scoring item). A failure is an empty map: the rows keep their record.
 */
async function espnEliminationSizes(leagueIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (leagueIds.length === 0) return out
  const rows = await prisma.$queryRaw<Array<{ id: string; scoring_type: string | null; enhancement: string | null; size: string | null }>>(Prisma.sql`
    SELECT id,
      settings->'espn_settings'->'scoringSettings'->>'scoringType' AS scoring_type,
      settings->'espn_settings'->'scoringSettings'->>'scoringEnhancementType' AS enhancement,
      settings->'espn_settings'->>'size' AS size
    FROM leagues
    WHERE id IN (${Prisma.join(leagueIds)}) AND lower(platform) = 'espn'
  `).catch(() => [])
  for (const r of rows) {
    const size = espnAllPlayEliminationSize({ scoringType: r.scoring_type, enhancement: r.enhancement, size: r.size })
    if (size != null) out.set(r.id, size)
  }
  return out
}
