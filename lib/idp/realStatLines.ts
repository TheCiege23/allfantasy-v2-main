/**
 * Real IDP weekly stat lines — reads the PBP-derived rows `persistIdpLines`
 * writes into `FantasyStatLine` (source `rolling_insights_pbp`).
 *
 * ⚠ ID SPACES. Roster snapshots (`Roster.playerData`) carry Sleeper player ids;
 * the PBP writer keys lines by the Rolling Insights player id. The join is
 * strictly `PlayerIdentityMap.sleeperId → rollingInsightsId` — both spaces are
 * numeric strings, so matching a roster id against stat-line ids directly could
 * credit one player with another player's week. A missing mapping is an honest
 * gap; a cross-namespace collision is a wrong number a manager will act on.
 */

import { prisma } from '@/lib/prisma'
import type { IdpWeeklyStatLine } from '@/lib/idp/statIngestionEngine'

export const IDP_PBP_SOURCE = 'rolling_insights_pbp'

export type RealIdpWeek = { week: number; stats: IdpWeeklyStatLine }

export type RealIdpMissReason = 'no_identity_mapping' | 'no_stat_line'

export type RealIdpLineLookup = {
  /** roster player id → ingested weekly lines, ascending week. */
  linesByPlayer: Map<string, RealIdpWeek[]>
  /** roster player id → why nothing could be served. */
  missing: Map<string, RealIdpMissReason>
}

/** Newest season with ingested PBP defensive lines, or null when none exist yet. */
export async function getLatestIdpStatSeason(): Promise<string | null> {
  const newest = await prisma.fantasyStatLine.findFirst({
    where: { sport: 'NFL', source: IDP_PBP_SOURCE },
    orderBy: { season: 'desc' },
    select: { season: true },
  })
  return newest?.season ?? null
}

/**
 * Ingested weekly lines for roster player ids. Pass `week` for one week or
 * `throughWeek` for every week up to and including it (not both).
 * Players with no servable data are reported in `missing`, never invented.
 */
export async function getRealIdpLinesForRosterIds(
  rosterPlayerIds: string[],
  season: string,
  opts: { week?: number; throughWeek?: number } = {},
): Promise<RealIdpLineLookup> {
  const ids = [...new Set(rosterPlayerIds.filter(Boolean))]
  const linesByPlayer = new Map<string, RealIdpWeek[]>()
  const missing = new Map<string, RealIdpMissReason>()
  if (ids.length === 0) return { linesByPlayer, missing }

  const identity = await prisma.playerIdentityMap.findMany({
    where: { sport: 'NFL', sleeperId: { in: ids }, rollingInsightsId: { not: null } },
    select: { sleeperId: true, rollingInsightsId: true },
  })
  const statIdToRosterId = new Map<string, string>()
  for (const m of identity) {
    if (m.sleeperId && m.rollingInsightsId) statIdToRosterId.set(m.rollingInsightsId, m.sleeperId)
  }
  const mapped = new Set(statIdToRosterId.values())
  for (const id of ids) {
    if (!mapped.has(id)) missing.set(id, 'no_identity_mapping')
  }
  if (statIdToRosterId.size === 0) return { linesByPlayer, missing }

  const rows = await prisma.fantasyStatLine.findMany({
    where: {
      sport: 'NFL',
      source: IDP_PBP_SOURCE,
      season,
      playerId: { in: [...statIdToRosterId.keys()] },
      ...(opts.week != null
        ? { week: opts.week }
        : opts.throughWeek != null
          ? { week: { lte: opts.throughWeek } }
          : {}),
    },
    orderBy: { week: 'asc' },
    select: { playerId: true, week: true, stats: true },
  })
  for (const r of rows) {
    const rosterId = statIdToRosterId.get(r.playerId)
    if (!rosterId) continue
    const stats = (r.stats && typeof r.stats === 'object' && !Array.isArray(r.stats)
      ? r.stats
      : {}) as IdpWeeklyStatLine
    const arr = linesByPlayer.get(rosterId) ?? []
    arr.push({ week: r.week, stats })
    linesByPlayer.set(rosterId, arr)
  }
  for (const id of mapped) {
    if (!linesByPlayer.has(id)) missing.set(id, 'no_stat_line')
  }
  return { linesByPlayer, missing }
}
