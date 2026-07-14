/**
 * Real data-access adapter for PlayerExposureEngine — queries the EXISTING
 * `Roster` table (no new schema needed for this side) across every league a
 * manager participates in, keyed on `Roster.platformUserId` — the same field
 * lib/league-trade-engine/tradeService.ts and lib/waiver-wire/process-engine.ts
 * already key on. Reuses the existing `getRosterPlayerIds` parser rather than
 * re-implementing roster-shape parsing a second time.
 */

import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import type { ManagerRosterSnapshot } from './PlayerExposureEngine'

export async function loadManagerRosterSnapshots(managerKey: string): Promise<ManagerRosterSnapshot[]> {
  const rosters = await prisma.roster.findMany({
    where: { platformUserId: managerKey },
    select: { leagueId: true, playerData: true },
  })
  return rosters.map((r) => ({
    leagueId: r.leagueId,
    playerIds: getRosterPlayerIds(r.playerData),
  }))
}

/**
 * Platform-wide distinct league count from roster data — the cohort input
 * for PlayerExposure's privacy gate. Deliberately separate from
 * SignalStore.distinctLeagueCount(): that store only knows about leagues with
 * at least one trade/waiver signal, which is the wrong pool to gate exposure
 * on (a platform can have plenty of roster data with zero trade signals yet).
 */
export async function countDistinctLeaguesWithRosterData(): Promise<number> {
  const rows = await prisma.roster.findMany({
    distinct: ['leagueId'],
    select: { leagueId: true },
  })
  return rows.length
}
